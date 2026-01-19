/**
 * Stacks Payment Middleware (using x402-stacks)
 *
 * This shows how to add Stacks payment support to an x402 app.
 * The pattern mirrors the EVM middleware, making it easy to understand.
 *
 * Returns x402-compliant 402 responses per the Stacks scheme specification:
 * https://github.com/coinbase/x402/pull/962
 */

import { Request, Response, NextFunction } from "express";
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
 * Stacks Payment Middleware
 *
 * Creates Express middleware that requires x402 payment on Stacks.
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
    const signedTx = req.header("x-payment");
    const tokenType = (req.header("x-payment-token-type") || "STX") as TokenType;

    if (!acceptTokens.includes(tokenType)) {
      return res.status(400).json({
        error: "Unsupported token type",
        accepted: acceptTokens,
        requested: tokenType,
      });
    }

    if (!signedTx) {
      return res.status(402).json(
        build402Response({
          amount,
          tokenType,
          resource: req.originalUrl || req.path,
          description,
          maxTimeoutSeconds,
          acceptTokens,
        })
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
        return res.status(402).json({
          error: "Payment invalid",
          details: settleResult.validationError,
          code: "PAYMENT_INVALID",
        });
      }

      // Payment verified - add context for downstream handlers
      req.x402 = {
        network: "stacks",
        verified: true,
        txId: settleResult.txId,
        payerAddress: settleResult.sender,
        tokenType,
        amount: amount.toString(),
      };

      // Add response headers
      res.setHeader("X-PAYMENT-RESPONSE", safeStringify(settleResult));
      if (req.x402.payerAddress) {
        res.setHeader("X-PAYER-ADDRESS", req.x402.payerAddress);
      }

      console.log(
        `[Stacks] Payment verified: ${settleResult.txId} from ${req.x402.payerAddress}`
      );

      next();
    } catch (error) {
      console.error("[Stacks] Payment verification error:", error);
      return res.status(502).json({
        error: "Payment verification failed",
        details: error instanceof Error ? error.message : String(error),
        code: "FACILITATOR_ERROR",
      });
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
 * Integration Notes:
 *
 * This middleware returns x402-compliant 402 responses that match the
 * Coinbase x402 specification with Stacks scheme extensions.
 *
 * 402 Response Format:
 * {
 *   "x402Version": 1,
 *   "error": "Payment Required",
 *   "accepts": [{
 *     "scheme": "exact",
 *     "network": "stacks:2147483648",  // CAIP-2 format
 *     "maxAmountRequired": "1000",
 *     "asset": "STX",                  // or full contract ID for SIP-010
 *     "payTo": "SP...",
 *     "resource": "/api/data",
 *     "description": "...",
 *     "maxTimeoutSeconds": 300,
 *     "extra": {                       // Stacks-specific extensions
 *       "nonce": "uuid",
 *       "expiresAt": "ISO-8601",
 *       "tokenType": "STX",
 *       "acceptedTokens": ["STX", "sBTC", "USDCx"],
 *       "facilitator": "https://facilitator.stacksx402.com"
 *     }
 *   }]
 * }
 *
 * Network Identifiers (CAIP-2):
 * - Mainnet: "stacks:1"
 * - Testnet: "stacks:2147483648"
 *
 * Asset Identifiers:
 * - STX: "STX" (native token)
 * - sBTC: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
 * - USDCx: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx"
 *
 * See:
 * - Stacks scheme spec: https://github.com/coinbase/x402/pull/962
 * - x402-stacks npm: https://www.npmjs.com/package/x402-stacks
 * - Facilitator: https://github.com/x402Stacks/x402-stacks-facilitator
 */
