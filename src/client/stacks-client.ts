/**
 * Stacks Client Example
 *
 * Demonstrates how to make x402 payments using the Stacks network.
 * Shows the simple pattern for adding Stacks payments to any app.
 */

import { config } from "dotenv";
import { X402PaymentClient } from "x402-stacks";
import type { NetworkType, TokenType, X402PaymentRequired } from "x402-stacks";

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
 * Make a Stacks payment request
 *
 * This demonstrates the full flow:
 * 1. Request endpoint → Get 402 with payment requirements
 * 2. Sign payment transaction with x402-stacks
 * 3. Retry request with X-PAYMENT header
 * 4. Get response with payment confirmation
 */
async function makeStacksPaymentRequest(
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    tokenType?: TokenType;
  } = {}
) {
  const { method = "GET", body, tokenType = "STX" } = options;
  const client = createStacksClient();

  console.log(`\n[Stacks Client] Making ${method} request to ${endpoint}`);
  console.log(`[Stacks Client] Token type: ${tokenType}`);

  // Step 1: Make initial request (will get 402)
  console.log("[Stacks Client] Step 1: Initial request...");
  const initialResponse = await fetch(`${SERVER_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT-TOKEN-TYPE": tokenType,
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (initialResponse.status !== 402) {
    // Either free endpoint or already paid
    return initialResponse.json();
  }

  const paymentRequired: X402PaymentRequired = await initialResponse.json();
  console.log("[Stacks Client] Step 2: Got 402 response with payment requirements");
  console.log("  Network:", paymentRequired.network);
  console.log("  Amount:", paymentRequired.maxAmountRequired);
  console.log("  PayTo:", paymentRequired.payTo);
  console.log("  Token:", paymentRequired.tokenType);
  console.log("  Expires:", paymentRequired.expiresAt);

  // Step 2: Sign payment
  console.log("[Stacks Client] Step 3: Signing payment...");

  if (!client) {
    console.log("[Stacks Client] No client configured - showing mock flow");
    return {
      note: "Configure CLIENT_MNEMONIC_STACKS or CLIENT_PRIVATE_KEY_STACKS for full flow",
      paymentRequired,
    };
  }

  try {
    // Sign the payment (creates a signed Stacks transaction)
    const signedPayment = await client.signPayment(paymentRequired);

    console.log("[Stacks Client] Payment signed successfully");
    console.log("  Signed TX length:", signedPayment.signedTransaction.length);

    // Step 3: Retry with payment
    console.log("[Stacks Client] Step 4: Retrying with X-PAYMENT header...");
    const paidResponse = await fetch(`${SERVER_URL}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": signedPayment.signedTransaction,
        "X-PAYMENT-TOKEN-TYPE": tokenType,
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!paidResponse.ok) {
      const error = await paidResponse.json();
      console.error("[Stacks Client] Payment failed:", error);
      return error;
    }

    // Check for payment response header
    const paymentResponse = paidResponse.headers.get("x-payment-response");
    const payerAddress = paidResponse.headers.get("x-payer-address");

    if (paymentResponse) {
      console.log("[Stacks Client] Payment confirmed!");
      console.log("  Payer:", payerAddress);
    }

    return paidResponse.json();
  } catch (error) {
    console.error("[Stacks Client] Error:", error);
    throw error;
  }
}

/**
 * Alternative: Use the requestWithPayment helper
 *
 * The X402PaymentClient has a built-in method that handles
 * the entire flow automatically:
 */
async function makeStacksPaymentRequestSimple(endpoint: string) {
  const client = createStacksClient();

  if (!client) {
    console.log("[Stacks Client] No client configured");
    return null;
  }

  // This handles everything: 402 detection, signing, retry
  return client.requestWithPayment(`${SERVER_URL}${endpoint}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("x402 Stacks Client Example");
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
 * Integration Patterns:
 *
 * 1. Manual flow (shown above):
 *    - Full control over the payment process
 *    - Good for debugging and custom UIs
 *
 * 2. requestWithPayment helper:
 *    ```typescript
 *    const client = new X402PaymentClient({ network: "testnet", privateKey });
 *    const data = await client.requestWithPayment("https://api.example.com/data");
 *    ```
 *
 * 3. Fetch interceptor (for existing codebases):
 *    ```typescript
 *    import { withPaymentInterceptor } from "x402-stacks";
 *
 *    const x402Fetch = withPaymentInterceptor(fetch, {
 *      network: "testnet",
 *      privateKey,
 *    });
 *
 *    // Use like normal fetch
 *    const response = await x402Fetch("https://api.example.com/data");
 *    ```
 *
 * 4. Axios interceptor:
 *    ```typescript
 *    import { createPaymentClient } from "x402-stacks";
 *    import axios from "axios";
 *
 *    const client = createPaymentClient({ network: "testnet", privateKey });
 *    // Client has axios interceptor built-in
 *    const data = await client.get("https://api.example.com/data");
 *    ```
 *
 * See: https://www.npmjs.com/package/x402-stacks
 */
