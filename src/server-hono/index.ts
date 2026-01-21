/**
 * x402 Cross-Chain Example Server (Hono) - v2 Protocol
 *
 * This example shows how to add Stacks support to an existing x402 Hono app using v2 protocol.
 * Both EVM and Stacks now use the unified "Payment-Signature" header format.
 *
 * v2 Key Changes:
 * - Header: Unified "Payment-Signature" for all networks (base64 JSON)
 * - 402 response: Uses "amount" and separate "resource" object
 * - Routing: Based on decoded payload's "network" field (CAIP-2 format)
 *
 * This is the Hono equivalent of the Express server in src/server/.
 * See docs/INTEGRATION_GUIDE.md for step-by-step integration instructions.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "dotenv";

import {
  stacksPaymentMiddleware,
  stacksConfig,
  getX402Context,
  type X402Variables,
} from "./middleware-stacks.js";
import {
  evmPaymentMiddleware,
  evmConfig,
  type EvmX402Variables,
} from "./middleware-evm.js";
import { createWeatherResponse } from "../shared/mock-data.js";
import {
  STACKS_NETWORK_IDS,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  decodePaymentSignature,
  getAssetIdentifier,
} from "../shared/stacks-config.js";

config();

// Combined variables type for cross-chain support
type AppVariables = X402Variables & EvmX402Variables;

const app = new Hono<{ Variables: AppVariables }>();

// =============================================================================
// CORS Configuration (v2: unified headers)
// =============================================================================

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Payment-Signature", // v2: unified header for all networks
      "Content-Type",
    ],
    exposeHeaders: ["X-PAYMENT-RESPONSE", "X-PAYER-ADDRESS"],
  })
);

// =============================================================================
// Health & Info Endpoints (free)
// =============================================================================

app.get("/", (c) => {
  return c.json({
    name: "x402 Cross-Chain Example (Hono)",
    description:
      "Pay-per-use API accepting both EVM (Base) and Stacks payments",
    framework: "Hono",
    networks: {
      evm: {
        network: evmConfig.network,
        payTo: evmConfig.payTo || "not-configured",
        facilitator: evmConfig.facilitatorUrl,
      },
      stacks: {
        network: STACKS_NETWORK_IDS[stacksConfig.network],
        payTo: stacksConfig.payTo || "not-configured",
        facilitator: stacksConfig.facilitatorUrl,
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
        networks: ["Stacks (STX, sBTC, USDCx)"],
        description: "AI text completion",
      },
    },
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =============================================================================
// EVM-Only Endpoints
// =============================================================================

app.get(
  "/evm/weather",
  evmPaymentMiddleware({ amount: "1000", description: "Weather data" }),
  (c) => {
    const city = c.req.query("city") || "San Francisco";
    return c.json(createWeatherResponse(city, "EVM (Base USDC)"));
  }
);

// =============================================================================
// Stacks-Only Endpoints
// =============================================================================

app.get(
  "/stacks/weather",
  stacksPaymentMiddleware({
    amount: 1000n,
    description: "Weather data for a city",
  }),
  (c) => {
    const x402 = getX402Context(c);
    const city = c.req.query("city") || "San Francisco";
    const paidWith = `Stacks (${x402?.tokenType || "STX"})`;
    return c.json(createWeatherResponse(city, paidWith, x402?.txId));
  }
);

app.post(
  "/stacks/ai/complete",
  stacksPaymentMiddleware({
    amount: 10000n,
    description: "AI text completion",
  }),
  async (c) => {
    const x402 = getX402Context(c);
    const body = await c.req.json<{ prompt?: string }>();
    return c.json({
      prompt: body.prompt,
      completion: `This is a mock AI response to: "${body.prompt}"`,
      tokens: { input: body.prompt?.length || 0, output: 50 },
      paidWith: `Stacks (${x402?.tokenType || "STX"})`,
      txId: x402?.txId,
    });
  }
);

// =============================================================================
// Cross-Chain Endpoint (accept EITHER EVM or Stacks) - v2 Protocol
// =============================================================================
//
// THIS IS THE KEY PATTERN FOR ADDING STACKS TO YOUR EXISTING x402 HONO APP
//
// v2 simplifies cross-chain support:
//   1. All networks use unified "Payment-Signature" header (base64 JSON)
//   2. Return v2 402 response with "resource" object and "amount" field
//   3. Route based on decoded payload's "network" field (CAIP-2 format)
// =============================================================================

app.get("/weather", async (c) => {
  // ---------------------------------------------------------------------------
  // STEP 1: Check for unified Payment-Signature header (v2)
  // ---------------------------------------------------------------------------
  // v2: All networks use the same header format (base64-encoded JSON)
  // The payload contains the network identifier for routing
  // ---------------------------------------------------------------------------
  const paymentSignature = c.req.header("payment-signature");

  // ---------------------------------------------------------------------------
  // STEP 2: If no payment, return v2 402 with BOTH network options
  // ---------------------------------------------------------------------------
  // v2 format uses separate "resource" object and "amount" instead of inline
  // ---------------------------------------------------------------------------
  if (!paymentSignature) {
    return c.json(
      {
        x402Version: 2,
        error: "Payment Required",
        resource: {
          url: c.req.path,
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
            network: STACKS_NETWORK_IDS[stacksConfig.network], // "stacks:1" or "stacks:2147483648"
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
            network: STACKS_NETWORK_IDS[stacksConfig.network],
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
      },
      402
    );
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
    return c.json(
      {
        error: "Invalid Payment-Signature header",
        details: "Expected base64-encoded JSON payload",
      },
      400
    );
  }

  if (isStacksPayment) {
    // Route to Stacks v2 middleware
    const middleware = stacksPaymentMiddleware({
      amount: 1000n,
      description: "Weather data for a city",
    });

    // Execute middleware and get context
    let x402Context: ReturnType<typeof getX402Context>;
    await middleware(c, async () => {
      x402Context = getX402Context(c);
    });

    if (!x402Context?.verified) {
      // Middleware already returned error response
      return;
    }

    const city = c.req.query("city") || "San Francisco";
    const paidWith = `Stacks (${x402Context?.tokenType || "STX"})`;
    return c.json(createWeatherResponse(city, paidWith, x402Context?.txId));
  }

  // YOUR EXISTING EVM HANDLER (keep as-is, or use @x402/hono middleware)
  // In production, you'd verify via your existing EVM facilitator
  const city = c.req.query("city") || "San Francisco";
  return c.json(
    createWeatherResponse(
      city,
      "EVM (Base)",
      undefined,
      "Production: verify via @x402/hono and EVM facilitator"
    )
  );
});

// =============================================================================
// Start Server
// =============================================================================

const PORT = Number(process.env.PORT) || 3001;

console.log(`\nx402 Cross-Chain Example Server (Hono)`);
console.log(`======================================`);
console.log(`Server running on http://localhost:${PORT}`);
console.log(`\nConfigured Networks:`);
console.log(`  EVM:    ${evmConfig.payTo || "not configured"}`);
console.log(`  Stacks: ${stacksConfig.payTo || "not configured"}`);
console.log(`\nEndpoints:`);
console.log(`  GET  /              - API info (free)`);
console.log(`  GET  /health        - Health check (free)`);
console.log(`  GET  /evm/weather   - EVM-only endpoint`);
console.log(`  GET  /stacks/weather - Stacks-only endpoint`);
console.log(`  GET  /weather       - Cross-chain endpoint`);
console.log(`\n`);

serve({
  fetch: app.fetch,
  port: PORT,
});

export default app;
