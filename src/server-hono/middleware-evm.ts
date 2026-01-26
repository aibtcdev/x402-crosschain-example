/**
 * EVM Payment Middleware for Hono
 *
 * Simplified EVM middleware showing the pattern for Coinbase x402 integration.
 * In production, use @x402/hono for full EVM payment verification.
 */

import type { MiddlewareHandler } from "hono";
import {
  evmConfig,
  type EvmPaymentOptions,
  type EvmX402Context,
} from "../shared/evm-config.js";

// Re-export for use in index.ts
export { evmConfig };

// Hono Variables type for EVM x402 context
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
    const paymentHeader =
      c.req.header("x-payment") || c.req.header("payment-signature");

    if (!paymentHeader) {
      return c.json(
        {
          x402Version: 2,
          error: "Payment Required",
          resource: {
            url: c.req.path,
            description,
            mimeType: "application/json",
          },
          accepts: [
            {
              scheme: "exact",
              network: evmConfig.network,
              amount,
              asset: evmConfig.asset,
              payTo: evmConfig.payTo,
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
