/**
 * Stacks Payment Middleware (using x402-stacks)
 *
 * This shows how to add Stacks payment support to an x402 app.
 * The pattern mirrors the EVM middleware, making it easy to understand.
 */

import { Request, Response, NextFunction } from "express";
import { X402PaymentVerifier } from "x402-stacks";
import type { NetworkType, TokenType, TokenContract } from "x402-stacks";

// =============================================================================
// Configuration
// =============================================================================

export const stacksConfig = {
  network: (process.env.STACKS_NETWORK || "testnet") as NetworkType,
  payTo: process.env.SERVER_ADDRESS_STACKS || "",
  facilitatorUrl:
    process.env.STACKS_FACILITATOR_URL || "https://facilitator.stacksx402.com",
};

// Token contracts for sBTC and USDCx
const TOKEN_CONTRACTS: Record<
  NetworkType,
  Record<"sBTC" | "USDCx", TokenContract>
> = {
  mainnet: {
    sBTC: {
      address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
      name: "sbtc-token",
    },
    USDCx: {
      address: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE",
      name: "usdcx",
    },
  },
  testnet: {
    sBTC: {
      address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
      name: "sbtc-token",
    },
    USDCx: {
      address: "ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT",
      name: "token-susdc",
    },
  },
};

// =============================================================================
// Types
// =============================================================================

interface StacksPaymentOptions {
  /** Amount in smallest unit (microSTX for STX, satoshis for sBTC) */
  amount: bigint;
  /** Optional: specific token types to accept */
  acceptTokens?: TokenType[];
}

interface X402Context {
  network: "stacks";
  verified: boolean;
  txId?: string;
  payerAddress?: string;
  tokenType?: TokenType;
  amount?: string;
}

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
  const { amount, acceptTokens = ["STX", "sBTC", "USDCx"] } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Check for X-PAYMENT header (Stacks uses this convention)
    const signedTx = req.header("x-payment");

    // Get requested token type (default to STX)
    const tokenTypeHeader = req.header("x-payment-token-type") || "STX";
    const tokenType = tokenTypeHeader as TokenType;

    if (!acceptTokens.includes(tokenType)) {
      return res.status(400).json({
        error: "Unsupported token type",
        accepted: acceptTokens,
        requested: tokenType,
      });
    }

    if (!signedTx) {
      // Return 402 with payment requirements
      const tokenContract =
        tokenType !== "STX"
          ? TOKEN_CONTRACTS[stacksConfig.network][tokenType as "sBTC" | "USDCx"]
          : undefined;

      return res.status(402).json({
        // x402 standard fields
        maxAmountRequired: amount.toString(),
        resource: req.path,
        payTo: stacksConfig.payTo,
        network: stacksConfig.network,
        nonce: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),

        // Stacks-specific fields
        tokenType,
        ...(tokenContract && { tokenContract }),
        acceptedTokens: acceptTokens,

        // Helpful info for clients
        facilitator: stacksConfig.facilitatorUrl,
        message: "X-PAYMENT header with signed Stacks transaction required",
      });
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
      res.setHeader(
        "X-PAYMENT-RESPONSE",
        JSON.stringify(settleResult, (_, v) =>
          typeof v === "bigint" ? v.toString() : v
        )
      );
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

/**
 * Integration Notes:
 *
 * The x402-stacks package provides:
 *
 * Server-side:
 * - X402PaymentVerifier: Verifies and settles payments via facilitator
 * - Middleware helpers: x402PaymentRequired, createPaymentGate, etc.
 *
 * Client-side:
 * - X402PaymentClient: Signs and sends payments
 * - withPaymentInterceptor: Axios/fetch interceptor for automatic payment
 *
 * Key differences from EVM:
 * - Uses X-PAYMENT header (not PAYMENT-SIGNATURE)
 * - Signed transaction is hex-encoded Stacks transaction
 * - Facilitator at facilitator.stacksx402.com
 * - Supports STX, sBTC, and USDCx tokens
 *
 * See: https://www.npmjs.com/package/x402-stacks
 */
