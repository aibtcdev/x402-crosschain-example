# Self-Hosting a Stacks Facilitator

By default, this example uses the public Stacks facilitator at `https://facilitator.stacksx402.com`. For production deployments, you may want to run your own facilitator for control, reliability, or privacy.

## Facilitator Options

| Option | Language | Best For |
|--------|----------|----------|
| [x402-stacks-facilitator](https://github.com/x402Stacks/x402-stacks-facilitator) | Go | Lightweight, stateless, single-network |
| [OpenFacilitator](https://github.com/rawgroundbeef/OpenFacilitator) | TypeScript | Multi-tenant, dashboard UI, EVM + Solana + Stacks |

---

## Option 1: x402-stacks-facilitator (Go)

Stateless Go service. No database required. Stacks-only.

### Quick Start

```bash
git clone https://github.com/x402Stacks/x402-stacks-facilitator
cd x402-stacks-facilitator

# Run with Docker
docker-compose up -d

# Or run locally (Go 1.24+)
go run ./cmd/server/main.go
```

Your facilitator runs at `http://localhost:8080`.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/verify` | POST | Verify existing transaction |
| `/settle` | POST | Broadcast and confirm transaction |

### Usage

Update your `.env`:

```bash
STACKS_FACILITATOR_URL=http://localhost:8080
```

---

## Option 2: OpenFacilitator (TypeScript)

Full-featured platform with dashboard UI. Supports EVM, Solana, and Stacks.

### Quick Start

```bash
git clone https://github.com/rawgroundbeef/openfacilitator
cd openfacilitator

# Run with Docker
docker compose up -d
```

- API: `http://localhost:3001`
- Dashboard: `http://localhost:3002`

### Or Use Managed Service

Visit [openfacilitator.io](https://openfacilitator.io):
- **$5/mo** with custom domain and auto-SSL

### Features

- Multi-tenant (host for multiple merchants)
- Dashboard for wallet management
- Supports EVM (Base), Solana, and Stacks
- Built-in authentication (Better Auth)
- PostgreSQL or SQLite

### Stacks Configuration

After deployment, configure Stacks in the dashboard:

1. Go to Networks → Stacks
2. Generate or import a Stacks wallet
3. Select mainnet or testnet

The facilitator wallet receives payments and can be withdrawn via the dashboard.

### Usage

Update your `.env` with your OpenFacilitator instance:

```bash
STACKS_FACILITATOR_URL=https://your-facilitator.example.com
```

---

## Facilitator Flow

```
Client                    Server                    Facilitator
   │                         │                           │
   │── GET /api/data ───────▶│                           │
   │◀── 402 + accepts[] ─────│                           │
   │                         │                           │
   │── sign tx locally ──────│                           │
   │                         │                           │
   │── GET /api/data ───────▶│                           │
   │   + Payment-Signature   │── POST /settle ──────────▶│
   │                         │                           │── broadcast tx
   │                         │                           │── poll for confirm
   │                         │◀── { success, txId } ─────│
   │◀── 200 + data ──────────│                           │
```

The facilitator:
1. Receives the signed transaction from your server
2. Broadcasts it to the Stacks network
3. Polls for confirmation
4. Returns success/failure to your server

---

## Security Considerations

- **HTTPS**: Always use HTTPS in production
- **Rate limiting**: Add rate limiting to prevent abuse
- **Monitoring**: Monitor facilitator health and transaction success rates
- **Wallet security**: For OpenFacilitator, the facilitator wallet holds funds temporarily. Withdraw regularly.

---

## Choosing Between Options

| Consideration | x402-stacks-facilitator | OpenFacilitator |
|---------------|-------------------------|-----------------|
| Setup complexity | Lower | Higher |
| Multi-network | Stacks only | EVM + Solana + Stacks |
| Dashboard | None | Full UI |
| Database | None (stateless) | PostgreSQL/SQLite |
| Multi-tenant | No | Yes |
| Resource usage | Lower | Higher |

For Stacks-only deployments with minimal overhead, use **x402-stacks-facilitator**.

For multi-network support or merchant onboarding, use **OpenFacilitator**.
