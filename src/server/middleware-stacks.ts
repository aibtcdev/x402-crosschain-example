/**
 * Stacks Payment Middleware v2 (x402 Protocol v2)
 *
 * This shows how to add Stacks payment support to an x402 app using v2 protocol.
 * Uses the unified Payment-Signature header format matching @x402/core.
 *
 * Settlement is handled by x402-stacks X402PaymentVerifier.settle() which
 * communicates with the facilitator using the correct v2 API format.
 */

import { Request, Response, NextFunction } from "express";
import { X402PaymentVerifier } from "x402-stacks";
import type { TokenType } from "x402-stacks";
import {
  stacksConfig,
  STACKS_NETWORKS,
  X402_HEADERS,
  safeStringify,
  DEFAULT_ACCEPTED_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  decodePaymentSignature,
  build402ResponseV2,
  type StacksPaymentOptions,
  type X402Context,
  type PaymentPayloadV2,
  type PaymentRequirementsV2,
  type SettlementResponseV2,
} from "../shared/stacks-config.js";

// Re-export for use in index.ts
export { stacksConfig, STACKS_NETWORKS, build402ResponseV2 };

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      x402?: X402Context;
    }
  }
}

// Initialize the v2 verifier with facilitator URL
const verifier = new X402PaymentVerifier(stacksConfig.facilitatorUrl);

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Stacks Payment Middleware (v2 Protocol)
 *
 * Creates Express middleware that requires x402 payment on Stacks using v2 protocol.
 *
 * @example
 * ```typescript
 * // Require 1000 microSTX (0.001 STX) payment
 * app.get("/api/data", stacksPaymentMiddleware({ amount: 1000n }), handler);
 *
 * // Accept only sBTC payments
 * app.get("/api/btc", stacksPaymentMiddleware({
 *   amount: 100n,  // 100 satoshis
 *   acceptTokens: ["sBTC"]
 * }), handler);
 * ```
 */
export function stacksPaymentMiddleware(options: StacksPaymentOptions) {
  const {
    amount,
    description = "Protected resource",
    acceptTokens = DEFAULT_ACCEPTED_TOKENS,
    maxTimeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // v2: Use Payment-Signature header (base64 JSON)
    const paymentSignature = req.header(X402_HEADERS.PAYMENT_SIGNATURE);

    if (!paymentSignature) {
      // Return v2 402 response
      return res.status(402).json(
        build402ResponseV2({
          amount,
          resource: req.originalUrl || req.path,
          description,
          maxTimeoutSeconds,
          acceptTokens,
        })
      );
    }

    // v2: Decode base64 JSON payload
    let paymentPayload: PaymentPayloadV2;
    try {
      paymentPayload = decodePaymentSignature(paymentSignature);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid Payment-Signature header",
        details: "Expected base64-encoded JSON payload",
      });
    }

    // Validate x402 version
    if (paymentPayload.x402Version !== 2) {
      return res.status(400).json({
        error: "Invalid x402 version",
        expected: 2,
        received: paymentPayload.x402Version,
      });
    }

    // Extract token type from payload (v2: embedded in extra)
    const tokenType = (paymentPayload.accepted.extra?.tokenType || "STX") as TokenType;

    if (!acceptTokens.includes(tokenType)) {
      return res.status(400).json({
        error: "Unsupported token type",
        accepted: acceptTokens,
        requested: tokenType,
      });
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
      // v2: Settle via X402PaymentVerifier (handles facilitator API format)
      const settleResult: SettlementResponseV2 = await verifier.settle(
        paymentPayload,
        { paymentRequirements }
      );

      if (!settleResult.success) {
        console.error("[Stacks v2] Payment invalid:", settleResult);
        return res.status(402).json({
          error: "Payment invalid",
          details: settleResult.errorReason,
          code: "PAYMENT_INVALID",
        });
      }

      // Payment verified - add context for downstream handlers
      req.x402 = {
        network: "stacks",
        verified: true,
        txId: settleResult.transaction,
        payerAddress: settleResult.payer,
        tokenType,
        amount: amount.toString(),
      };

      // Add response headers
      res.setHeader(X402_HEADERS.PAYMENT_RESPONSE, safeStringify(settleResult));
      if (req.x402.payerAddress) {
        res.setHeader("X-PAYER-ADDRESS", req.x402.payerAddress);
      }

      console.log(
        `[Stacks v2] Payment verified: ${settleResult.transaction} from ${req.x402.payerAddress || "unknown"}`
      );

      next();
    } catch (error) {
      console.error("[Stacks v2] Payment verification error:", error);
      return res.status(502).json({
        error: "Payment verification failed",
        details: error instanceof Error ? error.message : String(error),
        code: "FACILITATOR_ERROR",
      });
    }
  };
}
