"use client";
import { useEffect, useState } from "react";
type Key = { id: string; createdAt: string; expiresAt: string };
export function DeveloperKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/developer/keys", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load keys");
    setKeys(data.keys);
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  async function mutate(method: "POST" | "DELETE", id?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/developer/keys", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      if (data.token) setToken(data.token);
      else setToken("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border p-6 space-y-4"><h2 className="text-xl font-semibold">Agent keys</h2>
    <p>Create a separate key for each agent. The full key is shown only once. Store it in your agent’s secret settings.</p>
    <button disabled={busy} onClick={() => mutate("POST")} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">Create agent key</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {token && <div className="space-y-2"><label htmlFor="agent-key">Copy your new key now</label><input id="agent-key" className="w-full rounded border p-2 font-mono" readOnly value={token} onFocus={e => e.target.select()} /><button onClick={() => setToken("")} className="underline">Hide key</button></div>}
    <ul className="space-y-3">{keys.map(key => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><span><code>{key.id.slice(0, 8)}</code> · Created {new Date(key.createdAt).toLocaleDateString()} · Expires {new Date(key.expiresAt).toLocaleDateString()}</span><button disabled={busy} onClick={() => mutate("DELETE", key.id)} className="text-red-700 underline disabled:opacity-50">Revoke</button></li>)}</ul>
  </section>;
}
