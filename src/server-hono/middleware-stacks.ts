/**
 * Stacks Payment Middleware for Hono (v2 Protocol)
 *
 * Hono-native implementation of x402 v2 payment middleware for Stacks.
 * Uses the unified Payment-Signature header format matching @x402/core.
 *
 * v2 Changes from v1:
 * - Header: Payment-Signature (base64 JSON) instead of X-PAYMENT (raw hex)
 * - Token type: Embedded in payload.accepted.extra.tokenType instead of X-PAYMENT-TOKEN-TYPE header
 * - 402 response: Uses "amount" and separate "resource" object instead of "maxAmountRequired" inline
 * - Facilitator: /settle endpoint instead of /api/v1/settle
 *
 * Based on: https://github.com/aibtcdev/x402-api/blob/main/src/middleware/x402.ts
 */

import type { Context, MiddlewareHandler } from "hono";
import type { TokenType } from "x402-stacks";
import {
  stacksConfig,
  STACKS_NETWORK_IDS,
  safeStringify,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  decodePaymentSignature,
  build402ResponseV2,
  settleWithFacilitatorV2,
  type StacksPaymentOptions,
  type X402Context,
  type PaymentPayloadV2,
  type PaymentRequirementsV2,
} from "../shared/stacks-config.js";

// Re-export for use in index.ts
export { stacksConfig, STACKS_NETWORK_IDS, build402ResponseV2 };

// Hono Variables type for x402 context
export type X402Variables = {
  x402?: X402Context;
};

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Stacks Payment Middleware for Hono (v2 Protocol)
 *
 * Creates middleware that requires x402 v2 payment on Stacks.
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
    // v2: Use Payment-Signature header (base64 JSON)
    const paymentSignature = c.req.header("payment-signature");

    if (!paymentSignature) {
      // Return v2 402 response
      return c.json(
        build402ResponseV2({
          amount,
          resource: c.req.path,
          description,
          maxTimeoutSeconds,
          acceptTokens,
        }),
        402
      );
    }

    // v2: Decode base64 JSON payload
    let paymentPayload: PaymentPayloadV2;
    try {
      paymentPayload = decodePaymentSignature(paymentSignature);
    } catch (error) {
      return c.json(
        {
          error: "Invalid Payment-Signature header",
          details: "Expected base64-encoded JSON payload",
        },
        400
      );
    }

    // Validate x402 version
    if (paymentPayload.x402Version !== 2) {
      return c.json(
        {
          error: "Invalid x402 version",
          expected: 2,
          received: paymentPayload.x402Version,
        },
        400
      );
    }

    // Extract token type from payload (v2: embedded in extra)
    const tokenType = (paymentPayload.accepted.extra?.tokenType || "STX") as TokenType;

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

    // Build expected payment requirements for verification
    const paymentRequirements: PaymentRequirementsV2 = {
      scheme: "exact",
      network: paymentPayload.accepted.network,
      asset: paymentPayload.accepted.asset,
      amount: amount.toString(),
      payTo: stacksConfig.payTo,
      maxTimeoutSeconds,
      extra: {
        facilitator: stacksConfig.facilitatorUrl,
        tokenType,
        acceptedTokens: acceptTokens,
      },
    };

    try {
      // v2: Call facilitator settle endpoint
      const settleResult = await settleWithFacilitatorV2(
        paymentPayload,
        paymentRequirements
      );

      if (!settleResult.success) {
        console.error("[Stacks v2] Payment invalid:", settleResult);
        return c.json(
          {
            error: "Payment invalid",
            details: settleResult.errorReason,
            code: "PAYMENT_INVALID",
          },
          402
        );
      }

      // Store payment context
      const x402Context: X402Context = {
        network: "stacks",
        verified: true,
        txId: settleResult.transaction,
        payerAddress: settleResult.payer,
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
        `[Stacks v2] Payment verified: ${settleResult.transaction} from ${x402Context.payerAddress || "unknown"}`
      );

      return next();
    } catch (error) {
      console.error("[Stacks v2] Payment verification error:", error);
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

/**
 * Get x402 context from Hono context
 */
export function getX402Context<E extends { Variables: X402Variables }>(
  c: Context<E>
): X402Context | undefined {
  return c.get("x402");
}
