/**
 * x402 Cross-Chain Example Server (Express)
 *
 * This example shows how to add Stacks support to an existing x402 app.
 * If you're coming from EVM (Base) or Solana, the key patterns are:
 *
 * 1. HEADERS: Stacks uses "X-PAYMENT" header (vs "payment-signature" for EVM)
 * 2. 402 RESPONSE: Return accepts[] array with BOTH network options
 * 3. ROUTING: Check header format to route to correct middleware
 *
 * See docs/INTEGRATION_GUIDE.md for step-by-step integration instructions.
 */

import express from "express";
import { config } from "dotenv";
import { evmPaymentMiddleware, evmRoutes, evmConfig } from "./middleware-evm.js";
import { stacksPaymentMiddleware } from "./middleware-stacks.js";
import {
  createWeatherResponse,
  createAiCompletionResponse,
} from "../shared/mock-data.js";
import {
  stacksConfig,
  STACKS_NETWORK_IDS,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
} from "../shared/stacks-config.js";

config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =============================================================================
// Health & Info Endpoints (free)
// =============================================================================

app.get("/", (req, res) => {
  res.json({
    name: "x402 Cross-Chain Example",
    description: "Pay-per-use API accepting both EVM (Base) and Stacks payments",
    networks: {
      evm: {
        network: "base-sepolia",
        payTo: process.env.SERVER_ADDRESS_EVM || "not-configured",
        facilitator: process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator",
      },
      stacks: {
        network: process.env.STACKS_NETWORK || "testnet",
        payTo: process.env.SERVER_ADDRESS_STACKS || "not-configured",
        facilitator: process.env.STACKS_FACILITATOR_URL || "https://facilitator.stacksx402.com",
      },
    },
    endpoints: {
      "/weather": {
        method: "GET",
        price: "$0.001 USD",
        networks: ["EVM (USDC)", "Stacks (STX, sBTC, USDCx)"],
        description: "Get weather data for a city",
      },
      "/ai/complete": {
        method: "POST",
        price: "$0.01 USD",
        networks: ["EVM (USDC)", "Stacks (STX, sBTC, USDCx)"],
        description: "AI text completion",
      },
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =============================================================================
// EVM-Only Endpoints (using @x402/express)
// =============================================================================

app.use("/evm", evmPaymentMiddleware);

app.get("/evm/weather", (req, res) => {
  const city = (req.query.city as string) || "San Francisco";
  res.json(createWeatherResponse(city, "EVM (Base USDC)"));
});

app.post("/evm/ai/complete", (req, res) => {
  const { prompt } = req.body;
  res.json(createAiCompletionResponse(prompt, "EVM (Base USDC)"));
});

// =============================================================================
// Stacks-Only Endpoints (using x402-stacks)
// =============================================================================

app.get(
  "/stacks/weather",
  stacksPaymentMiddleware({
    amount: 1000n,
    description: "Weather data for a city",
  }),
  (req, res) => {
    const city = (req.query.city as string) || "San Francisco";
    const paidWith = `Stacks (${req.x402?.tokenType || "STX"})`;
    res.json(createWeatherResponse(city, paidWith, req.x402?.txId));
  }
);

app.post(
  "/stacks/ai/complete",
  stacksPaymentMiddleware({
    amount: 10000n,
    description: "AI text completion",
  }),
  (req, res) => {
    const { prompt } = req.body;
    const paidWith = `Stacks (${req.x402?.tokenType || "STX"})`;
    res.json(createAiCompletionResponse(prompt, paidWith, req.x402?.txId));
  }
);

// =============================================================================
// Cross-Chain Endpoint (accept EITHER EVM or Stacks)
// =============================================================================
//
// THIS IS THE KEY PATTERN FOR ADDING STACKS TO YOUR EXISTING x402 APP
//
// If you're coming from:
//   - EVM (Base): You already use "payment-signature" header and @x402/express
//   - Solana: You use similar patterns with x402-solana
//
// To add Stacks support, you need to:
//   1. Check for BOTH header types (Stacks uses "X-PAYMENT")
//   2. Return 402 response with BOTH networks in accepts[] array
//   3. Route to appropriate middleware based on which header is present
// =============================================================================

app.get("/weather", async (req, res) => {
  // ---------------------------------------------------------------------------
  // STEP 1: Check for payment headers from BOTH networks
  // ---------------------------------------------------------------------------
  // EVM/Base uses: "payment-signature" header (from @x402/express)
  // Solana uses:   Similar header pattern (from x402-solana)
  // Stacks uses:   "X-PAYMENT" header (from x402-stacks)
  // ---------------------------------------------------------------------------
  const evmPayment = req.header("payment-signature");
  const stacksPayment = req.header("x-payment");

  // ---------------------------------------------------------------------------
  // STEP 2: If no payment, return 402 with BOTH network options
  // ---------------------------------------------------------------------------
  // This is the x402-compliant response format. Clients parse the accepts[]
  // array and choose their preferred network. Your existing EVM/Solana clients
  // will still work - they just pick the network they support.
  // ---------------------------------------------------------------------------
  if (!evmPayment && !stacksPayment) {
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + DEFAULT_TIMEOUT_SECONDS * 1000).toISOString();

    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        // YOUR EXISTING EVM OPTION (keep this as-is from your current implementation)
        {
          scheme: "exact",
          network: evmConfig.network,              // "eip155:84532" for Base Sepolia
          maxAmountRequired: "1000",               // Amount in smallest unit
          asset: evmConfig.asset,                  // USDC contract address
          payTo: evmConfig.payTo,                  // Your EVM wallet address
          resource: req.originalUrl || req.path,
          description: "Weather data for a city",
          maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          extra: {
            facilitator: evmConfig.facilitatorUrl, // EVM facilitator URL
          },
        },
        // NEW: ADD THIS STACKS OPTION to enable Stacks payments
        {
          scheme: "exact",
          network: STACKS_NETWORK_IDS[stacksConfig.network], // "stacks:1" or "stacks:2147483648"
          maxAmountRequired: "1000",               // Amount in microSTX (1000 = 0.001 STX)
          asset: "STX",                            // Native STX token
          payTo: stacksConfig.payTo,               // Your Stacks wallet address
          resource: req.originalUrl || req.path,
          description: "Weather data for a city",
          maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          extra: {
            // Stacks-specific fields that x402-stacks client uses
            nonce,                                 // Unique request ID
            expiresAt,                             // Payment expiration
            tokenType: "STX",                      // Which token to pay with
            acceptedTokens: DEFAULT_ACCEPTED_TOKENS, // ["STX", "sBTC", "USDCx"]
            facilitator: stacksConfig.facilitatorUrl,
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Route to appropriate middleware based on payment header
  // ---------------------------------------------------------------------------
  // Stacks transactions are hex-encoded and longer than EVM signatures.
  // Check for Stacks payment first, then fall through to your existing EVM handler.
  // ---------------------------------------------------------------------------

  // Detect Stacks payment: longer payload or starts with "0x" (hex-encoded tx)
  const isStacksPayment = stacksPayment && (stacksPayment.length > 500 || stacksPayment.startsWith("0x"));

  if (isStacksPayment) {
    // Route to Stacks middleware (from x402-stacks package)
    return stacksPaymentMiddleware({
      amount: 1000n,
      description: "Weather data for a city",
    })(req, res, () => {
      const city = (req.query.city as string) || "San Francisco";
      const paidWith = `Stacks (${req.x402?.tokenType || "STX"})`;
      res.json(createWeatherResponse(city, paidWith, req.x402?.txId));
    });
  }

  // YOUR EXISTING EVM HANDLER (keep as-is, or use @x402/express middleware)
  // In production, you'd verify via your existing EVM facilitator
  const city = (req.query.city as string) || "San Francisco";
  res.json(
    createWeatherResponse(
      city,
      "EVM (Base)",
      undefined,
      "Production: verify via @x402/express and EVM facilitator"
    )
  );
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`\nx402 Cross-Chain Example Server`);
  console.log(`================================`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`\nConfigured Networks:`);
  console.log(`  EVM:    ${process.env.SERVER_ADDRESS_EVM || "not configured"}`);
  console.log(`  Stacks: ${process.env.SERVER_ADDRESS_STACKS || "not configured"}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /           - API info (free)`);
  console.log(`  GET  /health     - Health check (free)`);
  console.log(`  GET  /evm/weather    - EVM-only endpoint`);
  console.log(`  GET  /stacks/weather - Stacks-only endpoint`);
  console.log(`  GET  /weather        - Cross-chain endpoint`);
  console.log(`\n`);
});
