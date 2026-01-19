# x402 Cross-Chain Example

Accept payments on **both EVM (Base) and Stacks** networks using the x402 protocol. This example shows how existing x402 apps can add Stacks support with minimal code changes.

## Quick Start

```bash
# Clone and install
git clone https://github.com/aibtcdev/x402-crosschain-example
cd x402-crosschain-example
npm install

# Configure (copy and edit .env)
cp .env.example .env

# Run server
npm run dev

# Test clients (in another terminal)
npm run client:stacks
npm run client:evm
```

## Why Stacks?

| Feature | EVM (Base) | Stacks |
|---------|------------|--------|
| Settlement | ~2 sec | ~30 sec (Bitcoin-secured) |
| Tokens | USDC | STX, sBTC, USDCx |
| Finality | Probabilistic | Bitcoin finality |
| Gasless | No | Yes (sponsor relay) |

**For AI agents**: Stacks offers gasless transactions via sponsor relay, making it ideal for autonomous agent payments.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your API                              │
│  ┌─────────────────┐              ┌─────────────────┐       │
│  │  EVM Middleware │              │ Stacks Middleware│       │
│  │  (@x402/express)│              │  (x402-stacks)  │       │
│  └────────┬────────┘              └────────┬────────┘       │
└───────────┼────────────────────────────────┼────────────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐      ┌───────────────────────┐
│   EVM Facilitator     │      │  Stacks Facilitator   │
│  x402.org/facilitator │      │ facilitator.stacksx402│
└───────────────────────┘      └───────────────────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐      ┌───────────────────────┐
│   Base Network        │      │   Stacks Network      │
│   (USDC)             │      │   (STX/sBTC/USDCx)    │
└───────────────────────┘      └───────────────────────┘
```

## Adding Stacks to Your x402 App

### Server Side (Express)

If you already use `@x402/express`:

```typescript
// Before: EVM only
import { paymentMiddleware } from "@x402/express";
app.use(paymentMiddleware(routes, evmServer));

// After: Add Stacks support
import { stacksPaymentMiddleware } from "./middleware-stacks";

// EVM routes stay the same
app.use("/evm", paymentMiddleware(routes, evmServer));

// Add Stacks routes
app.get("/stacks/weather", stacksPaymentMiddleware({ amount: 1000n }), handler);

// Or: Cross-chain endpoint (accept either)
app.get("/weather", (req, res, next) => {
  const stacksPayment = req.header("x-payment");
  const evmPayment = req.header("payment-signature");

  if (stacksPayment) {
    return stacksPaymentMiddleware({ amount: 1000n })(req, res, next);
  }
  // Fall through to EVM middleware
  return evmMiddleware(req, res, next);
}, handler);
```

### Client Side

**EVM (existing):**
```typescript
import { wrapFetchWithPayment } from "@x402/fetch";
const x402Fetch = wrapFetchWithPayment(fetch, evmClient);
```

**Stacks (new):**
```typescript
import { X402PaymentClient } from "x402-stacks";

const client = new X402PaymentClient({
  network: "mainnet",
  privateKey: process.env.STACKS_PRIVATE_KEY,
});

// Option 1: Auto-handle 402s
const data = await client.requestWithPayment("https://api.example.com/data");

// Option 2: Manual control
const response = await fetch(url);
if (response.status === 402) {
  const requirements = await response.json();
  const signed = await client.signPayment(requirements);
  const paid = await fetch(url, {
    headers: { "X-PAYMENT": signed.signedTransaction }
  });
}
```

## Payment Flow Comparison

### EVM Flow
```
Client                    Server                   Facilitator
  │                         │                          │
  │ GET /api/data           │                          │
  │────────────────────────>│                          │
  │                         │                          │
  │ 402 + payment-required  │                          │
  │<────────────────────────│                          │
  │                         │                          │
  │ Sign with wallet        │                          │
  │                         │                          │
  │ GET + payment-signature │                          │
  │────────────────────────>│ POST /verify            │
  │                         │─────────────────────────>│
  │                         │<─────────────────────────│
  │                         │ POST /settle            │
  │                         │─────────────────────────>│
  │                         │<─────────────────────────│
  │ 200 + data              │                          │
  │<────────────────────────│                          │
```

### Stacks Flow
```
Client                    Server                   Facilitator
  │                         │                          │
  │ GET /api/data           │                          │
  │────────────────────────>│                          │
  │                         │                          │
  │ 402 + payment-required  │                          │
  │<────────────────────────│                          │
  │                         │                          │
  │ Sign STX transaction    │                          │
  │                         │                          │
  │ GET + X-PAYMENT header  │                          │
  │────────────────────────>│ POST /settle            │
  │                         │─────────────────────────>│
  │                         │ (broadcasts & confirms)  │
  │                         │<─────────────────────────│
  │ 200 + data              │                          │
  │<────────────────────────│                          │
```

**Key difference**: Same pattern, different header names and transaction format.

## Endpoints

| Endpoint | Networks | Price | Description |
|----------|----------|-------|-------------|
| `GET /` | - | Free | API info |
| `GET /health` | - | Free | Health check |
| `GET /evm/weather` | EVM | $0.001 | Weather (EVM only) |
| `GET /stacks/weather` | Stacks | 0.001 STX | Weather (Stacks only) |
| `GET /weather` | Both | $0.001 | Weather (cross-chain) |
| `POST /stacks/ai/complete` | Stacks | 0.01 STX | AI completion |

## Configuration

```bash
# Server addresses (where payments are sent)
SERVER_ADDRESS_EVM=0xYourEvmAddress
SERVER_ADDRESS_STACKS=SP2YourStacksAddress

# Network configuration
STACKS_NETWORK=testnet  # or mainnet
EVM_RPC_URL=https://sepolia.base.org

# Facilitator URLs (these are the defaults)
EVM_FACILITATOR_URL=https://x402.org/facilitator
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com

# Client credentials (for testing)
CLIENT_PRIVATE_KEY_EVM=your_evm_private_key
CLIENT_MNEMONIC_STACKS=your twelve word mnemonic phrase
```

## Stacks Token Support

| Token | Description | Contract |
|-------|-------------|----------|
| STX | Native Stacks token | - |
| sBTC | Bitcoin on Stacks | `sbtc-token` |
| USDCx | USDC on Stacks | `usdcx` |

Specify token type with header:
```
X-PAYMENT-TOKEN-TYPE: sBTC
```

## Gasless Transactions (Sponsor Relay)

Stacks supports gasless transactions for AI agents via the sponsor relay:

```typescript
// Build sponsored transaction (fee = 0)
const tx = await makeSTXTokenTransfer({
  recipient,
  amount: 1000000n,
  senderKey: privateKey,
  network: "testnet",
  sponsored: true,  // Key flag
  fee: 0n,          // Sponsor pays gas
});

// Submit to relay (not directly to Stacks)
const response = await fetch("https://x402-relay.aibtc.dev/relay", {
  method: "POST",
  body: JSON.stringify({
    transaction: tx.serialize().toString("hex"),
    settle: { expectedRecipient, minAmount, tokenType }
  })
});
```

See: [x402-sponsor-relay](https://github.com/aibtcdev/x402-sponsor-relay)

## Production Deployments

| Service | Testnet | Mainnet |
|---------|---------|---------|
| x402 API | x402.aibtc.dev | x402.aibtc.com |
| Sponsor Relay | x402-relay.aibtc.dev | x402-relay.aibtc.com |
| Facilitator | facilitator.stacksx402.com | facilitator.stacksx402.com |

## Resources

### Stacks x402 Ecosystem
- [x402-stacks NPM](https://www.npmjs.com/package/x402-stacks) - TypeScript client/server library
- [Stacks Facilitator](https://github.com/x402Stacks/x402-stacks-facilitator) - Payment verification service
- [x402 Spec for Stacks](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_stacks.md) - Protocol specification

### Coinbase x402
- [x402 Protocol](https://www.x402.org/) - Official site
- [x402 GitHub](https://github.com/coinbase/x402) - Reference implementation
- [@x402/express](https://www.npmjs.com/package/@x402/express) - Express middleware

### Live Examples
- [x402.aibtc.dev](https://x402.aibtc.dev) - Production API accepting Stacks payments
- [stx402.com](https://stx402.com) - Stacks x402 showcase

## License

MIT
