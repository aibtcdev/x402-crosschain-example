/**
 * Stacks Payment Middleware v2 (x402 Protocol v2)
 *
 * This shows how to add Stacks payment support to an x402 app using v2 protocol.
 * Uses the unified Payment-Signature header format matching @x402/core.
 *
 * v2 Changes from v1:
 * - Header: Payment-Signature (base64 JSON) instead of X-PAYMENT (raw hex)
 * - Token type: Embedded in payload.accepted.extra.tokenType instead of X-PAYMENT-TOKEN-TYPE header
 * - 402 response: Uses "amount" and separate "resource" object instead of "maxAmountRequired" inline
 * - Facilitator: /settle endpoint instead of /api/v1/settle
 */

import { Request, Response, NextFunction } from "express";
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

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      x402?: X402Context;
    }
  }
}

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
    const paymentSignature = req.header("payment-signature");

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
      // v2: Call facilitator settle endpoint
      const settleResult = await settleWithFacilitatorV2(
        paymentPayload,
        paymentRequirements
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
      res.setHeader("X-PAYMENT-RESPONSE", safeStringify(settleResult));
      if (req.x402.payerAddress) {
        res.setHeader("X-PAYER-ADDRESS", req.x402.payerAddress);
      }

      console.log(
        `[Stacks v2] Payment verified: ${settleResult.transaction} from ${req.x402.payerAddress}`
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

/**
 * Integration Notes (v2 Protocol):
 *
 * This middleware returns x402-compliant 402 responses matching the
 * Coinbase x402 v2 specification with Stacks scheme extensions.
 *
 * v2 402 Response Format:
 * {
 *   "x402Version": 2,
 *   "error": "Payment Required",
 *   "resource": {
 *     "url": "/api/data",
 *     "description": "Protected resource",
 *     "mimeType": "application/json"
 *   },
 *   "accepts": [{
 *     "scheme": "exact",
 *     "network": "stacks:2147483648",  // CAIP-2 format
 *     "amount": "1000",                // v2: "amount" not "maxAmountRequired"
 *     "asset": "STX",
 *     "payTo": "SP...",
 *     "maxTimeoutSeconds": 300,
 *     "extra": {
 *       "facilitator": "https://facilitator.stacksx402.com",
 *       "tokenType": "STX",
 *       "acceptedTokens": ["STX", "sBTC", "USDCx"]
 *     }
 *   }]
 * }
 *
 * v2 Payment-Signature Header (base64 JSON):
 * {
 *   "x402Version": 2,
 *   "resource": { "url": "...", "description": "...", "mimeType": "..." },
 *   "accepted": { ...selected payment option from accepts[] },
 *   "payload": { "transaction": "0x..." }
 * }
 *
 * Network Identifiers (CAIP-2):
 * - Mainnet: "stacks:1"
 * - Testnet: "stacks:2147483648"
 *
 * See:
 * - Stacks scheme spec: https://github.com/coinbase/x402/pull/962
 * - x402-stacks npm: https://www.npmjs.com/package/x402-stacks
 * - Facilitator: https://github.com/x402Stacks/x402-stacks-facilitator
 */
