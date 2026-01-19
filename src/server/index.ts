/**
 * x402 Cross-Chain Example Server
 *
 * Demonstrates accepting payments on BOTH EVM (Base) and Stacks networks
 * using the x402 protocol. This shows how existing x402 apps can add
 * Stacks support with minimal code changes.
 */

import express from "express";
import { config } from "dotenv";
import { evmPaymentMiddleware, evmRoutes, evmConfig } from "./middleware-evm.js";
import {
  stacksPaymentMiddleware,
  stacksConfig,
  STACKS_NETWORK_IDS,
} from "./middleware-stacks.js";

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

// Apply EVM payment middleware to /evm/* routes
app.use("/evm", evmPaymentMiddleware);

app.get("/evm/weather", (req, res) => {
  const city = req.query.city || "San Francisco";
  res.json({
    city,
    temperature: Math.floor(Math.random() * 30) + 10,
    conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
    paidWith: "EVM (Base USDC)",
  });
});

app.post("/evm/ai/complete", (req, res) => {
  const { prompt } = req.body;
  res.json({
    prompt,
    completion: `This is a mock AI response to: "${prompt}"`,
    tokens: { input: prompt?.length || 0, output: 50 },
    paidWith: "EVM (Base USDC)",
  });
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
    const city = req.query.city || "San Francisco";
    res.json({
      city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
      paidWith: `Stacks (${(req as any).x402?.tokenType || "STX"})`,
      txId: (req as any).x402?.txId,
    });
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
    res.json({
      prompt,
      completion: `This is a mock AI response to: "${prompt}"`,
      tokens: { input: prompt?.length || 0, output: 50 },
      paidWith: `Stacks (${(req as any).x402?.tokenType || "STX"})`,
      txId: (req as any).x402?.txId,
    });
  }
);

// =============================================================================
// Cross-Chain Endpoints (accept EITHER network)
// =============================================================================

/**
 * Cross-chain endpoint demonstrating x402-compliant multi-network support.
 *
 * This is the key pattern for cross-chain support:
 * 1. Return 402 with accepts array containing BOTH network options
 * 2. Check which payment header is present and route accordingly
 *
 * The 402 response uses the standard x402 format so any compliant client
 * can parse it and choose their preferred network.
 */
app.get("/weather", async (req, res, next) => {
  const evmPayment = req.header("x-payment") || req.header("payment-signature");
  const stacksPayment = req.header("x-payment");

  // Detect which network based on header format
  // Stacks transactions are hex-encoded and start with 0x or are longer
  const isStacksPayment =
    stacksPayment && (stacksPayment.length > 500 || stacksPayment.startsWith("0x"));

  // If no payment provided, return x402-compliant 402 with BOTH network options
  if (!evmPayment && !stacksPayment) {
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        // EVM option (Base Sepolia)
        {
          scheme: "exact",
          network: evmConfig.network,
          maxAmountRequired: "1000",
          asset: evmConfig.asset,
          payTo: evmConfig.payTo,
          resource: req.originalUrl || req.path,
          description: "Weather data for a city",
          maxTimeoutSeconds: 300,
          extra: {
            facilitator: evmConfig.facilitatorUrl,
          },
        },
        // Stacks option
        {
          scheme: "exact",
          network: STACKS_NETWORK_IDS[stacksConfig.network],
          maxAmountRequired: "1000",
          asset: "STX",
          payTo: stacksConfig.payTo,
          resource: req.originalUrl || req.path,
          description: "Weather data for a city",
          maxTimeoutSeconds: 300,
          extra: {
            nonce,
            expiresAt,
            tokenType: "STX",
            acceptedTokens: ["STX", "sBTC", "USDCx"],
            facilitator: stacksConfig.facilitatorUrl,
          },
        },
      ],
    });
  }

  // Route to appropriate handler based on payment type
  if (isStacksPayment) {
    // Handle Stacks payment
    return stacksPaymentMiddleware({
      amount: 1000n,
      description: "Weather data for a city",
    })(req, res, () => {
      const city = req.query.city || "San Francisco";
      res.json({
        city,
        temperature: Math.floor(Math.random() * 30) + 10,
        conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
        paidWith: `Stacks (${(req as any).x402?.tokenType || "STX"})`,
        txId: (req as any).x402?.txId,
      });
    });
  }

  // Handle EVM payment (forward to EVM middleware)
  // In a real implementation, you'd apply the EVM middleware here
  // For simplicity, we'll just process it directly
  const city = req.query.city || "San Francisco";
  res.json({
    city,
    temperature: Math.floor(Math.random() * 30) + 10,
    conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
    paidWith: "EVM (detected payment-signature header)",
    note: "Full EVM verification would happen here via @x402/express",
  });
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
