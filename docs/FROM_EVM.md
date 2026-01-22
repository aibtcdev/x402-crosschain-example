# Add Stacks to Your EVM/Base App

You have x402 working on Base. This guide shows how to add Stacks payment support.

## What You Have

Using Coinbase's `@x402/express`:

```typescript
import { paymentMiddleware } from "@x402/express";

app.get("/api/data", paymentMiddleware(routes, evmServer), handler);
```

Or a custom implementation checking `Payment-Signature` or `X-PAYMENT` headers.

## What You'll Add

Stacks users will see your endpoint and pay with STX, sBTC, or USDCx. Your existing EVM clients continue working unchanged.

---

## Step 1: Install x402-stacks

```bash
npm install x402-stacks
```

## Step 2: Add Environment Variables

```bash
# Your existing EVM config
SERVER_ADDRESS_EVM=0x...
EVM_FACILITATOR_URL=https://x402.org/facilitator

# NEW: Stacks config
SERVER_ADDRESS_STACKS=SP2YourStacksAddress
STACKS_NETWORK=mainnet  # or testnet
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com
```

## Step 3: Update Your Endpoint

### Before (EVM only)

```typescript
import { paymentMiddleware } from "@x402/express";

app.get("/api/data", paymentMiddleware(routes, evmServer), (req, res) => {
  res.json({ data: "..." });
});
```

### After (EVM + Stacks)

```typescript
import { paymentMiddleware } from "@x402/express";
import { X402PaymentVerifier } from "x402-stacks";

// Initialize Stacks verifier
const stacksVerifier = new X402PaymentVerifier({
  network: process.env.STACKS_NETWORK || "mainnet",
  facilitatorUrl: process.env.STACKS_FACILITATOR_URL,
  payTo: process.env.SERVER_ADDRESS_STACKS,
});

app.get("/api/data", async (req, res, next) => {
  // Check for payment headers
  const evmPayment = req.header("payment-signature");
  const stacksPayment = req.header("x-payment");

  // No payment? Return 402 with both options
  if (!evmPayment && !stacksPayment) {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        // Your existing EVM option
        {
          scheme: "exact",
          network: "eip155:8453",                    // Base mainnet
          maxAmountRequired: "1000",
          asset: "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: process.env.SERVER_ADDRESS_EVM,
          resource: req.path,
          description: "API data access",
          maxTimeoutSeconds: 300,
          extra: { facilitator: "https://x402.org/facilitator" },
        },
        // NEW: Stacks option
        {
          scheme: "exact",
          network: "stacks:1",                       // Stacks mainnet
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
            acceptedTokens: ["STX", "sBTC", "USDCx"],
            facilitator: process.env.STACKS_FACILITATOR_URL,
          },
        },
      ],
    });
  }

  // Route Stacks payments
  if (stacksPayment && (stacksPayment.length > 500 || stacksPayment.startsWith("0x"))) {
    try {
      const result = await stacksVerifier.verifyAndSettle({
        signedTransaction: stacksPayment,
        expectedAmount: 1000n,
        tokenType: req.header("x-payment-token-type") || "STX",
      });
      return res.json({ data: "...", paidWith: "Stacks", txId: result.txId });
    } catch (error) {
      return res.status(402).json({ error: "Stacks payment failed" });
    }
  }

  // EVM payments: use your existing middleware
  paymentMiddleware(routes, evmServer)(req, res, () => {
    res.json({ data: "...", paidWith: "EVM" });
  });
});
```

---

## How It Works

1. **Client requests** `/api/data`
2. **Server returns 402** with both EVM and Stacks payment options
3. **Client chooses** their network and signs a transaction
4. **Client retries** with `Payment-Signature` header (v2 unified format)
5. **Server decodes** payload and routes by network
6. **Facilitator verifies** and settles the payment
7. **Server returns** the data

Your EVM clients see nothing different - they still get their EVM option and pay as before. Stacks clients now have a new option.

---

## Stacks Token Options

Stacks supports multiple tokens. With v2, the token type is embedded in the `extra.tokenType` field of the payment payload:

| Token | Description | Use Case |
|-------|-------------|----------|
| `STX` | Native Stacks token | Default, most liquid |
| `sBTC` | Bitcoin on Stacks | BTC-native users |
| `USDCx` | USDC on Stacks | Stablecoin preference |

Configure which you accept:

```typescript
extra: {
  acceptedTokens: ["STX", "sBTC", "USDCx"],  // All three
  // or
  acceptedTokens: ["STX"],                    // STX only
}
```

---

## Network IDs (CAIP-2)

| Network | Mainnet | Testnet |
|---------|---------|---------|
| Stacks | `stacks:1` | `stacks:2147483648` |
| Base | `eip155:8453` | `eip155:84532` |

---

## Protocol Versions

| Version | Header | EVM | Stacks |
|---------|--------|-----|--------|
| v1 | `X-PAYMENT` | ✓ | ✓ |
| v2 | `Payment-Signature` | ✓ | ✓ |

Coinbase's `@x402/express` handles both versions. Stacks now supports v2 with the unified `Payment-Signature` header (base64-encoded JSON payload).

---

## Gasless Transactions

For AI agents that can't hold gas:

| Network | Mechanism |
|---------|-----------|
| EVM | Paymasters (built into @x402/express) |
| Stacks | [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay) |

---

## Testing

```bash
# Start your server
npm run dev

# Test EVM payment (should work as before)
npm run client:evm

# Test Stacks payment (new)
npm run client:stacks

# Check 402 response shows both networks
curl http://localhost:3000/api/data | jq '.accepts[].network'
# Should show: "eip155:8453" and "stacks:1"
```

---

## Resources

### Stacks x402
- [x402-stacks](https://npmjs.com/package/x402-stacks) - TypeScript library
- [Stacks Facilitator](https://facilitator.stacksx402.com) - Payment verification
- [Stacks x402 Spec](https://github.com/aibtcdev/x402/blob/feature/add-stacks-ecosystem/specs/schemes/exact/scheme_exact_stacks.md)

### EVM / Coinbase
- [x402.org](https://x402.org) - Protocol home
- [@x402/express](https://npmjs.com/package/@x402/express) - Express middleware
- [x402 GitHub](https://github.com/coinbase/x402) - Reference implementation
