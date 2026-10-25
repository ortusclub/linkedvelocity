import { redirect } from "next/navigation";
import { getBrowserSession } from "@/lib/auth";
import { agentOperations } from "@/lib/agent-operations";
import { DeveloperKeys } from "./keys";

export default async function DeveloperPage() {
  if (!(await getBrowserSession())) redirect("/login");
  return <main className="mx-auto max-w-4xl px-6 py-16 space-y-8">
    <header><h1 className="text-3xl font-bold">Developer mode</h1><p className="mt-3">Connect your agent to LinkedVelocity. Browse accounts, place orders, manage rentals, retrieve share links and manage your wallet without opening the app.</p></header>
    <DeveloperKeys />
    <section className="space-y-3"><h2 className="text-xl font-semibold">Connect an agent</h2>
      <p>Use this site’s origin followed by <code>/api/mcp</code> as a Streamable HTTP MCP endpoint. Add the header <code>Authorization: Bearer YOUR_KEY</code>. Your agent can discover actions with tools/list.</p>
      <p>You can also call the HTTP endpoints below directly with the same header. Send JSON bodies with Content-Type: application/json.</p>
      <pre className="overflow-auto rounded bg-slate-100 p-4">{`curl https://linkedvelocity.com/api/rentals \
  -H "Authorization: Bearer $LINKEDVELOCITY_API_KEY"`}</pre>
      <p>Keys act with your account’s permissions, including spending wallet funds and accessing account details you can view. Existing rental limits, ownership checks and credential permissions apply. Keys expire after 90 days; revoking a key disables subsequent requests immediately.</p>
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Order and access an account</h2>
      <ol className="list-decimal pl-6 space-y-2"><li>GET /api/accounts to check availability and GET /api/wallet/balance to check funds.</li><li>POST /api/rentals/checkout-usdc with {`{ "accountIds": ["ACCOUNT_ID"], "autoRenew": false }`} to order using your wallet. This spends money.</li><li>GET /api/rentals to confirm the order and find its rental ID.</li><li>POST /api/rentals/RENTAL_ID/access to retrieve the share link when the account is ready.</li></ol>
      <p>Check rentals and transactions before retrying a timed-out purchase. Card checkout and card setup return provider links and may require a person to complete payment authentication. Never treat a checkout link as a confirmed payment.</p>
      <p>Renew by card: GET /api/rentals/ID/renew returns a checkout redirect. Cancel: POST /api/rentals/ID/cancel. Auto-renew: PATCH /api/rentals/ID/auto-renew with {`{ "autoRenew": false }`}. Replace: POST /api/rentals/ID/replace with {`{ "newAccountId": "ACCOUNT_ID" }`}. Top up by card: POST /api/wallet/card-topup-checkout with {`{ "amount": 100 }`}.</p>
    </section>
    <section><h2 className="text-xl font-semibold mb-3">Available actions</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Method</th><th className="p-2">Endpoint</th><th className="p-2">MCP tool</th></tr></thead><tbody>{agentOperations.map(op => <tr key={op.name} className="border-t"><td className="p-2">{op.method}</td><td className="p-2"><code>{op.path}</code></td><td className="p-2"><code>{op.name}</code></td></tr>)}</tbody></table></div></section>
  </main>;
}
