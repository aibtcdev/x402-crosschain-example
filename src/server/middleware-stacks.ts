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

// CAIP-2 network identifiers for Stacks
// See: https://github.com/coinbase/x402/pull/962
export const STACKS_NETWORK_IDS: Record<NetworkType, string> = {
  mainnet: "stacks:1",
  testnet: "stacks:2147483648",
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

/**
 * Get the x402-compliant asset identifier for a token type
 * - STX: "STX" (native token)
 * - sBTC/USDCx: Full contract identifier "address.name::token-name"
 */
function getAssetIdentifier(
  tokenType: TokenType,
  network: NetworkType
): string {
  if (tokenType === "STX") {
    return "STX";
  }
  const contract = TOKEN_CONTRACTS[network][tokenType as "sBTC" | "USDCx"];
  // Format: "address.contract-name::token-name" for SIP-010 tokens
  return `${contract.address}.${contract.name}::${contract.name}`;
}

// =============================================================================
// Types
// =============================================================================

interface StacksPaymentOptions {
  /** Amount in smallest unit (microSTX for STX, satoshis for sBTC) */
  amount: bigint;
  /** Human-readable description of the resource */
  description?: string;
  /** Optional: specific token types to accept */
  acceptTokens?: TokenType[];
  /** Payment timeout in seconds (default: 300) */
  maxTimeoutSeconds?: number;
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
  const {
    amount,
    description = "Protected resource",
    acceptTokens = ["STX", "sBTC", "USDCx"],
    maxTimeoutSeconds = 300,
  } = options;

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
      // Return x402-compliant 402 response
      // Format matches Coinbase x402 spec with Stacks scheme extensions
      const nonce = crypto.randomUUID();
      const expiresAt = new Date(
        Date.now() + maxTimeoutSeconds * 1000
      ).toISOString();

      // Build token contract info for extra field
      const tokenContract =
        tokenType !== "STX"
          ? TOKEN_CONTRACTS[stacksConfig.network][tokenType as "sBTC" | "USDCx"]
          : undefined;

      return res.status(402).json({
        x402Version: 1,
        error: "Payment Required",
        accepts: [
          {
            scheme: "exact",
            network: STACKS_NETWORK_IDS[stacksConfig.network],
            maxAmountRequired: amount.toString(),
            asset: getAssetIdentifier(tokenType, stacksConfig.network),
            payTo: stacksConfig.payTo,
            resource: req.originalUrl || req.path,
            description,
            maxTimeoutSeconds,
            extra: {
              // Stacks-specific fields in extra object per spec
              nonce,
              expiresAt,
              tokenType,
              ...(tokenContract && { tokenContract }),
              acceptedTokens: acceptTokens,
              facilitator: stacksConfig.facilitatorUrl,
            },
          },
        ],
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
