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

// =============================================================================
// Types
// =============================================================================

export interface StacksPaymentOptions {
  /** Amount in smallest unit (microSTX for STX, satoshis for sBTC) */
  amount: bigint;
  /** Human-readable description of the resource */
  description?: string;
  /** Optional: specific token types to accept */
  acceptTokens?: TokenType[];
  /** Payment timeout in seconds (default: 300) */
  maxTimeoutSeconds?: number;
}

export interface X402Context {
  network: "stacks";
  verified: boolean;
  txId?: string;
  payerAddress?: string;
  tokenType?: TokenType;
  amount?: string;
}

// Hono Variables type for x402 context
export type X402Variables = {
  x402?: X402Context;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the x402-compliant asset identifier for a token type
 */
function getAssetIdentifier(
  tokenType: TokenType,
  network: NetworkType
): string {
  if (tokenType === "STX") {
    return "STX";
  }
  const contract = TOKEN_CONTRACTS[network][tokenType as "sBTC" | "USDCx"];
  return `${contract.address}.${contract.name}::${contract.name}`;
}

/**
 * Safely serialize object with BigInt values
 */
function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

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
    acceptTokens = ["STX", "sBTC", "USDCx"],
    maxTimeoutSeconds = 300,
  } = options;

  return async (c, next) => {
    // Check for X-PAYMENT header
    const signedTx = c.req.header("x-payment");

    // Get requested token type (default to STX)
    const tokenTypeHeader = c.req.header("x-payment-token-type") || "STX";
    const tokenType = tokenTypeHeader as TokenType;

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
      // Return x402-compliant 402 response
      const nonce = crypto.randomUUID();
      const expiresAt = new Date(
        Date.now() + maxTimeoutSeconds * 1000
      ).toISOString();

      const tokenContract =
        tokenType !== "STX"
          ? TOKEN_CONTRACTS[stacksConfig.network][tokenType as "sBTC" | "USDCx"]
          : undefined;

      return c.json(
        {
          x402Version: 1,
          error: "Payment Required",
          accepts: [
            {
              scheme: "exact",
              network: STACKS_NETWORK_IDS[stacksConfig.network],
              maxAmountRequired: amount.toString(),
              asset: getAssetIdentifier(tokenType, stacksConfig.network),
              payTo: stacksConfig.payTo,
              resource: c.req.path,
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
        },
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

/**
 * Get x402 context from Hono context
 */
export function getX402Context<E extends { Variables: X402Variables }>(
  c: Context<E>
): X402Context | undefined {
  return c.get("x402");
}
