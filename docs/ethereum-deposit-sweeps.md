# Native ETH customer deposits on Ethereum

Treasury has a separate **Ethereum customer deposits** section. Search by customer
name/email, choose **Preview ETH sweep**, verify the Ethereum mainnet destination,
amount and maximum fee, then explicitly confirm. The destination is the configured
`TREASURY_WALLET_ADDRESS`; there is no fallback or arbitrary destination input.
`ETH_RPC_URL` must resolve to chain 1 (public Ethereum dRPC is the default).

Only native ETH to a regular EOA treasury is supported. Base token sweeps remain
separate. The existing HD deposit derivation is checked against the stored source
address before signing. No customer credit or Base balance tracker is changed.
Gas is deducted from the deposited ETH; unused fee allowance remains at source.

Reviews are HMAC-bound to their fields and expire after two minutes. Confirmation
rechecks admin authentication, same origin, network, destination, balance, nonce,
fees, signer identity and the shared deposit-job database lock. No scheduled job
calls this feature.

Before broadcast, the exact signed transaction hash and ETH amount are committed
to the sweep journal. The monetary ledger amount is zero because that field is
USD-denominated; precise ETH and network are in the description metadata. A timeout
leaves an uncertain journal and blocks another sweep. Never delete this record to
force a retry. Check the hash on Ethereum; the next preview reconciles a confirmed
or reverted receipt before considering another sweep. If a journal exists but no
receipt is available, manual investigation is required (even if broadcast may not
have happened). No blind replacement or automatic rebroadcast is performed.

Validation uses mocked providers/signers and test keys only. No real transfer is
part of implementation, deployment or verification. The admin performs the final
financial confirmation.
