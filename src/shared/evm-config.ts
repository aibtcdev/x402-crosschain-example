/**
 * Shared EVM Configuration
 *
 * Common configuration used by both Express and Hono middleware.
 */

// =============================================================================
// Configuration
// =============================================================================

export const evmConfig = {
  network: "eip155:84532" as const, // Base Sepolia
  payTo: process.env.SERVER_ADDRESS_EVM || "",
  facilitatorUrl:
    process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator",
  // USDC on Base Sepolia
  asset: "eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// =============================================================================
// Types
// =============================================================================

export interface EvmPaymentOptions {
  /** Amount in smallest unit (e.g., 1000 = 0.001 USDC with 6 decimals) */
  amount: string;
  /** Human-readable description */
  description?: string;
}

export interface EvmX402Context {
  network: "evm";
  verified: boolean;
  paymentHeader?: string;
}
