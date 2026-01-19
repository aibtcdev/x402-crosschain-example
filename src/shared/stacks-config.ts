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
