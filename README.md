# x402 Cross-Chain Example

Add **Stacks payment support** to your existing x402 app. Whether you're on **EVM (Base)** or **Solana**, this example shows the integration pattern.

> **Coming from Base or Solana?** Jump to the [Integration Guide](docs/INTEGRATION_GUIDE.md) for step-by-step instructions.

## Quick Start

```bash
# Clone and install
git clone https://github.com/aibtcdev/x402-crosschain-example
cd x402-crosschain-example
npm install

# Configure (copy and edit .env)
cp .env.example .env

# Run server (Express on port 3000)
npm run dev

# Or run Hono server (port 3001)
npm run dev:hono

# Test clients (in another terminal)
npm run client:stacks
npm run client:evm
```

## Framework Support

This repo includes examples for both **Express** and **Hono**:

| Framework | Server | Port | Middleware |
|-----------|--------|------|------------|
| Express | `src/server/` | 3000 | `npm run dev` |
| Hono | `src/server-hono/` | 3001 | `npm run dev:hono` |

Both implementations return identical x402-compliant 402 responses.

## Why Cross-Chain?

Different networks offer different advantages. Supporting both lets users pay with their preferred assets:

| Feature | EVM (Base) | Stacks |
|---------|------------|--------|
| Settlement | ~2 sec | ~5 sec |
| Tokens | USDC | STX, sBTC, USDCx |
| Finality | L2 sequencer | Bitcoin-anchored |
| Gasless | Paymasters | Sponsor relay |
| Unique value | Fast, cheap USDC | Programmable BTC (sBTC) |

**For AI agents**: Both networks support gasless transactions - Base via paymasters, Stacks via [sponsor relay](https://github.com/aibtcdev/x402-sponsor-relay).

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Your API                               │
│  ┌───────────────────┐                ┌───────────────────┐      │
│  │   EVM Middleware  │                │  Stacks Middleware │      │
│  │  (@x402/express)  │                │   (x402-stacks)    │      │
│  └─────────┬─────────┘                └─────────┬─────────┘      │
└────────────┼────────────────────────────────────┼────────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────┐        ┌─────────────────────────────┐
│    EVM Facilitator     │        │     Stacks Facilitator      │
│  x402.org/facilitator  │        │ facilitator.stacksx402.com  │
└────────────────────────┘        └─────────────────────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────┐        ┌─────────────────────────────┐
│     Base Network       │        │      Stacks Network         │
│        (USDC)          │        │    (STX / sBTC / USDCx)     │
└────────────────────────┘        └─────────────────────────────┘
```

## Adding Stacks to Your x402 App

The integration follows a 3-step pattern:

```
1. CHECK for both payment headers (yours + Stacks "X-PAYMENT")
2. RETURN 402 with both networks in accepts[] array
3. ROUTE to Stacks middleware when X-PAYMENT header present
```

Your existing EVM/Solana clients continue to work unchanged.

**Full integration guide:** [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)

### Quick Example (Express)

```typescript
app.get("/api/data", async (req, res) => {
  const evmPayment = req.header("payment-signature");
  const stacksPayment = req.header("x-payment");

  // No payment? Return 402 with BOTH options
  if (!evmPayment && !stacksPayment) {
    return res.status(402).json({
      x402Version: 1,
      accepts: [
        { scheme: "exact", network: "eip155:84532", /* your EVM config */ },
        { scheme: "exact", network: "stacks:1", /* Stacks config */ },
      ]
    });
  }

  // Route to Stacks if X-PAYMENT header
  if (stacksPayment) {
    return stacksPaymentMiddleware({ amount: 1000n })(req, res, handler);
  }

  // Your existing EVM handler
  evmPaymentMiddleware(req, res, handler);
});
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

### Integration
- **[Integration Guide](docs/INTEGRATION_GUIDE.md)** - Step-by-step for adding Stacks to your app

### Stacks x402 Ecosystem
- [x402-stacks NPM](https://www.npmjs.com/package/x402-stacks) - TypeScript client/server library
- [Stacks Facilitator](https://github.com/x402Stacks/x402-stacks-facilitator) - Payment verification service
- [x402 Spec for Stacks](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_stacks.md) - Protocol specification

### Coinbase x402
- [x402 Protocol](https://www.x402.org/) - Official site
- [x402 GitHub](https://github.com/coinbase/x402) - Reference implementation
- [@x402/express](https://www.npmjs.com/package/@x402/express) - Express middleware

### Solana x402
- [x402-solana](https://github.com/PayAINetwork/x402-solana) - Solana x402 implementation
- [PayAI Starter Templates](https://github.com/PayAINetwork) - Express, Axios, Next.js examples

### Live Examples
- [x402.aibtc.dev](https://x402.aibtc.dev) - Production API accepting Stacks payments
- [stx402.com](https://stx402.com) - Stacks x402 showcase

## License

MIT
