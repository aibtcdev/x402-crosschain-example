/**
 * Shared Stacks Configuration
 *
 * Common configuration and types used by both Express and Hono middleware.
 * This avoids duplication between the two server implementations.
 */

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
export const TOKEN_CONTRACTS: Record<
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
// Types - v2 Protocol (matching @x402/core specification)
// =============================================================================

/**
 * Resource information for v2 402 response
 */
export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

/**
 * Payment requirements in v2 format (from @x402/core)
 */
export interface PaymentRequirementsV2 {
  scheme: string;
  network: string; // CAIP-2: "stacks:1" or "stacks:2147483648"
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

/**
 * 402 Response body in v2 format
 */
export interface PaymentRequiredV2 {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirementsV2[];
  extensions?: Record<string, unknown>;
}

/**
 * Payment payload sent in Payment-Signature header (v2)
 */
export interface PaymentPayloadV2 {
  x402Version: number;
  resource: ResourceInfo;
  accepted: PaymentRequirementsV2;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/**
 * Facilitator settle response (v2)
 */
export interface FacilitatorSettleResponseV2 {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

// =============================================================================
// Types - Middleware Configuration
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the x402-compliant asset identifier for a token type
 * - STX: "STX" (native token)
 * - sBTC/USDCx: Full contract identifier "address.name::token-name"
 */
export function getAssetIdentifier(
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
 * Get token contract info for a non-STX token
 */
export function getTokenContract(
  tokenType: TokenType,
  network: NetworkType
): TokenContract | undefined {
  if (tokenType === "STX") {
    return undefined;
  }
  return TOKEN_CONTRACTS[network][tokenType as "sBTC" | "USDCx"];
}

/**
 * Safely serialize object with BigInt values to JSON string
 */
export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

/**
 * Default accepted tokens for Stacks payments
 */
export const DEFAULT_ACCEPTED_TOKENS: TokenType[] = ["STX", "sBTC", "USDCx"];

/**
 * Default payment timeout in seconds
 */
export const DEFAULT_TIMEOUT_SECONDS = 300;

// =============================================================================
// v2 Helper Functions
// =============================================================================

/**
 * Decode Payment-Signature header (v2 format: base64-encoded JSON)
 */
export function decodePaymentSignature(header: string): PaymentPayloadV2 {
  const decoded = Buffer.from(header, "base64").toString("utf-8");
  return JSON.parse(decoded);
}

/**
 * Encode payment payload to Payment-Signature header (v2 format)
 */
export function encodePaymentSignature(payload: PaymentPayloadV2): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Build v2 402 response
 */
export interface Build402ResponseV2Options {
  amount: bigint;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  acceptTokens: TokenType[];
}

export function build402ResponseV2(
  options: Build402ResponseV2Options
): PaymentRequiredV2 {
  const {
    amount,
    resource,
    description,
    maxTimeoutSeconds,
    acceptTokens,
  } = options;

  return {
    x402Version: 2,
    error: "Payment Required",
    resource: {
      url: resource,
      description,
      mimeType: "application/json",
    },
    accepts: acceptTokens.map((tokenType) => ({
      scheme: "exact",
      network: STACKS_NETWORK_IDS[stacksConfig.network],
      asset: getAssetIdentifier(tokenType, stacksConfig.network),
      amount: amount.toString(),
      payTo: stacksConfig.payTo,
      maxTimeoutSeconds,
      extra: {
        facilitator: stacksConfig.facilitatorUrl,
        tokenType,
        acceptedTokens: acceptTokens,
      },
    })),
  };
}

/**
 * Call v2 facilitator settle endpoint
 */
export async function settleWithFacilitatorV2(
  paymentPayload: PaymentPayloadV2,
  paymentRequirements: PaymentRequirementsV2
): Promise<FacilitatorSettleResponseV2> {
  const response = await fetch(`${stacksConfig.facilitatorUrl}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Facilitator settle failed: ${response.status} - ${error}`);
  }

  return response.json();
}
