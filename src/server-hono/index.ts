/**
 * x402 Cross-Chain Example Server (Hono)
 *
 * This example shows how to add Stacks support to an existing x402 Hono app.
 * If you're coming from EVM (Base) or Solana, the key patterns are:
 *
 * 1. HEADERS: Stacks uses "X-PAYMENT" header (vs "Payment-Signature" for EVM)
 * 2. 402 RESPONSE: Return accepts[] array with BOTH network options
 * 3. ROUTING: Check header format to route to correct middleware
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
} from "../shared/stacks-config.js";

config();

// Combined variables type for cross-chain support
type AppVariables = X402Variables & EvmX402Variables;

const app = new Hono<{ Variables: AppVariables }>();

// =============================================================================
// CORS Configuration
// =============================================================================

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "X-PAYMENT",
      "X-PAYMENT-TOKEN-TYPE",
      "Payment-Signature",
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
// Cross-Chain Endpoint (accept EITHER EVM or Stacks)
// =============================================================================
//
// THIS IS THE KEY PATTERN FOR ADDING STACKS TO YOUR EXISTING x402 HONO APP
//
// If you're coming from:
//   - EVM (Base): You already use "Payment-Signature" header and @x402/hono
//   - Solana: You use similar patterns with x402-solana
//
// To add Stacks support, you need to:
//   1. Check for BOTH header types (Stacks uses "X-PAYMENT")
//   2. Return 402 response with BOTH networks in accepts[] array
//   3. Route to appropriate middleware based on which header is present
// =============================================================================

app.get("/weather", async (c) => {
  // ---------------------------------------------------------------------------
  // STEP 1: Check for payment headers from BOTH networks
  // ---------------------------------------------------------------------------
  // EVM/Base uses: "Payment-Signature" header (from @x402/hono)
  // Solana uses:   Similar header pattern (from x402-solana)
  // Stacks uses:   "X-PAYMENT" header (from x402-stacks)
  // ---------------------------------------------------------------------------
  const evmPayment = c.req.header("payment-signature");
  const stacksPayment = c.req.header("x-payment");

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

    return c.json({
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
          resource: c.req.path,
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
          resource: c.req.path,
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
    }, 402);
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
