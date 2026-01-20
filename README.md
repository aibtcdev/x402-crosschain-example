# Add Stacks to Your x402 App

Add **Stacks payment support** to your existing x402 app. Whether you're on **EVM (Base)** or **Solana**, this example shows the integration pattern.

## Choose Your Starting Point

| You Have | Guide |
|----------|-------|
| EVM/Base app with `@x402/express` | [Add Stacks to EVM](docs/FROM_EVM.md) |
| Solana app with `x402-solana` or `x402-next` | [Add Stacks to Solana](docs/FROM_SOLANA.md) |
| Nothing yet, starting fresh | [Getting Started with Stacks x402](docs/GETTING_STARTED.md) |

## Quick Start

```bash
git clone https://github.com/aibtcdev/x402-crosschain-example
cd x402-crosschain-example
npm install
cp .env.example .env  # Add your Stacks address

npm run dev           # Express (port 3000)
npm run dev:hono      # Hono (port 3001)

npm run client:stacks # Test Stacks payment
```

## Why Stacks?

| Feature | What It Means |
|---------|---------------|
| **sBTC** | Accept Bitcoin directly (programmable BTC on Stacks) |
| **Bitcoin finality** | Transactions anchored to Bitcoin's security |
| **Multiple tokens** | STX, sBTC, USDCx - let users pay how they want |
| **Gasless support** | [Sponsor relay](https://github.com/aibtcdev/x402-sponsor-relay) for AI agents |

## The Pattern

Adding Stacks to an existing x402 endpoint takes 3 steps:

```typescript
// 1. CHECK for Stacks payment header
const stacksPayment = req.header("x-payment");

// 2. ADD Stacks to your 402 response
accepts: [
  { /* your existing EVM/Solana option */ },
  { network: "stacks:1", asset: "STX", ... }  // NEW
]

// 3. ROUTE Stacks payments to x402-stacks middleware
if (stacksPayment) return stacksMiddleware(req, res, next);
```

Your existing clients continue working unchanged. Stacks clients get a new payment option.

## Protocol Versions

| Version | Header | Stacks Support |
|---------|--------|----------------|
| v1 | `X-PAYMENT` | Available now |
| v2 | `Payment-Signature` | Coming soon |

Both versions follow the same flow. See [x402 v1 spec](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md) and [v2 spec](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md).

## Stacks Tokens

| Token | Description |
|-------|-------------|
| STX | Native Stacks token (default) |
| sBTC | Bitcoin on Stacks |
| USDCx | USDC on Stacks |

## Resources

### Stacks x402
- [x402-stacks](https://npmjs.com/package/x402-stacks) - TypeScript client/server
- [Stacks Facilitator](https://facilitator.stacksx402.com) - Payment verification
- [Stacks x402 Spec](https://github.com/aibtcdev/x402/blob/feature/add-stacks-ecosystem/specs/schemes/exact/scheme_exact_stacks.md)
- [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay) - Gasless transactions

### x402 Protocol
- [x402.org](https://x402.org) - Protocol home
- [Coinbase x402](https://github.com/coinbase/x402) - Reference implementation

### Other Networks
- [Solana x402 Template](https://solana.com/developers/templates/x402-template) - Solana Foundation
- [x402-solana](https://github.com/PayAINetwork/x402-solana) - PayAI

### Live Examples
- [x402.aibtc.dev](https://x402.aibtc.dev) - Testnet API
- [x402.aibtc.com](https://x402.aibtc.com) - Mainnet API

## License

MIT
