# Getting Started with Stacks x402

New to x402? This guide walks you through building a Stacks payment endpoint from scratch.

## What is x402?

x402 is a protocol for HTTP payments. Instead of API keys, clients pay per request:

```
1. Client requests a resource
2. Server returns 402 Payment Required with pricing
3. Client signs a payment transaction
4. Client retries with payment header
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

// Initialize verifier
const verifier = new X402PaymentVerifier({
  network: process.env.STACKS_NETWORK || "testnet",
  facilitatorUrl: process.env.STACKS_FACILITATOR_URL,
  payTo: process.env.SERVER_ADDRESS_STACKS,
});

// Your paid endpoint
app.get("/api/data", async (req, res) => {
  const payment = req.header("x-payment");

  // No payment? Return 402 with requirements
  if (!payment) {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        {
          scheme: "exact",
          network: "stacks:2147483648",              // Testnet
          maxAmountRequired: "1000",                 // 0.001 STX
          asset: "STX",
          payTo: process.env.SERVER_ADDRESS_STACKS,
          resource: req.path,
          description: "API data access",
          maxTimeoutSeconds: 300,
          extra: {
            nonce: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            tokenType: "STX",
            acceptedTokens: ["STX"],
            facilitator: process.env.STACKS_FACILITATOR_URL,
          },
        },
      ],
    });
  }

  // Verify and settle payment
  try {
    const result = await verifier.verifyAndSettle({
      signedTransaction: payment,
      expectedAmount: 1000n,
      tokenType: req.header("x-payment-token-type") || "STX",
    });

    return res.json({
      data: "Your premium content here",
      payment: {
        txId: result.txId,
        tokenType: result.tokenType,
        payer: result.payerAddress,
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
#   "x402Version": 1,
#   "error": "Payment Required",
#   "accepts": [{ "network": "stacks:2147483648", ... }]
# }
```

---

## Understanding the 402 Response

The 402 response tells clients how to pay:

```json
{
  "x402Version": 1,
  "error": "Payment Required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "stacks:1",
      "maxAmountRequired": "1000",
      "asset": "STX",
      "payTo": "SP2...",
      "resource": "/api/data",
      "description": "API access",
      "maxTimeoutSeconds": 300,
      "extra": {
        "nonce": "uuid",
        "expiresAt": "2024-01-01T00:00:00Z",
        "tokenType": "STX",
        "acceptedTokens": ["STX", "sBTC"],
        "facilitator": "https://facilitator.stacksx402.com"
      }
    }
  ]
}
```

Key fields:
- `network`: CAIP-2 chain ID (`stacks:1` mainnet, `stacks:2147483648` testnet)
- `maxAmountRequired`: Amount in smallest unit (microSTX)
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

With v2, the token type is embedded in the `extra.tokenType` field of the payment payload.

---

## Protocol Versions

| Version | Header | Status |
|---------|--------|--------|
| v1 | `X-PAYMENT` | ✓ |
| v2 | `Payment-Signature` | ✓ |

Both versions are supported. v2 uses a unified `Payment-Signature` header with base64-encoded JSON payload, matching the Coinbase x402 specification.

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

Make requests to x402 endpoints:

```typescript
import { X402PaymentClient } from "x402-stacks";

const client = new X402PaymentClient({
  network: "testnet",
  privateKey: process.env.STACKS_PRIVATE_KEY,
});

// Auto-handles 402 responses
const data = await client.requestWithPayment("https://api.example.com/data");
```

Or manually:

```typescript
const response = await fetch(url);
if (response.status === 402) {
  const requirements = await response.json();
  const stacksOption = requirements.accepts.find(a => a.network.startsWith("stacks:"));

  if (stacksOption) {
    const signed = await client.signPayment(stacksOption);
    const paid = await fetch(url, {
      headers: { "X-PAYMENT": signed.signedTransaction }
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
