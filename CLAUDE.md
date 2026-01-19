# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cross-chain x402 payment example demonstrating how to accept payments on both EVM (Base) and Stacks networks. This is a reference implementation showing how existing x402 apps can add Stacks support with minimal code changes.

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
  - `/stacks/*` - Stacks-only endpoints using `x402-stacks`
  - `/weather` - Cross-chain endpoint accepting either network

- **middleware-evm.ts**: EVM payment middleware (simplified demo; production would use `@x402/express` with `getEvmExactSchemeServer`)

- **middleware-stacks.ts**: Stacks payment middleware using `X402PaymentVerifier` from `x402-stacks`. Supports STX, sBTC, and USDCx tokens.

### Hono Server (`src/server-hono/`)

Hono implementation with identical functionality to Express. Based on [aibtcdev/x402-api](https://github.com/aibtcdev/x402-api).

- **index.ts**: Hono server with same endpoint structure as Express
- **middleware-stacks.ts**: Hono-native Stacks middleware using `c.set("x402", ...)` for context
- **middleware-evm.ts**: Simplified EVM middleware (production would use `@x402/hono`)

### Client (`src/client/`)

- **evm-client.ts**: EVM payment flow demo (production would use `wrapFetchWithPayment` from `@x402/fetch`)

- **stacks-client.ts**: Stacks payment flow using `X402PaymentClient` from `x402-stacks`

## x402 Payment Flow

1. Client requests endpoint → Server returns 402 with payment requirements
2. Client signs transaction (EVM or Stacks)
3. Client retries with payment header (`payment-signature` for EVM, `X-PAYMENT` for Stacks)
4. Server verifies via facilitator and settles payment
5. Server returns data with confirmation headers

## Key Dependencies

- `x402-stacks` - Stacks payment client/verifier
- `@x402/express`, `@x402/hono`, `@x402/fetch`, `@x402/evm` - Coinbase x402 for EVM
- `hono`, `@hono/node-server` - Hono framework

## Environment Variables

```bash
SERVER_ADDRESS_EVM=0x...           # EVM address to receive payments
SERVER_ADDRESS_STACKS=SP...        # Stacks address to receive payments
STACKS_NETWORK=testnet             # testnet or mainnet
EVM_RPC_URL=https://sepolia.base.org
EVM_FACILITATOR_URL=https://x402.org/facilitator
STACKS_FACILITATOR_URL=https://facilitator.stacksx402.com

# Client testing
CLIENT_PRIVATE_KEY_EVM=...
CLIENT_MNEMONIC_STACKS=...
CLIENT_PRIVATE_KEY_STACKS=...
```

## Cross-Chain Detection Pattern

The key pattern for supporting both networks on a single endpoint (see `index.ts:123-180`):

```typescript
const evmPayment = req.header("payment-signature");
const stacksPayment = req.header("x-payment");

if (!evmPayment && !stacksPayment) {
  // Return 402 with BOTH network options
}
if (stacksPayment) {
  // Route to Stacks middleware
}
// Fall through to EVM middleware
```

## Stacks Token Support

Tokens configured in `middleware-stacks.ts:24-48` with mainnet/testnet contracts for sBTC and USDCx. Client specifies token via `X-PAYMENT-TOKEN-TYPE` header.
