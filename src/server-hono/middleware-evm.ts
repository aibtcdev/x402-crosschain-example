/**
 * EVM Payment Middleware for Hono
 *
 * Simplified EVM middleware showing the pattern for Coinbase x402 integration.
 * In production, use @x402/hono for full EVM payment verification.
 */

import type { MiddlewareHandler } from "hono";

// =============================================================================
// Configuration
// =============================================================================

export const evmConfig = {
  network: "eip155:84532" as const, // Base Sepolia
  payTo: process.env.SERVER_ADDRESS_EVM || "",
  facilitatorUrl:
    process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator",
  // USDC on Base Sepolia
  asset: "eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// =============================================================================
// Types
// =============================================================================

export interface EvmPaymentOptions {
  /** Amount in smallest unit (e.g., 1000 = 0.001 USDC with 6 decimals) */
  amount: string;
  /** Human-readable description */
  description?: string;
}

export interface EvmX402Context {
  network: "evm";
  verified: boolean;
  paymentHeader?: string;
}

export type EvmX402Variables = {
  evmX402?: EvmX402Context;
};

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * EVM Payment Middleware for Hono (Simplified)
 *
 * This is a demonstration middleware. For production use, integrate with
 * @x402/hono which provides full payment verification via the EVM facilitator.
 *
 * @example Production setup with @x402/hono:
 * ```typescript
 * import { paymentMiddleware } from "@x402/hono";
 * import { getEvmExactSchemeServer } from "@x402/evm/exact/server";
 *
 * const evmServer = getEvmExactSchemeServer({ signer: serverSigner });
 * app.use("/evm/*", paymentMiddleware(routes, evmServer));
 * ```
 */
export function evmPaymentMiddleware<E extends { Variables: EvmX402Variables }>(
  options: EvmPaymentOptions
): MiddlewareHandler<E> {
  const { amount, description = "Protected resource" } = options;

  return async (c, next) => {
    // Check for payment header (EVM uses both conventions)
    const paymentHeader =
      c.req.header("x-payment") || c.req.header("payment-signature");

    if (!paymentHeader) {
      // Return x402-compliant 402 response
      return c.json(
        {
          x402Version: 1,
          error: "Payment Required",
          accepts: [
            {
              scheme: "exact",
              network: evmConfig.network,
              maxAmountRequired: amount,
              asset: evmConfig.asset,
              payTo: evmConfig.payTo,
              resource: c.req.path,
              description,
              maxTimeoutSeconds: 300,
              extra: {
                facilitator: evmConfig.facilitatorUrl,
              },
            },
          ],
        },
        402
      );
    }

    // In production, verify with @x402/hono facilitator
    // For demo, we simulate successful verification
    console.log(`[EVM] Payment received: ${paymentHeader.substring(0, 20)}...`);

    c.set("evmX402", {
      network: "evm",
      verified: true,
      paymentHeader,
    });

    return next();
  };
}
