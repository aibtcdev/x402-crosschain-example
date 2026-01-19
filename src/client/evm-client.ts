/**
 * EVM Client Example
 *
 * Demonstrates how to make x402 payments using EVM (Base) network.
 * This is the pattern apps currently use with Coinbase's x402.
 */

import { config } from "dotenv";

config();

// =============================================================================
// Configuration
// =============================================================================

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const EVM_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY_EVM;

// =============================================================================
// Types
// =============================================================================

interface PaymentRequired {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    asset: string;
  }>;
}

// =============================================================================
// EVM Payment Functions
// =============================================================================

/**
 * Make an EVM payment request using @x402/fetch
 *
 * In a full implementation:
 * ```typescript
 * import { wrapFetchWithPayment } from "@x402/fetch";
 * import { createEvmPaymentClient } from "@x402/evm";
 *
 * const evmClient = createEvmPaymentClient({
 *   privateKey: process.env.CLIENT_PRIVATE_KEY_EVM,
 *   network: "base-sepolia",
 * });
 *
 * const x402Fetch = wrapFetchWithPayment(fetch, evmClient);
 *
 * // Then just use it like normal fetch - payments are automatic!
 * const response = await x402Fetch("https://api.example.com/weather");
 * ```
 */
async function makeEvmPaymentRequest(endpoint: string) {
  console.log(`\n[EVM Client] Making request to ${endpoint}`);

  // Step 1: Make initial request (will get 402)
  console.log("[EVM Client] Step 1: Initial request...");
  const initialResponse = await fetch(`${SERVER_URL}${endpoint}`);

  if (initialResponse.status !== 402) {
    // Either free endpoint or already paid
    return initialResponse.json();
  }

  const paymentRequired: PaymentRequired = await initialResponse.json();
  console.log("[EVM Client] Step 2: Got 402 response with payment requirements");
  console.log("  Network:", paymentRequired.accepts?.[0]?.network);
  console.log("  Amount:", paymentRequired.accepts?.[0]?.maxAmountRequired);
  console.log("  PayTo:", paymentRequired.accepts?.[0]?.payTo);

  // Step 2: Sign payment (in real implementation)
  // This would use @x402/evm to create a signed payment payload
  console.log("[EVM Client] Step 3: Signing payment...");

  if (!EVM_PRIVATE_KEY) {
    console.log("[EVM Client] No private key configured - showing mock flow");
    // For demo, we'll create a mock payment signature
    const mockPaymentSignature = Buffer.from(
      JSON.stringify({
        scheme: "exact",
        network: paymentRequired.accepts[0].network,
        payload: {
          signature: "0x_mock_signature_for_demo",
          authorization: {
            from: "0xMockSender",
            to: paymentRequired.accepts[0].payTo,
            value: paymentRequired.accepts[0].maxAmountRequired,
          },
        },
      })
    ).toString("base64");

    // Step 3: Retry with payment
    console.log("[EVM Client] Step 4: Retrying with payment header...");
    const paidResponse = await fetch(`${SERVER_URL}${endpoint}`, {
      headers: {
        "payment-signature": mockPaymentSignature,
      },
    });

    return paidResponse.json();
  }

  // Real implementation with @x402/evm would be:
  // const signedPayment = await evmClient.signPayment(paymentRequired.accepts[0]);
  // const paidResponse = await fetch(endpoint, {
  //   headers: { "payment-signature": signedPayment },
  // });

  console.log("[EVM Client] Full implementation would sign with private key");
  return { note: "Configure CLIENT_PRIVATE_KEY_EVM for full flow" };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("x402 EVM Client Example");
  console.log("=".repeat(60));

  console.log("\nConfiguration:");
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Private Key: ${EVM_PRIVATE_KEY ? "configured" : "not configured"}`);

  try {
    // Test EVM-only endpoint
    console.log("\n" + "-".repeat(60));
    console.log("Testing EVM-only endpoint: /evm/weather");
    console.log("-".repeat(60));
    const evmResult = await makeEvmPaymentRequest("/evm/weather?city=Denver");
    console.log("\nResult:", JSON.stringify(evmResult, null, 2));

    // Test cross-chain endpoint (using EVM)
    console.log("\n" + "-".repeat(60));
    console.log("Testing cross-chain endpoint: /weather (with EVM payment)");
    console.log("-".repeat(60));
    const crossChainResult = await makeEvmPaymentRequest("/weather?city=Miami");
    console.log("\nResult:", JSON.stringify(crossChainResult, null, 2));
  } catch (error) {
    console.error("\nError:", error);
  }
}

main();

/**
 * Full @x402/fetch Integration Example:
 *
 * ```typescript
 * import { wrapFetchWithPayment } from "@x402/fetch";
 * import { createEvmPaymentClient } from "@x402/evm";
 *
 * // Create EVM payment client
 * const evmClient = createEvmPaymentClient({
 *   privateKey: process.env.PRIVATE_KEY,
 *   rpcUrl: "https://sepolia.base.org",
 * });
 *
 * // Wrap fetch with automatic payment handling
 * const x402Fetch = wrapFetchWithPayment(fetch, evmClient);
 *
 * // Use like normal fetch - 402s are handled automatically!
 * async function getWeather(city: string) {
 *   const response = await x402Fetch(`https://api.example.com/weather?city=${city}`);
 *   return response.json();
 * }
 *
 * // The library handles:
 * // 1. Detecting 402 responses
 * // 2. Parsing payment requirements
 * // 3. Signing payment with your private key
 * // 4. Retrying with payment header
 * // 5. Returning the final response
 * ```
 *
 * See: https://github.com/coinbase/x402/tree/main/typescript/packages/http/fetch
 */
