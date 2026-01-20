# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reference implementation for adding **Stacks payment support** to existing x402 apps. Whether developers are on EVM (Base) or Solana, this repo shows the integration pattern for accepting STX, sBTC, and USDCx payments.

## Protocol Versions

The x402 protocol has two versions. All use CAIP-2 chain IDs (`eip155:84532`, `stacks:1`).

| Version | Header |
|---------|--------|
| v1 | `X-PAYMENT` |
| v2 | `Payment-Signature` |

| Network | v1 | v2 | Package |
|---------|----|----|---------|
| EVM (Base) | ✓ | ✓ | `@x402/express` |
| Solana | ✓ | ✓ | `x402-solana` |
| Stacks | ✓ | This week | `x402-stacks` |

Both versions follow the same flow: request → 402 → sign → submit → settle.

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
  - `/evm/*` - v2 EVM-only endpoints using `@x402/express` pattern
  - `/stacks/*` - v1 Stacks-only endpoints using `x402-stacks`
  - `/weather` - Cross-chain endpoint accepting both protocol versions

- **middleware-evm.ts**: v2 EVM payment middleware (simplified demo; production would use `@x402/express`)

- **middleware-stacks.ts**: v1 Stacks payment middleware using `X402PaymentVerifier` from `x402-stacks`. Supports STX, sBTC, and USDCx tokens.

### Hono Server (`src/server-hono/`)

Hono implementation with identical functionality to Express. Based on [aibtcdev/x402-api](https://github.com/aibtcdev/x402-api).

- **index.ts**: Hono server with same endpoint structure as Express
- **middleware-stacks.ts**: Hono-native v1 Stacks middleware using `c.set("x402", ...)` for context
- **middleware-evm.ts**: Simplified v2 EVM middleware (production would use `@x402/hono`)

### Client (`src/client/`)

- **evm-client.ts**: v2 EVM payment flow demo (production would use `wrapFetchWithPayment` from `@x402/fetch`)

- **stacks-client.ts**: v1 Stacks payment flow using `X402PaymentClient` from `x402-stacks`

## x402 Payment Flow

1. Client requests endpoint → Server returns 402 with payment requirements
2. Client signs transaction (EVM or Stacks)
3. Client retries with payment header (v2: `Payment-Signature`, v1: `X-PAYMENT`)
4. Server verifies via facilitator and settles payment
5. Server returns data with confirmation headers

## Key Dependencies

- `x402-stacks` - v1 Stacks payment client/verifier
- `@x402/express`, `@x402/hono`, `@x402/fetch`, `@x402/evm` - v2 Coinbase x402 for EVM
- `hono`, `@hono/node-server` - Hono framework

## Environment Variables

```bash
SERVER_ADDRESS_EVM=0x...           # EVM address to receive payments
SERVER_ADDRESS_STACKS=SP...        # Stacks address to receive payments
STACKS_NETWORK=testnet             # testnet or mainnet
EVM_RPC_URL=https://sepolia.base.org
EVM_FACILITATOR_URL=https://x402.org/facilitator      # v2 facilitator
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com  # v1 facilitator

# Client testing
CLIENT_PRIVATE_KEY_EVM=...
CLIENT_MNEMONIC_STACKS=...
CLIENT_PRIVATE_KEY_STACKS=...
```

## Multi-Version Detection Pattern

The key pattern for supporting both protocol versions on a single endpoint (see `index.ts`):

```typescript
const v2Payment = req.header("payment-signature");  // v2 (EVM, Solana)
const v1Payment = req.header("x-payment");          // v1 (Stacks, others)

if (!v2Payment && !v1Payment) {
  // Return 402 with all network options
}
if (v1Payment) {
  // Route to v1 middleware (Stacks)
}
// Fall through to v2 middleware (EVM)
```

## Stacks Token Support

Tokens configured in `middleware-stacks.ts` with mainnet/testnet contracts for sBTC and USDCx. Client specifies token via `X-PAYMENT-TOKEN-TYPE` header.

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
