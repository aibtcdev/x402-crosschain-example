# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reference implementation for adding **Stacks payment support** to existing x402 apps. Whether developers are on EVM (Base) or Solana, this repo shows the integration pattern for accepting STX, sBTC, and USDCx payments.

## Protocol Version

This implementation uses **x402 v2 protocol exclusively**. All networks use the unified `Payment-Signature` header format (base64-encoded JSON).

| Network | v2 | Package |
|---------|----|----|
| EVM (Base) | ✓ | `@x402/express` |
| Solana | ✓ | `x402-solana` |
| Stacks | ✓ | `x402-stacks` |

All networks use CAIP-2 chain IDs (`eip155:84532`, `stacks:1`, `stacks:2147483648`).

## Commands

```bash
npm run dev           # Start Express server with hot reload (port 3000)
npm run dev:hono      # Start Hono server with hot reload (port 3001)
npm run start         # Start Express server without watch
npm run start:hono    # Start Hono server without watch
npm run client:stacks # Run Stacks payment client test
npm run client:evm    # Run EVM payment client test
npm run check         # TypeScript type checking
```

## Architecture

### Express Server (`src/server/`)

- **index.ts**: Express server with three endpoint types:
  - `/evm/*` - EVM-only endpoints using `@x402/express` pattern
  - `/stacks/*` - Stacks-only endpoints using v2 middleware
  - `/weather` - Cross-chain endpoint accepting both EVM and Stacks

- **middleware-evm.ts**: Simplified EVM payment middleware (demo; production would use `@x402/express`)

- **middleware-stacks.ts**: v2 Stacks payment middleware. Decodes `Payment-Signature` header, settles via `X402PaymentVerifier.settle()`. Supports STX, sBTC, and USDCx tokens.

### Hono Server (`src/server-hono/`)

Hono implementation with identical functionality to Express. Based on [aibtcdev/x402-api](https://github.com/aibtcdev/x402-api).

- **index.ts**: Hono server with same endpoint structure as Express
- **middleware-stacks.ts**: Hono-native v2 Stacks middleware using `c.set("x402", ...)` for context
- **middleware-evm.ts**: Simplified EVM middleware (production would use `@x402/hono`)

### Shared (`src/shared/`)

- **stacks-config.ts**: Re-exports v2 types/constants from `x402-stacks`, project-specific configuration, token contracts, and helper functions

### Client (`src/client/`)

- **evm-client.ts**: EVM payment flow demo (production would use `wrapFetchWithPayment` from `@x402/fetch`)

- **stacks-client.ts**: v2 Stacks payment flow. Manual flow (parse v2 402, sign, `encodePaymentPayload()`) and auto flow (`createPaymentClient()` with axios).

## x402 v2 Payment Flow

1. Client requests endpoint → Server returns 402 with v2 payment requirements
2. Client parses `accepts[]` array and selects payment option by network
3. Client signs transaction (uses `x402-stacks` for signing)
4. Client builds v2 `PaymentPayloadV2` and base64 encodes
5. Client retries with `Payment-Signature` header
6. Server decodes payload, routes by network, settles via facilitator
7. Server returns data with confirmation headers

## Key Dependencies

- `x402-stacks` (v2) - Stacks v2 types, `X402PaymentVerifier.settle()`, `createPaymentClient()`, `encodePaymentPayload()`
- `@x402/express`, `@x402/hono`, `@x402/fetch`, `@x402/evm` - v2 Coinbase x402 for EVM
- `hono`, `@hono/node-server` - Hono framework

## Environment Variables

```bash
SERVER_ADDRESS_EVM=0x...           # EVM address to receive payments
SERVER_ADDRESS_STACKS=SP...        # Stacks address to receive payments
STACKS_NETWORK=testnet             # testnet or mainnet
EVM_RPC_URL=https://sepolia.base.org
EVM_FACILITATOR_URL=https://x402.org/facilitator      # v2 facilitator
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com  # v2 facilitator (/settle, /verify)

# Client testing
CLIENT_PRIVATE_KEY_EVM=...
CLIENT_MNEMONIC_STACKS=...
CLIENT_PRIVATE_KEY_STACKS=...
```

## v2 Cross-Chain Routing Pattern

The key pattern for supporting multiple networks on a single endpoint (see `index.ts`):

```typescript
// v2: Unified header for all networks
const paymentSignature = req.header("payment-signature");

if (!paymentSignature) {
  // Return v2 402 with all network options
  return res.status(402).json({
    x402Version: 2,
    resource: { url: req.path, description: "...", mimeType: "application/json" },
    accepts: [
      { scheme: "exact", network: "eip155:84532", amount: "1000", ... },
      { scheme: "exact", network: "stacks:2147483648", amount: "1000", ... },
    ],
  });
}

// Decode payload to determine network
const payload = decodePaymentSignature(paymentSignature);
const isStacks = payload.accepted.network.startsWith("stacks:");

if (isStacks) {
  // Route to Stacks middleware
}
// Fall through to EVM middleware
```

## v2 402 Response Format

```json
{
  "x402Version": 2,
  "error": "Payment Required",
  "resource": {
    "url": "/api/data",
    "description": "Protected resource",
    "mimeType": "application/json"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "stacks:2147483648",
    "asset": "STX",
    "amount": "1000",
    "payTo": "SP...",
    "maxTimeoutSeconds": 300,
    "extra": {
      "facilitator": "https://facilitator.stacksx402.com",
      "tokenType": "STX",
      "acceptedTokens": ["STX", "sBTC", "USDCx"]
    }
  }]
}
```

## v2 Payment-Signature Header

Base64-encoded JSON:

```json
{
  "x402Version": 2,
  "resource": { "url": "/api/data", "description": "...", "mimeType": "..." },
  "accepted": { "scheme": "exact", "network": "stacks:2147483648", "amount": "1000", ... },
  "payload": { "transaction": "0x..." }
}
```

## Stacks Token Support

Tokens configured in `stacks-config.ts` with mainnet/testnet contracts. Token type is embedded in `extra.tokenType` field.

| Token | Description |
|-------|-------------|
| STX | Native Stacks token (default) |
| sBTC | Bitcoin on Stacks |
| USDCx | USDC on Stacks |

## Resources

- [Add Stacks to EVM](docs/FROM_EVM.md) - For Base developers
- [Add Stacks to Solana](docs/FROM_SOLANA.md) - For Solana developers
- [Getting Started](docs/GETTING_STARTED.md) - Build Stacks x402 from scratch
- [x402-stacks NPM](https://www.npmjs.com/package/x402-stacks) - TypeScript client/server
- [Stacks Facilitator](https://github.com/x402Stacks/x402-stacks-facilitator) - Payment verification
- [Sponsor Relay](https://github.com/aibtcdev/x402-sponsor-relay) - Gasless transactions for Stacks
