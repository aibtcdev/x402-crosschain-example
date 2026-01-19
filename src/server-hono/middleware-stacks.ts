/**
 * Stacks Payment Middleware for Hono
 *
 * Hono-native implementation of x402 payment middleware for Stacks.
 * Returns x402-compliant 402 responses per the Stacks scheme specification.
 *
 * Based on: https://github.com/aibtcdev/x402-api/blob/main/src/middleware/x402.ts
 */

import type { Context, MiddlewareHandler } from "hono";
import { X402PaymentVerifier } from "x402-stacks";
import type { TokenType } from "x402-stacks";
import {
  stacksConfig,
  STACKS_NETWORK_IDS,
  getAssetIdentifier,
  getTokenContract,
  safeStringify,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  type StacksPaymentOptions,
  type X402Context,
} from "../shared/stacks-config.js";

// Re-export for use in index.ts
export { stacksConfig, STACKS_NETWORK_IDS };

// Hono Variables type for x402 context
export type X402Variables = {
  x402?: X402Context;
};

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Stacks Payment Middleware for Hono
 *
 * Creates middleware that requires x402 payment on Stacks.
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { stacksPaymentMiddleware } from "./middleware-stacks";
 *
 * const app = new Hono();
 *
 * app.get("/api/data", stacksPaymentMiddleware({ amount: 1000n }), (c) => {
 *   const x402 = c.get("x402");
 *   return c.json({ data: "...", paidWith: x402?.tokenType });
 * });
 * ```
 */
export function stacksPaymentMiddleware<
  E extends { Variables: X402Variables }
>(options: StacksPaymentOptions): MiddlewareHandler<E> {
  const {
    amount,
    description = "Protected resource",
    acceptTokens = DEFAULT_ACCEPTED_TOKENS,
    maxTimeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  } = options;

  return async (c, next) => {
    const signedTx = c.req.header("x-payment");
    const tokenType = (c.req.header("x-payment-token-type") || "STX") as TokenType;

    if (!acceptTokens.includes(tokenType)) {
      return c.json(
        {
          error: "Unsupported token type",
          accepted: acceptTokens,
          requested: tokenType,
        },
        400
      );
    }

    if (!signedTx) {
      return c.json(
        build402Response({
          amount,
          tokenType,
          resource: c.req.path,
          description,
          maxTimeoutSeconds,
          acceptTokens,
        }),
        402
      );
    }

    // Verify payment with facilitator
    const verifier = new X402PaymentVerifier(
      stacksConfig.facilitatorUrl,
      stacksConfig.network
    );

    try {
      const settleResult = await verifier.settlePayment(signedTx, {
        expectedRecipient: stacksConfig.payTo,
        minAmount: amount,
        tokenType,
      });

      if (!settleResult.isValid) {
        console.error("[Stacks] Payment invalid:", settleResult);
        return c.json(
          {
            error: "Payment invalid",
            details: settleResult.validationError,
            code: "PAYMENT_INVALID",
          },
          402
        );
      }

      // Store payment context
      const x402Context: X402Context = {
        network: "stacks",
        verified: true,
        txId: settleResult.txId,
        payerAddress: settleResult.sender,
        tokenType,
        amount: amount.toString(),
      };

      c.set("x402", x402Context);

      // Add response headers
      c.header("X-PAYMENT-RESPONSE", safeStringify(settleResult));
      if (x402Context.payerAddress) {
        c.header("X-PAYER-ADDRESS", x402Context.payerAddress);
      }

      console.log(
        `[Stacks] Payment verified: ${settleResult.txId} from ${x402Context.payerAddress}`
      );

      return next();
    } catch (error) {
      console.error("[Stacks] Payment verification error:", error);
      return c.json(
        {
          error: "Payment verification failed",
          details: error instanceof Error ? error.message : String(error),
          code: "FACILITATOR_ERROR",
        },
        502
      );
    }
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

interface Build402Options {
  amount: bigint;
  tokenType: TokenType;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  acceptTokens: TokenType[];
}

function build402Response(options: Build402Options) {
  const { amount, tokenType, resource, description, maxTimeoutSeconds, acceptTokens } = options;
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + maxTimeoutSeconds * 1000).toISOString();
  const tokenContract = getTokenContract(tokenType, stacksConfig.network);

  return {
    x402Version: 1,
    error: "Payment Required",
    accepts: [
      {
        scheme: "exact",
        network: STACKS_NETWORK_IDS[stacksConfig.network],
        maxAmountRequired: amount.toString(),
        asset: getAssetIdentifier(tokenType, stacksConfig.network),
        payTo: stacksConfig.payTo,
        resource,
        description,
        maxTimeoutSeconds,
        extra: {
          nonce,
          expiresAt,
          tokenType,
          ...(tokenContract && { tokenContract }),
          acceptedTokens: acceptTokens,
          facilitator: stacksConfig.facilitatorUrl,
        },
      },
    ],
  };
}

/**
 * Get x402 context from Hono context
 */
export function getX402Context<E extends { Variables: X402Variables }>(
  c: Context<E>
): X402Context | undefined {
  return c.get("x402");
}
