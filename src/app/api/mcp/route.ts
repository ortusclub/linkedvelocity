import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { agentOperations } from "@/lib/agent-operations";
import * as route0 from "../accounts/route";
import * as route1 from "../accounts/[id]/route";
import * as route2 from "../profile/route";
import * as route3 from "../profile/payment/route";
import * as route4 from "../vetting/route";
import * as route5 from "../rentals/route";
import * as route6 from "../rentals/checkout-usdc/route";
import * as route7 from "../rentals/checkout/route";
import * as route8 from "../rentals/[id]/access/route";
import * as route9 from "../rentals/[id]/signin-code/route";
import * as route10 from "../rentals/[id]/auto-renew/route";
import * as route11 from "../rentals/[id]/renew/route";
import * as route12 from "../rentals/[id]/cancel/route";
import * as route13 from "../rentals/[id]/replace/route";
import * as route14 from "../rentals/[id]/replacement-options/route";
import * as route15 from "../rentals/[id]/wait/route";
import * as route16 from "../rentals/billing-portal/route";
import * as route17 from "../wallet/balance/route";
import * as route18 from "../wallet/transactions/route";
import * as route19 from "../wallet/payments/route";
import * as route20 from "../wallet/deposit-address/route";
import * as route21 from "../wallet/withdraw/route";
import * as route22 from "../wallet/auto-recharge/route";
import * as route23 from "../wallet/card/route";
import * as route24 from "../wallet/card-setup/route";
import * as route25 from "../wallet/card-topup-checkout/route";
import * as route26 from "../discounts/validate/route";

export const dynamic = "force-dynamic";
const handlers = {
  "/api/accounts": route0,
  "/api/accounts/{id}": route1,
  "/api/profile": route2,
  "/api/profile/payment": route3,
  "/api/vetting": route4,
  "/api/rentals": route5,
  "/api/rentals/checkout-usdc": route6,
  "/api/rentals/checkout": route7,
  "/api/rentals/{id}/access": route8,
  "/api/rentals/{id}/signin-code": route9,
  "/api/rentals/{id}/auto-renew": route10,
  "/api/rentals/{id}/renew": route11,
  "/api/rentals/{id}/cancel": route12,
  "/api/rentals/{id}/replace": route13,
  "/api/rentals/{id}/replacement-options": route14,
  "/api/rentals/{id}/wait": route15,
  "/api/rentals/billing-portal": route16,
  "/api/wallet/balance": route17,
  "/api/wallet/transactions": route18,
  "/api/wallet/payments": route19,
  "/api/wallet/deposit-address": route20,
  "/api/wallet/withdraw": route21,
  "/api/wallet/auto-recharge": route22,
  "/api/wallet/card": route23,
  "/api/wallet/card-setup": route24,
  "/api/wallet/card-topup-checkout": route25,
  "/api/discounts/validate": route26,

};
type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);
  // Bearer authentication is mandatory on this headless endpoint (never ambient cookies).
  if (!request.headers.get("authorization") || !(await getSession())) return json({ error: "Unauthorized" }, 401);
  let rpc;
  try { rpc = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id, result });
  const error = (code: number, message: string) => json({ jsonrpc: "2.0", id: rpc.id, error: { code, message } });
  if (rpc.method === "initialize") return ok({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "linkedvelocity", version: "1.0.0" }, instructions: "Acts as the key owner. Mutating tools can spend wallet funds or change rentals. Check balance and availability first. Never blindly retry purchases after a timeout; reconcile rentals and transactions. Card setup/checkout can require human completion at the returned provider URL." });
  if (rpc.method === "ping") return ok({});
  if (rpc.method === "tools/list") return ok({ tools: agentOperations.map(op => ({
    name: op.name, description: `${op.method} ${op.path}. Uses the same ownership checks and rules as the app. ${op.method === "GET" ? "Read account data." : "Changes account state; may spend funds. Ensure user authorization."}`,
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Rental or account ID for paths containing {id}" }, query: { type: "object", additionalProperties: { type: "string" } }, body: { type: "object", additionalProperties: true, description: "JSON request body; see /developer for API examples." } }, additionalProperties: false, ...(op.path.includes("{id}") ? { required: ["id"] } : {}) },
    annotations: { readOnlyHint: op.method === "GET", destructiveHint: op.method !== "GET", openWorldHint: true },
  })) });
  if (rpc.method !== "tools/call") return error(-32601, "Method not found");
  const op = agentOperations.find(op => op.name === rpc.params?.name);
  if (!op) return error(-32602, "Unknown tool");
  const args = rpc.params?.arguments ?? {};
  if (op.path.includes("{id}") && (typeof args.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(args.id))) return error(-32602, "Valid id required");
  if (args.query && (typeof args.query !== "object" || Object.values(args.query).some(v => typeof v !== "string"))) return error(-32602, "Query values must be strings");
  const url = new URL(op.path.replace("{id}", encodeURIComponent(args.id ?? "")), request.url);
  for (const [key, value] of Object.entries(args.query ?? {})) url.searchParams.set(key, String(value));
  const handler = (handlers[op.path] as unknown as Record<string, Handler>)[op.method];
  try {
    const response = await handler(new NextRequest(url, { method: op.method, headers: request.headers, ...(op.method !== "GET" ? { body: JSON.stringify(args.body ?? {}) } : {}) }), { params: Promise.resolve({ id: args.id ?? "" }) });
    const content = await response.text();
    return ok({ content: [{ type: "text", text: JSON.stringify({ status: response.status, response: content }) }], isError: !response.ok });
  } catch {
    return ok({ content: [{ type: "text", text: "Request failed. Check rentals and transactions before retrying any payment or order." }], isError: true });
  }
}
