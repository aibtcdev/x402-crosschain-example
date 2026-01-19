/**
 * x402 Cross-Chain Example Server (Hono)
 *
 * Demonstrates accepting payments on BOTH EVM (Base) and Stacks networks
 * using the x402 protocol with Hono framework.
 *
 * This is the Hono equivalent of the Express server in src/server/.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "dotenv";

import {
  stacksPaymentMiddleware,
  stacksConfig,
  STACKS_NETWORK_IDS,
  getX402Context,
  type X402Variables,
} from "./middleware-stacks.js";
import {
  evmPaymentMiddleware,
  evmConfig,
  type EvmX402Variables,
} from "./middleware-evm.js";

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
    return c.json({
      city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
      paidWith: "EVM (Base USDC)",
    });
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
    return c.json({
      city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
      paidWith: `Stacks (${x402?.tokenType || "STX"})`,
      txId: x402?.txId,
    });
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
// Cross-Chain Endpoint (accept EITHER network)
// =============================================================================

/**
 * Cross-chain endpoint demonstrating x402-compliant multi-network support.
 *
 * Pattern:
 * 1. Return 402 with accepts array containing BOTH network options
 * 2. Check which payment header format to route accordingly
 */
app.get("/weather", async (c) => {
  const paymentHeader = c.req.header("x-payment");
  const evmPaymentHeader = c.req.header("payment-signature");

  // Detect Stacks payment (longer hex string)
  const isStacksPayment =
    paymentHeader &&
    (paymentHeader.length > 500 || paymentHeader.startsWith("0x"));

  // If no payment, return 402 with BOTH network options
  if (!paymentHeader && !evmPaymentHeader) {
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    return c.json(
      {
        x402Version: 1,
        error: "Payment Required",
        accepts: [
          // EVM option
          {
            scheme: "exact",
            network: evmConfig.network,
            maxAmountRequired: "1000",
            asset: evmConfig.asset,
            payTo: evmConfig.payTo,
            resource: c.req.path,
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
            resource: c.req.path,
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
      },
      402
    );
  }

  // Route based on payment type
  if (isStacksPayment) {
    // Use Stacks middleware
    const middleware = stacksPaymentMiddleware({
      amount: 1000n,
      description: "Weather data for a city",
    });

    // Execute middleware and return response
    let x402Context: ReturnType<typeof getX402Context>;
    await middleware(c, async () => {
      x402Context = getX402Context(c);
    });

    if (!x402Context?.verified) {
      // Middleware already returned error response
      return;
    }

    const city = c.req.query("city") || "San Francisco";
    return c.json({
      city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
      paidWith: `Stacks (${x402Context?.tokenType || "STX"})`,
      txId: x402Context?.txId,
    });
  }

  // EVM payment (simplified verification for demo)
  const city = c.req.query("city") || "San Francisco";
  return c.json({
    city,
    temperature: Math.floor(Math.random() * 30) + 10,
    conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
    paidWith: "EVM (detected payment header)",
    note: "Full EVM verification would use @x402/hono",
  });
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
