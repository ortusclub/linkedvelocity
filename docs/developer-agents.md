# Developer mode and agent access

Signed-in users open `/developer` from the navigation, create an agent key, then
configure their agent with this origin's `/api/mcp` endpoint and
`Authorization: Bearer <key>`. This is a stateless Streamable HTTP MCP server
(JSON responses, protocol 2025-03-26), with initialize, ping, tools/list and
tools/call. It also supports direct calls to existing HTTP API routes.

The tool registry is `src/lib/agent-operations.ts`. Dispatch calls the existing
route handlers inside the authenticated request, preserving all existing account,
rental, wallet, credential-access and ownership policies. No browser automation,
admin service token, upstream proxy, or customer-supplied URL is used.

Keys are 256-bit random secrets, shown once, stored as SHA-256 hashes in the
existing Session table with an `agent:` namespace. They expire after 90 days.
No migration is required. Cookie-only key management is same-origin protected;
agents cannot create successor keys. Revocation deletes the owned Session record.
An in-flight action may complete after revocation. Keys have the user's existing
permissions, including financial actions; they are not read-only credentials.
Inactive users cannot authenticate. Stored hashes cannot be used as credentials.
Existing desktop session bearer authentication remains supported.

## Example MCP sequence

POST `/api/mcp` with the Authorization header and Content-Type application/json:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"my-agent","version":"1"}}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_rentals","arguments":{}}}
```

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"post_rentals_id_access","arguments":{"id":"RENTAL_UUID"}}}
```

Use wallet checkout for headless orders. Card checkout/setup can require human
payment authentication; returned URLs are not payment confirmation. Purchases
retain the existing routes' retry semantics: after timeouts, reconcile rentals
and transactions before retrying. This integration does not add payment
idempotency or bypass provider authentication.

Run `node --test tests/developer-agent.test.cjs`, `npx tsc --noEmit`, and targeted
ESLint before release. Do not verify with a real purchase or withdrawal.
