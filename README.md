# Quantum Entangler

A BNB miner-style DeFi game with a quantum meme skin. The system is built around two contracts:

- **QuantumQubit (QBIT)** – ERC-20 token with 8% buy/sell taxes that fuel liquidity, the mining contract and dev/marketing.
- **QuantumEntangler** – Ponzi miner logic that accepts BNB, mints/stakes QBIT, and orchestrates referrals, compounding, harvesting and superposition pool mechanics.

## Features

- Dynamic pricing formulas inspired by classic ROI miners (HolyBeans-style `calculateTrade`).
- Three-level referral tree: 10% extra qubits on a recruit's first entangle and 5% of their harvests shared up to three levels.
- Auto liquidity and tax routing for QBIT on PancakeSwap-compatible routers.
- Ability to disentangle (sell stake) with a decay penalty that tops up the superposition reserve.
- Superposition pool controller that can burn 20% of tokens before routing the rest with accumulated BNB to a community wallet.

## Development

Install dependencies, compile, and run the BSC forked integration tests:

```bash
npm install
npx hardhat compile
npx hardhat test
```

> **Note:** the toolchain relies on Hardhat and OpenZeppelin Contracts 5.x.

By default the Hardhat test suite boots against a mocked Pancake router/factory pair so it can run offline. Set
`BSC_FORK_RPC=<your archive RPC>` if you want to replay the tests against a live BSC fork.

To exercise the Vite-based dashboard, install the front-end dependencies and run the dev server:

```bash
cd frontend
npm install
npm run dev
```

The dashboard expects contract addresses for a deployed `QuantumEntangler` and `QuantumQubit` instance on BSC (or any fork that
exposes the PancakeSwap v2 router at the canonical address).


## Deployment flow

1. Deploy `QuantumQubit`, capture its address and ensure you set dev/superposition wallets.
2. Deploy `QuantumEntangler` providing the QBIT address and same treasury wallets.
3. As the QBIT owner call `setEntangler(quantumEntanglerAddress)`.
4. Add liquidity and seed the entangler contract with initial BNB using `seedMarket`.

Enjoy the quantum degen loops.
