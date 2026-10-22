# LinkedVelocity — assistant starting point

This repository is LinkedVelocity (formerly Klabber), `ortusclub/linkedvelocity`. The live site is https://linkedvelocity.com. Start with this file and task-specific documentation rather than relying on prior chat history.

## Wise payment investigations

Read [docs/wise.md](docs/wise.md) before working with Wise. It records setup, executable commands, limitations, payout reconciliation, and the current handoff state. The integration is read-only. GitHub access alone does not supply Wise or database credentials. Obtain credentials through the runtime's secret store; never commit or print them.

Use `npm run wise -- --help` and `npm run test:wise`. Update the handoff status after real connection verification. Do not copy customer payment data or local session transcripts into documentation.

## Project map

- Next.js App Router, React, TypeScript; Prisma/PostgreSQL.
- Inventory UI: `src/app/(admin)/admin/accounts/page.tsx`.
- Inventory API: `src/app/api/admin/accounts/route.ts`.
- Owner payments: `AmbassadorApplication.monthlyPayouts` in `prisma/schema.prisma`.
- Restriction flags/history: `src/lib/restriction.ts`; retain history when changing flags.
- Production Vercel project is `linkedvelocity` (see verified mapping below). Pushing `main` triggers production deployment. Publish only within the user's authorized scope, and verify the resulting deployment when deploying.

`DEVELOPER.md`, `HANDOFF.md` and other older guides may describe historical branding/auth/workflows. Check current code before relying on them. `SESSION-HANDOFF.md` is local and gitignored; it is not the portable source of truth and must not be committed.

## Verified production mapping and treasury checks — 22 October 2026

- GitHub repository: `https://github.com/ortusclub/linkedvelocity`.
- Live site: `https://linkedvelocity.com`; Treasury: `/admin/treasury`.
- Vercel production project: `linkedvelocity`, ID `prj_gdfkCckKcIJgIwZqpuHYT0Aut7d8`.
- Vercel team: `info-33148106s-projects`, ID `team_ELgjLjZmA1N5FrtAcLMEh8p9`.
- `linkedvelocityii` is a separate project using the same repository. It serves `linkedin-ambassadors.vercel.app`; do not confuse it with production. Older references to project `klabber` are stale.
- Local checkout used for this investigation: `/Users/samueladcock/linkedvelocity-sweep-public`.

### Read-only investigation procedure

Use repository code and available authenticated Vercel tools before asking Samuel to navigate the browser. Repository access alone does not prove access to current balances. Verify the project by its repository link and production domain aliases before reading configuration.

The Vercel connector could list projects but returned 403 for team settings in this session. The existing Vercel CLI connection successfully read the correct team/project. Use the explicitly scoped CLI fallback where authorized; never change authentication or protections to bypass denied access.

`TREASURY_WALLET_ADDRESS` on the production project was verified as `0x7DDE778c985829D1100b0C5f1d94c8dA7C38bdf1`. Samuel supplied this new receiving address and confirmed that its wallet supports Base. Re-read the configuration before future transfers; this note is dated evidence, not a permanent destination instruction.

Inspect `src/app/api/admin/treasury/deposits/route.ts`, `src/lib/deposit-detector.ts`, `src/lib/wallet.ts`, and `src/lib/treasury-transfer.ts` for current behavior. The deposit sweep targets the configured treasury; the subsequent browser transfer flow is separate. Do not assume a second transfer is needed when the treasury already matches the requested receiving wallet.

Read only the configuration required for the task. Never print, commit, or document seed phrases, private keys, database credentials, or RPC credentials. For balances, use read-only blockchain RPC and authenticated read-only deposit data. Do not run deposit scanning jobs merely to inspect balances: they may credit records or sweep funds. No sweep or transfer was submitted by the agent. Financial execution must remain a user action; prepare and explain verified details without signing or broadcasting transactions.

For future read-only balance investigations, the existing checkout `/Users/samueladcock/linkedin-ambassadors` has `.vercel/project.json` linking it to the verified production project and an existing `.env.production.local`. Load only the needed database connection into memory without printing values. Use `BEGIN READ ONLY` and query `deposit_addresses` for public addresses and credit-tracking balances; check pending sweep records in `transactions`. Fetch current treasury and RPC settings from the explicitly scoped production project, and use only chain-ID, balance, nonce, receipt, or simulation RPC methods. Do not import signing helpers or execute sweep/detection jobs. Keep customer balances and payment records out of this documentation.

## Central gas implementation

See `docs/usdc-gas-sponsor.md` for USDC-only ERC-3009 sweeps, dedicated sponsor configuration, manual activation, fee limits, and pending-journal recovery. The sponsor feature defaults off. Do not enable it or submit real transfers as a verification step.
