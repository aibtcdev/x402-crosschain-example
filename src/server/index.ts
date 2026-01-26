/**
 * x402 Cross-Chain Example Server (Express) - v2 Protocol
 *
 * This example shows how to add Stacks support to an existing x402 app using v2 protocol.
 * Both EVM and Stacks now use the unified "Payment-Signature" header format.
 *
 * v2 Key Changes:
 * - Header: Unified "Payment-Signature" for all networks (base64 JSON)
 * - 402 response: Uses "amount" and separate "resource" object
 * - Routing: Based on decoded payload's "network" field (CAIP-2 format)
 *
 * See docs/FROM_EVM.md for step-by-step integration instructions.
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
  STACKS_NETWORKS,
  networkToCAIP2,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  decodePaymentSignature,
  getAssetIdentifier,
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
// Cross-Chain Endpoint (accept EITHER EVM or Stacks) - v2 Protocol
// =============================================================================
//
// THIS IS THE KEY PATTERN FOR ADDING STACKS TO YOUR EXISTING x402 APP
//
// v2 simplifies cross-chain support:
//   1. All networks use unified "Payment-Signature" header (base64 JSON)
//   2. Return v2 402 response with "resource" object and "amount" field
//   3. Route based on decoded payload's "network" field (CAIP-2 format)
// =============================================================================

app.get("/weather", async (req, res) => {
  // ---------------------------------------------------------------------------
  // STEP 1: Check for unified Payment-Signature header (v2)
  // ---------------------------------------------------------------------------
  // v2: All networks use the same header format (base64-encoded JSON)
  // The payload contains the network identifier for routing
  // ---------------------------------------------------------------------------
  const paymentSignature = req.header("payment-signature");

  // ---------------------------------------------------------------------------
  // STEP 2: If no payment, return v2 402 with BOTH network options
  // ---------------------------------------------------------------------------
  // v2 format uses separate "resource" object and "amount" instead of inline
  // ---------------------------------------------------------------------------
  if (!paymentSignature) {
    return res.status(402).json({
      x402Version: 2,
      error: "Payment Required",
      resource: {
        url: req.originalUrl || req.path,
        description: "Weather data for a city",
        mimeType: "application/json",
      },
      accepts: [
        // EVM OPTION (Base)
        {
          scheme: "exact",
          network: evmConfig.network, // "eip155:84532" for Base Sepolia
          asset: evmConfig.asset, // USDC contract address
          amount: "1000", // v2: "amount" not "maxAmountRequired"
          payTo: evmConfig.payTo,
          maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          extra: {
            facilitator: evmConfig.facilitatorUrl,
          },
        },
        // STACKS OPTION (STX)
        {
          scheme: "exact",
          network: networkToCAIP2(stacksConfig.network), // CAIP-2: "stacks:1" or "stacks:2147483648"
          asset: "STX",
          amount: "1000", // Amount in microSTX
          payTo: stacksConfig.payTo,
          maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          extra: {
            facilitator: stacksConfig.facilitatorUrl,
            tokenType: "STX",
            acceptedTokens: DEFAULT_ACCEPTED_TOKENS,
          },
        },
        // STACKS OPTION (sBTC)
        {
          scheme: "exact",
          network: networkToCAIP2(stacksConfig.network),
          asset: getAssetIdentifier("sBTC", stacksConfig.network),
          amount: "100", // Amount in satoshis
          payTo: stacksConfig.payTo,
          maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          extra: {
            facilitator: stacksConfig.facilitatorUrl,
            tokenType: "sBTC",
            acceptedTokens: DEFAULT_ACCEPTED_TOKENS,
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Decode payload and route based on network (v2)
  // ---------------------------------------------------------------------------
  // v2: Decode base64 JSON to determine which network the payment is for
  // ---------------------------------------------------------------------------
  let isStacksPayment = false;
  try {
    const payload = decodePaymentSignature(paymentSignature);
    isStacksPayment = payload.accepted.network.startsWith("stacks:");
  } catch (error) {
    return res.status(400).json({
      error: "Invalid Payment-Signature header",
      details: "Expected base64-encoded JSON payload",
    });
  }

  if (isStacksPayment) {
    // Route to Stacks v2 middleware
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
