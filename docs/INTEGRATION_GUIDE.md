# Adding Stacks to Your x402 App

This guide shows how to add Stacks payment support to your existing x402 application. Whether you're coming from **EVM (Base)** or **Solana**, the integration follows the same pattern.

## Quick Reference

| Component | EVM (Base) | Solana | Stacks |
|-----------|------------|--------|--------|
| **Payment Header** | `Payment-Signature` | Similar | `X-PAYMENT` |
| **Network ID** | `eip155:84532` | Solana chain ID | `stacks:1` (mainnet) |
| **Native Token** | ETH/USDC | SOL/USDC | STX |
| **Server Package** | `@x402/express` | `x402-solana` | `x402-stacks` |
| **Client Package** | `@x402/fetch` | `x402-solana` | `x402-stacks` |
| **Facilitator** | x402.org | PayAI | stacksx402.com |

## The 3-Step Pattern

Adding Stacks support requires three changes to your existing endpoint:

```
1. CHECK for both payment headers (yours + Stacks)
2. RETURN 402 with both network options in accepts[]
3. ROUTE to Stacks middleware when X-PAYMENT header present
```

Your existing EVM/Solana clients continue to work unchanged.

---

## For EVM (Base) Developers

If you're using `@x402/express` or `@x402/hono`:

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
import { stacksPaymentMiddleware } from "x402-stacks/middleware"; // or your middleware

app.get("/api/data", async (req, res, next) => {
  // STEP 1: Check for payment headers from BOTH networks
  const evmPayment = req.header("payment-signature");
  const stacksPayment = req.header("x-payment");

  // STEP 2: No payment? Return 402 with BOTH options
  if (!evmPayment && !stacksPayment) {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        // Your existing EVM option
        {
          scheme: "exact",
          network: "eip155:84532",           // Base Sepolia
          maxAmountRequired: "1000",
          asset: "eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          payTo: process.env.SERVER_ADDRESS_EVM,
          resource: req.path,
          description: "API data access",
          maxTimeoutSeconds: 300,
          extra: { facilitator: "https://x402.org/facilitator" },
        },
        // NEW: Stacks option
        {
          scheme: "exact",
          network: "stacks:1",               // Stacks mainnet (or stacks:2147483648 for testnet)
          maxAmountRequired: "1000",         // microSTX
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
            facilitator: "https://facilitator.stacksx402.com",
          },
        },
      ],
    });
  }

  // STEP 3: Route based on payment type
  if (stacksPayment && (stacksPayment.length > 500 || stacksPayment.startsWith("0x"))) {
    return stacksPaymentMiddleware({ amount: 1000n })(req, res, () => {
      res.json({ data: "...", paidWith: "Stacks" });
    });
  }

  // Fall through to your existing EVM handler
  paymentMiddleware(routes, evmServer)(req, res, () => {
    res.json({ data: "...", paidWith: "EVM" });
  });
});
```

---

## For Solana Developers

If you're using `x402-solana` (like PayAI):

### Before (Solana only)

```typescript
// Your existing Solana x402 endpoint
app.get("/api/data", solanaPaymentMiddleware(options), handler);
```

### After (Solana + Stacks)

```typescript
import { stacksPaymentMiddleware } from "x402-stacks/middleware";

app.get("/api/data", async (req, res, next) => {
  // STEP 1: Check headers
  const solanaPayment = req.header("payment-signature"); // or your Solana header
  const stacksPayment = req.header("x-payment");

  // STEP 2: Return 402 with both options
  if (!solanaPayment && !stacksPayment) {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: [
        // Your existing Solana option
        { /* your current Solana 402 response */ },
        // NEW: Stacks option
        {
          scheme: "exact",
          network: "stacks:1",
          maxAmountRequired: "1000",
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
            facilitator: "https://facilitator.stacksx402.com",
          },
        },
      ],
    });
  }

  // STEP 3: Route based on payment
  if (stacksPayment && (stacksPayment.length > 500 || stacksPayment.startsWith("0x"))) {
    return stacksPaymentMiddleware({ amount: 1000n })(req, res, () => {
      res.json({ data: "...", paidWith: "Stacks" });
    });
  }

  // Your existing Solana handler
  solanaPaymentMiddleware(options)(req, res, next);
});
```

---

## Server-Side: Installing x402-stacks

```bash
npm install x402-stacks
```

### Middleware Setup (Express)

```typescript
import { X402PaymentVerifier } from "x402-stacks";
import type { Request, Response, NextFunction } from "express";

const verifier = new X402PaymentVerifier({
  network: process.env.STACKS_NETWORK || "testnet", // "testnet" or "mainnet"
  facilitatorUrl: "https://facilitator.stacksx402.com",
  payTo: process.env.SERVER_ADDRESS_STACKS,
});

export function stacksPaymentMiddleware(options: { amount: bigint; description?: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const payment = req.header("x-payment");
    const tokenType = req.header("x-payment-token-type") || "STX";

    if (!payment) {
      // Return 402 (handled by your cross-chain logic above)
      return res.status(402).json({ error: "Payment Required" });
    }

    try {
      const result = await verifier.verifyAndSettle({
        signedTransaction: payment,
        expectedAmount: options.amount,
        tokenType,
      });

      // Attach payment info to request for handler
      req.x402 = {
        verified: true,
        txId: result.txId,
        tokenType: result.tokenType,
        payerAddress: result.payerAddress,
      };

      next();
    } catch (error) {
      return res.status(402).json({ error: "Payment verification failed" });
    }
  };
}
```

### Middleware Setup (Hono)

```typescript
import { X402PaymentVerifier } from "x402-stacks";
import type { Context, Next } from "hono";

const verifier = new X402PaymentVerifier({
  network: process.env.STACKS_NETWORK || "testnet",
  facilitatorUrl: "https://facilitator.stacksx402.com",
  payTo: process.env.SERVER_ADDRESS_STACKS,
});

export function stacksPaymentMiddleware(options: { amount: bigint }) {
  return async (c: Context, next: Next) => {
    const payment = c.req.header("x-payment");
    const tokenType = c.req.header("x-payment-token-type") || "STX";

    if (!payment) {
      return c.json({ error: "Payment Required" }, 402);
    }

    try {
      const result = await verifier.verifyAndSettle({
        signedTransaction: payment,
        expectedAmount: options.amount,
        tokenType,
      });

      c.set("x402", {
        verified: true,
        txId: result.txId,
        tokenType: result.tokenType,
      });

      await next();
    } catch (error) {
      return c.json({ error: "Payment verification failed" }, 402);
    }
  };
}
```

---

## Environment Variables

Add these to your `.env`:

```bash
# Your existing config (EVM or Solana)
SERVER_ADDRESS_EVM=0x...
# or
SERVER_ADDRESS_SOLANA=...

# NEW: Add Stacks config
SERVER_ADDRESS_STACKS=SP2YourStacksAddress  # Your Stacks wallet address
STACKS_NETWORK=testnet                       # "testnet" or "mainnet"
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com
```

---

## Stacks Token Support

Stacks supports multiple tokens. Clients specify via `X-PAYMENT-TOKEN-TYPE` header:

| Token | Description | Use Case |
|-------|-------------|----------|
| `STX` | Native Stacks token | Default, most liquid |
| `sBTC` | Bitcoin on Stacks | BTC-native users |
| `USDCx` | USDC on Stacks | Stablecoin payments |

Your 402 response can list which tokens you accept:

```typescript
extra: {
  acceptedTokens: ["STX", "sBTC", "USDCx"], // Accept all three
  // or
  acceptedTokens: ["STX"], // STX only
}
```

---

## Client-Side Integration

If you also need to make Stacks payments as a client:

```typescript
import { X402PaymentClient } from "x402-stacks";

const client = new X402PaymentClient({
  network: "mainnet",
  privateKey: process.env.STACKS_PRIVATE_KEY,
});

// Auto-handle 402 responses
const data = await client.requestWithPayment("https://api.example.com/data");

// Or manual flow
const response = await fetch(url);
if (response.status === 402) {
  const requirements = await response.json();
  // Find Stacks option in accepts[]
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

## Gasless Transactions (AI Agents)

For AI agents that can't hold funds, Stacks supports sponsored (gasless) transactions:

```typescript
import { makeSTXTokenTransfer } from "@stacks/transactions";

const tx = await makeSTXTokenTransfer({
  recipient,
  amount: 1000000n,
  senderKey: privateKey,
  network: "mainnet",
  sponsored: true,  // Enable sponsorship
  fee: 0n,          // Sponsor pays gas
});

// Submit to sponsor relay instead of directly to Stacks
await fetch("https://x402-relay.aibtc.com/relay", {
  method: "POST",
  body: JSON.stringify({
    transaction: tx.serialize().toString("hex"),
    settle: { expectedRecipient, minAmount, tokenType }
  })
});
```

See: [x402-sponsor-relay](https://github.com/aibtcdev/x402-sponsor-relay)

---

## Testing

1. Start your server with both networks configured
2. Test existing flow (should work unchanged)
3. Test Stacks flow:

```bash
# Get 402 response (should show both networks)
curl http://localhost:3000/api/data

# Test with Stacks payment
npm run client:stacks
```

---

## Resources

- [x402-stacks NPM](https://www.npmjs.com/package/x402-stacks) - TypeScript client/server
- [Stacks Facilitator](https://facilitator.stacksx402.com) - Payment verification
- [x402 Spec for Stacks](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_stacks.md)
- [This example repo](https://github.com/aibtcdev/x402-crosschain-example) - Full working examples

## Questions?

- Open an issue on this repo
- Join the [Stacks Discord](https://discord.gg/stacks)
- Check [x402.org](https://x402.org) for general x402 questions
