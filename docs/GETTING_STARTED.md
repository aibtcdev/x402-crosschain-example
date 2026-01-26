# Getting Started with Stacks x402

New to x402? This guide walks you through building a Stacks payment endpoint from scratch.

## What is x402?

x402 is a protocol for HTTP payments. Instead of API keys, clients pay per request:

```
1. Client requests a resource
2. Server returns 402 Payment Required with pricing
3. Client signs a payment transaction
4. Client retries with Payment-Signature header
5. Server verifies payment and returns data
```

## Quick Start

```bash
git clone https://github.com/aibtcdev/x402-crosschain-example
cd x402-crosschain-example
npm install
cp .env.example .env  # Add your Stacks address

npm run dev           # Start server
npm run client:stacks # Test payment
```

---

## Building a Stacks x402 Endpoint

### 1. Install Dependencies

```bash
npm install express dotenv x402-stacks
```

### 2. Configure Environment

```bash
# .env
SERVER_ADDRESS_STACKS=SP2YourStacksAddress  # Where payments go
STACKS_NETWORK=testnet                       # testnet or mainnet
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com
```

### 3. Create Your Server

```typescript
// server.ts
import express from "express";
import { config } from "dotenv";
import { X402PaymentVerifier } from "x402-stacks";

config();

const app = express();

// Initialize v2 verifier (just needs facilitator URL)
const verifier = new X402PaymentVerifier(
  process.env.STACKS_FACILITATOR_URL
);

// Your paid endpoint
app.get("/api/data", async (req, res) => {
  const paymentSignature = req.header("payment-signature");

  // No payment? Return v2 402 with requirements
  if (!paymentSignature) {
    return res.status(402).json({
      x402Version: 2,
      error: "Payment Required",
      resource: {
        url: req.path,
        description: "API data access",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: "stacks:2147483648",              // Testnet
          amount: "1000",                            // 0.001 STX
          asset: "STX",
          payTo: process.env.SERVER_ADDRESS_STACKS,
          maxTimeoutSeconds: 300,
          extra: {
            facilitator: process.env.STACKS_FACILITATOR_URL,
            tokenType: "STX",
            acceptedTokens: ["STX"],
          },
        },
      ],
    });
  }

  // Decode and settle payment via facilitator
  try {
    const paymentPayload = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf-8")
    );

    const result = await verifier.settle(paymentPayload, {
      paymentRequirements: paymentPayload.accepted,
    });

    return res.json({
      data: "Your premium content here",
      payment: {
        txId: result.transaction,
        payer: result.payer,
        network: result.network,
      },
    });
  } catch (error) {
    return res.status(402).json({ error: "Payment verification failed" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

### 4. Test It

```bash
# Get 402 response
curl http://localhost:3000/api/data

# Response:
# {
#   "x402Version": 2,
#   "error": "Payment Required",
#   "resource": { "url": "/api/data", ... },
#   "accepts": [{ "network": "stacks:2147483648", "amount": "1000", ... }]
# }
```

---

## Understanding the 402 Response

The v2 402 response tells clients how to pay:

```json
{
  "x402Version": 2,
  "error": "Payment Required",
  "resource": {
    "url": "/api/data",
    "description": "API access",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stacks:1",
      "amount": "1000",
      "asset": "STX",
      "payTo": "SP2...",
      "maxTimeoutSeconds": 300,
      "extra": {
        "tokenType": "STX",
        "acceptedTokens": ["STX", "sBTC"],
        "facilitator": "https://facilitator.stacksx402.com"
      }
    }
  ]
}
```

Key fields:
- `resource`: Describes the protected resource (URL, description, MIME type)
- `network`: CAIP-2 chain ID (`stacks:1` mainnet, `stacks:2147483648` testnet)
- `amount`: Payment amount in smallest unit (microSTX)
- `payTo`: Your wallet address
- `extra.acceptedTokens`: Which tokens you accept

---

## Stacks Tokens

| Token | Description | Use Case |
|-------|-------------|----------|
| `STX` | Native Stacks token | Default, most liquid |
| `sBTC` | Bitcoin on Stacks | BTC-native users |
| `USDCx` | USDC on Stacks | Stablecoin preference |

Accept multiple tokens:

```typescript
extra: {
  acceptedTokens: ["STX", "sBTC", "USDCx"],
  tokenType: "STX",  // Default token
}
```

---

## Network IDs (CAIP-2)

| Network | ID |
|---------|-----|
| Stacks Mainnet | `stacks:1` |
| Stacks Testnet | `stacks:2147483648` |

---

## Gasless Transactions (AI Agents)

For AI agents that can't hold STX for gas, use the [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay):

```typescript
import { makeSTXTokenTransfer } from "@stacks/transactions";

const tx = await makeSTXTokenTransfer({
  recipient,
  amount: 1000n,
  senderKey: privateKey,
  network: "mainnet",
  sponsored: true,   // Enable sponsorship
  fee: 0n,           // Sponsor pays
});

// Submit to relay instead of Stacks directly
await fetch("https://x402-relay.aibtc.com/relay", {
  method: "POST",
  body: JSON.stringify({
    transaction: tx.serialize().toString("hex"),
  })
});
```

---

## Building a Client

Make requests to x402 endpoints using the automatic flow:

```typescript
import { createPaymentClient, privateKeyToAccount } from "x402-stacks";

const account = privateKeyToAccount(process.env.STACKS_PRIVATE_KEY!, "testnet");
const client = createPaymentClient(account, {
  baseURL: "https://api.example.com",
});

// Automatic v2 flow: handles 402 -> sign -> retry
const response = await client.get("/data");
console.log(response.data);
```

Or manually:

```typescript
const response = await fetch(url);
if (response.status === 402) {
  const requirements = await response.json();
  const stacksOption = requirements.accepts.find(
    (a) => a.network.startsWith("stacks:")
  );

  if (stacksOption) {
    // Sign and build v2 payload
    const signed = await client.signPayment(v1FormatFromV2(stacksOption));
    const payload = {
      x402Version: 2,
      resource: requirements.resource,
      accepted: stacksOption,
      payload: { transaction: signed.signedTransaction },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");

    const paid = await fetch(url, {
      headers: { "Payment-Signature": header },
    });
  }
}
```

---

## Next Steps

### Add Other Networks

Want to accept EVM or Solana payments too?
- [Add Stacks to EVM app](FROM_EVM.md) - Shows the pattern in reverse
- [Add Stacks to Solana app](FROM_SOLANA.md) - Same pattern

### Resources

- [x402-stacks](https://npmjs.com/package/x402-stacks) - TypeScript library
- [Stacks Facilitator](https://facilitator.stacksx402.com) - Payment verification
- [Stacks x402 Spec](https://github.com/aibtcdev/x402/blob/feature/add-stacks-ecosystem/specs/schemes/exact/scheme_exact_stacks.md)
- [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay) - Gasless transactions
- [x402 Protocol](https://github.com/coinbase/x402) - Protocol specification
