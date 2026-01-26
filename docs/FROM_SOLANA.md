# Add Stacks to Your Solana App

You have x402 working on Solana. This guide shows how to add Stacks payment support.

## What You Have

Using the [Solana Foundation template](https://solana.com/developers/templates/x402-template):

```typescript
import { paymentMiddleware } from "x402-next";

export default paymentMiddleware(routes, config);
```

Or using [PayAI's x402-solana](https://github.com/PayAINetwork/x402-solana):

```typescript
import { solanaPaymentMiddleware } from "x402-solana";

app.get("/api/data", solanaPaymentMiddleware(options), handler);
```

## What You'll Add

Stacks users will see your endpoint and pay with STX, sBTC, or USDCx. Your existing Solana clients continue working unchanged.

---

## Step 1: Install x402-stacks

```bash
npm install x402-stacks
```

## Step 2: Add Environment Variables

```bash
# Your existing Solana config
SERVER_ADDRESS_SOLANA=YourSolanaAddress
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# NEW: Stacks config
SERVER_ADDRESS_STACKS=SP2YourStacksAddress
STACKS_NETWORK=mainnet  # or testnet
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com
```

## Step 3: Update Your Endpoint

### Before (Solana only)

```typescript
app.get("/api/data", solanaPaymentMiddleware(options), handler);
```

### After (Solana + Stacks)

```typescript
import { X402PaymentVerifier } from "x402-stacks";

// Initialize Stacks verifier (just needs facilitator URL)
const stacksVerifier = new X402PaymentVerifier(
  process.env.STACKS_FACILITATOR_URL
);

app.get("/api/data", async (req, res, next) => {
  // v2: Check for unified Payment-Signature header
  const paymentSignature = req.header("payment-signature");

  // No payment? Return v2 402 with both options
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
        // Your existing Solana option
        {
          scheme: "exact",
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // Mainnet
          amount: "1000",
          asset: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          payTo: process.env.SERVER_ADDRESS_SOLANA,
          maxTimeoutSeconds: 300,
          extra: { facilitator: "https://x402.org/facilitator" },
        },
        // NEW: Stacks option
        {
          scheme: "exact",
          network: "stacks:1",                       // Stacks mainnet
          amount: "1000",                            // 0.001 STX
          asset: "STX",
          payTo: process.env.SERVER_ADDRESS_STACKS,
          maxTimeoutSeconds: 300,
          extra: {
            facilitator: process.env.STACKS_FACILITATOR_URL,
            tokenType: "STX",
            acceptedTokens: ["STX", "sBTC", "USDCx"],
          },
        },
      ],
    });
  }

  // Decode v2 payload to determine network
  const decoded = JSON.parse(
    Buffer.from(paymentSignature, "base64").toString("utf-8")
  );
  const isStacks = decoded.accepted?.network?.startsWith("stacks:");

  // Route Stacks payments to verifier
  if (isStacks) {
    try {
      const result = await stacksVerifier.settle(decoded, {
        paymentRequirements: decoded.accepted,
      });
      return res.json({ data: "...", paidWith: "Stacks", txId: result.transaction });
    } catch (error) {
      return res.status(402).json({ error: "Stacks payment failed" });
    }
  }

  // Solana payments: use your existing middleware
  solanaPaymentMiddleware(options)(req, res, () => {
    res.json({ data: "...", paidWith: "Solana" });
  });
});
```

---

## How It Works

1. **Client requests** `/api/data`
2. **Server returns 402** with both Solana and Stacks payment options (v2 format)
3. **Client chooses** their network and signs a transaction
4. **Client retries** with `Payment-Signature` header (base64-encoded JSON)
5. **Server decodes** payload and routes by network
6. **Facilitator verifies** and settles the payment
7. **Server returns** the data

Your Solana clients see nothing different - they still get their Solana option and pay as before. Stacks clients now have a new option.

---

## Distinguishing Stacks from Solana Payments

With v2, all networks use the `Payment-Signature` header (base64-encoded JSON). The `accepted.network` field identifies the chain:

```typescript
const decoded = JSON.parse(
  Buffer.from(paymentSignature, "base64").toString("utf-8")
);

if (decoded.accepted?.network?.startsWith("stacks:")) {
  // Stacks payment
} else if (decoded.accepted?.network?.startsWith("solana:")) {
  // Solana payment
}
```

---

## Stacks Token Options

Stacks supports multiple tokens. The token type is embedded in the `extra.tokenType` field:

| Token | Description | Use Case |
|-------|-------------|----------|
| `STX` | Native Stacks token | Default, most liquid |
| `sBTC` | Bitcoin on Stacks | BTC-native users |
| `USDCx` | USDC on Stacks | Stablecoin preference |

Configure which you accept:

```typescript
extra: {
  acceptedTokens: ["STX", "sBTC", "USDCx"],
  tokenType: "STX",  // Default token
}
```

---

## Network IDs (CAIP-2)

| Network | Mainnet | Testnet |
|---------|---------|---------|
| Stacks | `stacks:1` | `stacks:2147483648` |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

---

## Gasless Transactions

| Network | Mechanism |
|---------|-----------|
| Solana | Fee payers (built into x402-solana) |
| Stacks | [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay) |

---

## Testing

```bash
# Start your server
npm run dev

# Test Stacks payment
npm run client:stacks

# Check 402 response shows both networks
curl http://localhost:3000/api/data | jq '.accepts[].network'

# For Solana testing, use your existing Solana client
```

---

## Resources

### Stacks x402
- [x402-stacks](https://npmjs.com/package/x402-stacks) - TypeScript library
- [Stacks Facilitator](https://facilitator.stacksx402.com) - Payment verification
- [Stacks x402 Spec](https://github.com/aibtcdev/x402/blob/feature/add-stacks-ecosystem/specs/schemes/exact/scheme_exact_stacks.md)

### Solana x402
- [Solana x402 Template](https://solana.com/developers/templates/x402-template) - Solana Foundation guide
- [x402-solana](https://github.com/PayAINetwork/x402-solana) - PayAI implementation
- [PayAI Templates](https://github.com/PayAINetwork) - Starter templates
