/**
 * EVM Payment Middleware (using Coinbase's @x402/express)
 *
 * This shows how existing x402 apps configure EVM payments.
 * Apps already using this pattern can add Stacks support alongside.
 */

import { Router } from "express";

// =============================================================================
// Configuration
// =============================================================================

export const evmConfig = {
  network: "eip155:84532" as const, // Base Sepolia
  payTo: process.env.SERVER_ADDRESS_EVM || "",
  facilitatorUrl: process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator",
  // USDC on Base Sepolia
  asset: "eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// Route configuration for x402
export const evmRoutes = {
  "GET /evm/weather": {
    price: "$0.001",
    network: evmConfig.network,
    config: {
      description: "Weather data",
    },
  },
  "POST /evm/ai/complete": {
    price: "$0.01",
    network: evmConfig.network,
    config: {
      description: "AI completion",
    },
  },
};

// =============================================================================
// Middleware
// =============================================================================

/**
 * EVM Payment Middleware
 *
 * In a full implementation, this would use:
 *
 * ```typescript
 * import { paymentMiddleware } from "@x402/express";
 * import { getEvmExactSchemeServer } from "@x402/evm/exact/server";
 *
 * const evmServer = getEvmExactSchemeServer({ signer: serverSigner });
 * export const evmPaymentMiddleware = paymentMiddleware(evmRoutes, evmServer);
 * ```
 *
 * For this example, we'll create a simplified version that shows the pattern.
 */
export const evmPaymentMiddleware = Router();

evmPaymentMiddleware.use((req, res, next) => {
  // Check for payment header
  const paymentHeader = req.header("payment-signature") || req.header("x-payment");

  if (!paymentHeader) {
    // Return 402 with payment requirements
    const routeKey = `${req.method} /evm${req.path}`;
    const routeConfig = evmRoutes[routeKey as keyof typeof evmRoutes];

    if (!routeConfig) {
      return next(); // Not a protected route
    }

    return res.status(402).json({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: evmConfig.network,
          maxAmountRequired: routeConfig.price === "$0.001" ? "1000" : "10000",
          resource: req.originalUrl,
          description: routeConfig.config.description,
          payTo: evmConfig.payTo,
          asset: evmConfig.asset,
        },
      ],
      error: "Payment Required",
      message: "X-Payment header with signed transaction required",
    });
  }

  // In a full implementation, this would:
  // 1. Decode the payment payload
  // 2. Verify with the facilitator
  // 3. Settle the payment after successful response

  // For demo purposes, we'll simulate successful verification
  console.log(`[EVM] Payment received: ${paymentHeader.substring(0, 20)}...`);

  // Add payment info to request for downstream handlers
  (req as any).x402 = {
    network: "evm",
    verified: true,
    paymentHeader,
  };

  next();
});

/**
 * Full implementation reference:
 *
 * To properly integrate with Coinbase's x402, you would:
 *
 * 1. Install packages:
 *    npm install @x402/core @x402/evm @x402/express
 *
 * 2. Configure the server:
 *    ```typescript
 *    import { paymentMiddlewareFromConfig } from "@x402/express";
 *    import { FacilitatorClient } from "@x402/core/server";
 *    import { getEvmExactSchemeServer } from "@x402/evm/exact/server";
 *
 *    const facilitator = new FacilitatorClient("https://x402.org/facilitator");
 *    const evmScheme = getEvmExactSchemeServer({ signer: yourServerSigner });
 *
 *    const middleware = paymentMiddlewareFromConfig(
 *      routes,
 *      facilitator,
 *      [{ network: "eip155:84532", server: evmScheme }]
 *    );
 *    ```
 *
 * See: https://github.com/coinbase/x402/tree/main/typescript/packages/http/express
 */
