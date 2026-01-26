/**
 * Stacks Client Example (v2 Protocol)
 *
 * Demonstrates how to make x402 v2 payments using the Stacks network.
 * Shows two patterns:
 *   1. Manual flow: Full control over the v2 payment process
 *   2. Auto flow: Uses createPaymentClient() for automatic 402 handling
 */

import { config } from "dotenv";
import {
  X402PaymentClient,
  createPaymentClient,
  privateKeyToAccount,
  encodePaymentPayload,
} from "x402-stacks";
import type {
  NetworkType,
  TokenType,
  PaymentRequiredV2,
  PaymentRequirementsV2,
  PaymentPayloadV2,
} from "x402-stacks";
import type { X402PaymentRequiredV1 as X402PaymentRequired } from "x402-stacks";

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
 * The X402PaymentClient.signPayment() still uses v1 format internally
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
 * Make a Stacks payment request (v2 Protocol - Manual Flow)
 *
 * This demonstrates the full v2 flow:
 * 1. Request endpoint -> Get 402 with v2 payment requirements
 * 2. Find Stacks option from accepts[] array
 * 3. Sign payment transaction with X402PaymentClient
 * 4. Build v2 payload and base64 encode with encodePaymentPayload()
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
    // Convert v2 to v1 format for X402PaymentClient signing
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

    // Base64 encode using x402-stacks helper
    const paymentSignature = encodePaymentPayload(paymentPayload);

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
    const paymentResponse = paidResponse.headers.get("payment-response");
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
 * Alternative: Use createPaymentClient() for automatic v2 flow
 *
 * The x402-stacks v2 package provides createPaymentClient() which wraps
 * an axios instance with automatic 402 handling. This handles the entire
 * v2 flow (decode 402, sign, encode payload, retry) automatically.
 */
async function makeStacksPaymentRequestSimple(endpoint: string) {
  const privateKey = STACKS_PRIVATE_KEY || STACKS_MNEMONIC;

  if (!privateKey) {
    console.log("[Stacks Client v2] No client configured");
    return null;
  }

  // Create account and payment client (axios-based, automatic 402 handling)
  const account = privateKeyToAccount(privateKey, STACKS_NETWORK);
  const client = createPaymentClient(account, {
    baseURL: SERVER_URL,
  });

  // Automatic v2 flow: handles 402 -> sign -> retry internally
  const response = await client.get(endpoint);
  return response.data;
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
