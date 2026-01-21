/**
 * Stacks Client Example (v2 Protocol)
 *
 * Demonstrates how to make x402 v2 payments using the Stacks network.
 * Shows the pattern for using the unified Payment-Signature header format.
 *
 * v2 Changes:
 * - Header: Payment-Signature (base64 JSON) instead of X-PAYMENT
 * - Token type: Embedded in payload instead of separate X-PAYMENT-TOKEN-TYPE header
 * - 402 response: Uses "amount" and "resource" object instead of "maxAmountRequired"
 */

import { config } from "dotenv";
import { X402PaymentClient } from "x402-stacks";
import type { NetworkType, TokenType, X402PaymentRequired } from "x402-stacks";
import {
  type PaymentRequiredV2,
  type PaymentRequirementsV2,
  type PaymentPayloadV2,
  encodePaymentSignature,
} from "../shared/stacks-config.js";

config();

// =============================================================================
// Configuration
// =============================================================================

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const STACKS_NETWORK = (process.env.STACKS_NETWORK || "testnet") as NetworkType;
const STACKS_MNEMONIC = process.env.CLIENT_MNEMONIC_STACKS;
const STACKS_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY_STACKS;

// =============================================================================
// Client Setup
// =============================================================================

function createStacksClient(): X402PaymentClient | null {
  const privateKey = STACKS_PRIVATE_KEY || STACKS_MNEMONIC;

  if (!privateKey) {
    console.log("[Stacks Client] No credentials configured");
    return null;
  }

  return new X402PaymentClient({
    network: STACKS_NETWORK,
    privateKey,
  });
}

// =============================================================================
// Payment Functions
// =============================================================================

/**
 * Find the Stacks payment option from a v2 402 response
 * Matches by network prefix "stacks:" and optionally by token type
 */
function findStacksOption(
  paymentRequired: PaymentRequiredV2,
  tokenType: TokenType = "STX"
): PaymentRequirementsV2 | undefined {
  return paymentRequired.accepts.find((option) => {
    if (!option.network.startsWith("stacks:")) return false;
    // Match token type from extra field if specified
    const optionToken = (option.extra?.tokenType as string) || "STX";
    return optionToken === tokenType;
  });
}

/**
 * Convert CAIP-2 network ID to x402-stacks NetworkType
 */
function caip2ToNetworkType(network: string): NetworkType {
  if (network === "stacks:1") return "mainnet";
  if (network === "stacks:2147483648") return "testnet";
  // Default to configured network
  return STACKS_NETWORK;
}

/**
 * Convert v2 payment requirements to v1 format for x402-stacks signing
 * The x402-stacks client still uses v1 format internally for signing
 */
function convertToV1ForSigning(
  option: PaymentRequirementsV2,
  resource: PaymentRequiredV2["resource"]
): X402PaymentRequired {
  return {
    network: caip2ToNetworkType(option.network),
    maxAmountRequired: option.amount,
    payTo: option.payTo,
    resource: resource.url,
    tokenType: (option.extra?.tokenType as TokenType) || "STX",
    nonce: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + option.maxTimeoutSeconds * 1000).toISOString(),
  };
}

/**
 * Make a Stacks payment request (v2 Protocol)
 *
 * This demonstrates the full v2 flow:
 * 1. Request endpoint → Get 402 with v2 payment requirements
 * 2. Find Stacks option from accepts[] array
 * 3. Sign payment transaction with x402-stacks
 * 4. Build v2 payload and base64 encode
 * 5. Retry request with Payment-Signature header
 */
async function makeStacksPaymentRequest(
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    tokenType?: TokenType;
  } = {}
) {
  const { method = "GET", body, tokenType = "STX" } = options;
  const client = createStacksClient();

  console.log(`\n[Stacks Client v2] Making ${method} request to ${endpoint}`);
  console.log(`[Stacks Client v2] Token type: ${tokenType}`);

  // Step 1: Make initial request (will get 402)
  console.log("[Stacks Client v2] Step 1: Initial request...");
  const fetchOptions: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }
  const initialResponse = await fetch(`${SERVER_URL}${endpoint}`, fetchOptions);

  if (initialResponse.status !== 402) {
    // Either free endpoint or already paid
    return initialResponse.json();
  }

  const paymentRequired: PaymentRequiredV2 = await initialResponse.json();
  console.log("[Stacks Client v2] Step 2: Got v2 402 response");
  console.log("  x402Version:", paymentRequired.x402Version);
  console.log("  Resource:", paymentRequired.resource.url);
  console.log("  Options:", paymentRequired.accepts.length);

  // Find the Stacks option matching our token type
  const stacksOption = findStacksOption(paymentRequired, tokenType);
  if (!stacksOption) {
    console.error("[Stacks Client v2] No Stacks option found for token:", tokenType);
    console.log("  Available options:", paymentRequired.accepts.map((a) => a.network));
    return { error: "No matching Stacks payment option" };
  }

  console.log("  Selected option:");
  console.log("    Network:", stacksOption.network);
  console.log("    Amount:", stacksOption.amount);
  console.log("    Asset:", stacksOption.asset);
  console.log("    PayTo:", stacksOption.payTo);

  // Step 2: Sign payment
  console.log("[Stacks Client v2] Step 3: Signing payment...");

  if (!client) {
    console.log("[Stacks Client v2] No client configured - showing mock flow");
    return {
      note: "Configure CLIENT_MNEMONIC_STACKS or CLIENT_PRIVATE_KEY_STACKS for full flow",
      paymentRequired,
      selectedOption: stacksOption,
    };
  }

  try {
    // Convert v2 to v1 format for x402-stacks signing
    const v1Format = convertToV1ForSigning(stacksOption, paymentRequired.resource);
    const signedPayment = await client.signPayment(v1Format);

    console.log("[Stacks Client v2] Payment signed successfully");
    console.log("  Signed TX length:", signedPayment.signedTransaction.length);

    // Build v2 payload
    const paymentPayload: PaymentPayloadV2 = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: stacksOption,
      payload: { transaction: signedPayment.signedTransaction },
    };

    // Base64 encode for header
    const paymentSignature = encodePaymentSignature(paymentPayload);

    // Step 3: Retry with Payment-Signature header
    console.log("[Stacks Client v2] Step 4: Retrying with Payment-Signature header...");
    const paidFetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Payment-Signature": paymentSignature,
      },
    };
    if (body) {
      paidFetchOptions.body = JSON.stringify(body);
    }
    const paidResponse = await fetch(`${SERVER_URL}${endpoint}`, paidFetchOptions);

    if (!paidResponse.ok) {
      const error = await paidResponse.json();
      console.error("[Stacks Client v2] Payment failed:", error);
      return error;
    }

    // Check for payment response header
    const paymentResponse = paidResponse.headers.get("x-payment-response");
    const payerAddress = paidResponse.headers.get("x-payer-address");

    if (paymentResponse) {
      console.log("[Stacks Client v2] Payment confirmed!");
      console.log("  Payer:", payerAddress);
    }

    return paidResponse.json();
  } catch (error) {
    console.error("[Stacks Client v2] Error:", error);
    throw error;
  }
}

/**
 * Alternative: Use the requestWithPayment helper
 *
 * The X402PaymentClient has a built-in method that handles
 * the entire flow automatically. Note: This still uses v1 format
 * internally - for full v2 support, use the manual flow above.
 */
async function makeStacksPaymentRequestSimple(endpoint: string) {
  const client = createStacksClient();

  if (!client) {
    console.log("[Stacks Client v2] No client configured");
    return null;
  }

  // Note: This uses v1 internally - use manual flow for v2
  return client.requestWithPayment(`${SERVER_URL}${endpoint}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("x402 Stacks Client Example (v2 Protocol)");
  console.log("=".repeat(60));

  console.log("\nConfiguration:");
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Network: ${STACKS_NETWORK}`);
  console.log(`  Credentials: ${STACKS_MNEMONIC || STACKS_PRIVATE_KEY ? "configured" : "not configured"}`);

  try {
    // Test Stacks-only endpoint with STX
    console.log("\n" + "-".repeat(60));
    console.log("Testing Stacks endpoint with STX: /stacks/weather");
    console.log("-".repeat(60));
    const stxResult = await makeStacksPaymentRequest("/stacks/weather?city=Austin", {
      tokenType: "STX",
    });
    console.log("\nResult:", JSON.stringify(stxResult, null, 2));

    // Test Stacks-only endpoint with sBTC
    console.log("\n" + "-".repeat(60));
    console.log("Testing Stacks endpoint with sBTC: /stacks/weather");
    console.log("-".repeat(60));
    const sbtcResult = await makeStacksPaymentRequest("/stacks/weather?city=Seattle", {
      tokenType: "sBTC",
    });
    console.log("\nResult:", JSON.stringify(sbtcResult, null, 2));

    // Test cross-chain endpoint (using Stacks)
    console.log("\n" + "-".repeat(60));
    console.log("Testing cross-chain endpoint: /weather (with Stacks payment)");
    console.log("-".repeat(60));
    const crossChainResult = await makeStacksPaymentRequest("/weather?city=Portland");
    console.log("\nResult:", JSON.stringify(crossChainResult, null, 2));

    // Test POST endpoint
    console.log("\n" + "-".repeat(60));
    console.log("Testing POST endpoint: /stacks/ai/complete");
    console.log("-".repeat(60));
    const aiResult = await makeStacksPaymentRequest("/stacks/ai/complete", {
      method: "POST",
      body: { prompt: "What is the meaning of life?" },
    });
    console.log("\nResult:", JSON.stringify(aiResult, null, 2));
  } catch (error) {
    console.error("\nError:", error);
  }
}

main();

/**
 * v2 Protocol Integration Patterns:
 *
 * 1. Manual v2 flow (shown above):
 *    - Full control over the payment process
 *    - Parse v2 402 response with "resource" and "accepts[]"
 *    - Build v2 PaymentPayloadV2 with signed transaction
 *    - Base64 encode and send in Payment-Signature header
 *
 * 2. v2 Payload Structure:
 *    ```typescript
 *    const paymentPayload: PaymentPayloadV2 = {
 *      x402Version: 2,
 *      resource: paymentRequired.resource,
 *      accepted: selectedOption,  // From accepts[] array
 *      payload: { transaction: signedTx },
 *    };
 *    const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
 *    ```
 *
 * 3. Finding Stacks option from cross-chain 402:
 *    ```typescript
 *    const stacksOption = paymentRequired.accepts.find(
 *      (opt) => opt.network.startsWith("stacks:")
 *    );
 *    ```
 *
 * 4. Converting v2 to v1 for x402-stacks signing:
 *    ```typescript
 *    const v1Format = {
 *      network: "testnet",  // Convert CAIP-2 to NetworkType
 *      maxAmountRequired: stacksOption.amount,  // v2 uses "amount"
 *      payTo: stacksOption.payTo,
 *      resource: resource.url,
 *      tokenType: stacksOption.extra?.tokenType || "STX",
 *      nonce: crypto.randomUUID(),
 *      expiresAt: new Date(...).toISOString(),
 *    };
 *    const signed = await client.signPayment(v1Format);
 *    ```
 *
 * See: https://www.npmjs.com/package/x402-stacks
 */
