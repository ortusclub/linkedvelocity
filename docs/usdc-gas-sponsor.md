# Central gas wallet for USDC sweeps

Native USDC on Base supports ERC-3009 `transferWithAuthorization`. The deposit
wallet signs a short-lived authorization off-chain. A dedicated gas wallet
submits it and pays the fee. USDC goes directly to `TREASURY_WALLET_ADDRESS`.
Deposit wallets need no ETH, and no ETH top-up transactions are created.

This flow is only for native USDC at
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on chain 8453. Bridged USDT retains
the existing direct-transfer flow and needs deposit-wallet ETH. This change
does not migrate addresses or alter customer credit accounting.

## Configuration and activation

Use the production project mapping in `AGENTS.md`. Keep the feature disabled
while installing/reviewing the code. No schema migration is needed.

1. The operator creates a dedicated gas wallet and stores its private key in
   the production secret store as `GAS_SPONSOR_PRIVATE_KEY`. Never paste the
   key into chat, source code, logs, shell arguments, or this document.
2. Set `GAS_SPONSOR_ADDRESS` to that wallet's public address. The server verifies
   that it matches the signing key. Do not use the receiving wallet's private
   key or reuse the gas signer in other services: nonce coordination here
   covers only LinkedVelocity deposit jobs.
3. The operator funds this one wallet with a small ETH balance on **Base**.
   The main receiving wallet remains address-only. The existing deposit HD
   signing seed is still required to authorize transfers from deposit wallets.
4. Set `GAS_SPONSOR_MAX_FEE_ETH` (default `0.00001`, maximum permitted `0.001`).
   Each sweep checks the buffered execution fee plus buffered L1 fee estimate
   against this limit and against the sponsor's pending ETH balance. This is
   a per-sweep estimate cap, not a cumulative daily spending limit. Keeping a
   small balance in the dedicated wallet bounds its available funds.
5. Set `USDC_GAS_SPONSOR_ENABLED=true` and deploy the reviewed release. Recheck
   the public destination and gas-wallet status in `/admin/treasury`.
6. The admin reviews a credited deposit and clicks **Confirm sweep**. With
   sponsorship enabled, cron jobs continue detecting/crediting deposits but
   skip sponsored USDC sends. Only the explicit admin sweep permits them.

When disabled, the existing direct USDC sweep behavior remains in place,
including scheduled sweeps from already-funded deposit wallets. Disabling
this flag does not pause all deposit processing.

## Safety and recovery

- The existing cross-instance database lock serializes deposit jobs. Check
  both the deposit and gas wallet for pending transactions before sending.
- Pin the network, token, signer, destination, and EIP-712 domain. Authorizations
  use random nonces and expire 10 minutes after the latest block timestamp.
- Simulate the exact authorization before preparing the sponsor transaction.
- Save the signed transaction's hash in the existing pending-sweep journal
  **before broadcasting**. Raw transactions and authorization signatures remain
  in process memory and are not returned to the browser or logged.
- A timeout, failed confirmation, or unresolved pending journal blocks another
  sponsored sweep. Never automatically replace it with a fresh authorization.
- Reconciliation records a confirmed success or revert. Customer USDC tracking
  resets only after a successful receipt, atomically with the ledger update.
- A crash after journaling but before broadcast can leave a hash that never
  appears on-chain. This intentionally fails closed. An operator must inspect
  the recorded hash, gas-wallet nonce/activity, token transfer events and deposit
  balance before resolving the journal. Do not simply delete it, assume a
  missing receipt means failure, or disable the flag to force a retry.
- No automatic ETH funding, token conversion, or live test transfer is part
  of installation. Gas costs can change between estimation and execution.

## Verification

Run these offline tests without production environment variables:

```sh
node --test tests/usdc-gas-sponsor.test.cjs tests/deposit-sweep.test.cjs tests/treasury-deposits.test.cjs tests/treasury.test.cjs tests/treasury-sponsor-ui.test.cjs
./node_modules/.bin/tsc --noEmit --incremental false
```

The tests use ephemeral test wallets and fake providers; they verify actual
typed-data signatures and signed transaction envelopes without broadcasting.
They cover an ETH-empty source, signer/domain/network mismatches, treasury
changes, fee caps, simulation failures, nonce conflicts, journal failures,
ambiguous broadcasts, confirmation timeouts, and manual-only sponsorship.

References: [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009),
[Base network fees](https://docs.base.org/specifications/transactions/network-fees).

## Sweep all funded wallets

Treasury's **Sweep all funded wallets** scans every deposit page without sending funds. The review lists eligible balances, destination and skipped-wallet reasons. **Confirm sweep all** submits each reviewed wallet sequentially through the existing authenticated, locked single-wallet endpoint. Each endpoint rechecks balances and destination; the batch stops on a failure or uncertain response without retrying. Confirmed transaction links remain visible after a partial failure. Keep the page open while processing; this is not a background job. Closing it may leave the current request running, so check wallet activity before starting again. Central gas configuration errors still block affected USDC wallets. The per-transfer fee limit applies separately to each transfer, not to the entire batch.
