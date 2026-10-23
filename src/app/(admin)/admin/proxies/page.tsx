"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── palette (Inventory v2 mock literals) ──
const INK = "#0b1220", SUB = "#5b6779", MUT = "#8a93a3", LINE = "#e3e6ec", LINE2 = "#eef0f4", BG = "#eef0f4";
const BLUE = "#2563eb", GREEND = "#0f7a3d", REDD = "#b91c1c", AMBERD = "#b45309";
const F = "'Plus Jakarta Sans',system-ui,sans-serif", G = "'Space Grotesk',system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace";

// Pill tone = [bg, fg].
const RED: [string, string] = ["#fde8e8", "#b91c1c"];
const AMB: [string, string] = ["#fff4e5", "#b45309"];
const GRY: [string, string] = ["#eef0f4", "#5b6779"];
const BLU: [string, string] = ["#e8f0fe", "#2563eb"];
const GRN: [string, string] = ["#e7f6ee", "#0f7a3d"];

// Account caps per egress IP, by type. (Editable here; a settings UI can follow.)
const CAPS: Record<string, number> = { residential: 4, mobile: 3, datacenter: 3 };

const ALIAS: Record<string, string> = { SG: "Singapore", PH: "Philippines", UK: "United Kingdom", US: "United States" };
const normCountry = (c: string | null | undefined) => (c ? ALIAS[c.trim().toUpperCase()] || c.trim() : "");
const sameCountry = (a: string, b: string) => normCountry(a).toLowerCase() === normCountry(b).toLowerCase();
const capType = (t: string | null) => (t ? t.toLowerCase() : "");
const typeLabel = (t: string | null) => { const k = capType(t); return k === "residential" ? "Residential" : k === "mobile" ? "Mobile" : k === "datacenter" ? "Datacenter · legacy" : k === "mixed" ? "Mixed" : "No type"; };
const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type AcctFlagKey = "restricted" | "gologin" | "rotate" | "mail" | "held" | "inactive" | "retired";
const AF: Record<AcctFlagKey, { l: string; tip: string; tone: [string, string]; sev: number; dim?: boolean }> = {
  restricted: { l: "Restricted", tip: "LinkedIn restricted — don't rent; free this slot or keep for recovery", tone: RED, sev: 3 },
  gologin: { l: "GoLogin still shared", tip: "Rental ended but GoLogin profile still shared", tone: RED, sev: 3 },
  rotate: { l: "Needs rotate", tip: "2FA / password rotation pending", tone: AMB, sev: 2 },
  mail: { l: "Mail alert", tip: "Unacknowledged LinkedIn security email", tone: AMB, sev: 2 },
  held: { l: "Held", tip: "Reserved for a renter — not live yet", tone: BLU, sev: 1 },
  inactive: { l: "Inactive 30d+", tip: "No rental or activity 30+ days — holding a slot", tone: GRY, sev: 1 },
  retired: { l: "Retired", tip: "Account retired — slot can be reused", tone: GRY, sev: 1, dim: true },
};

interface V2Account { email: string; flags: AcctFlagKey[]; }
interface V2Port {
  port: number; username: string | null; hasPassword: boolean; provider: string | null; type: string | null;
  label: string | null; labelCountry: string | null; providerProxyId: string | null; isProxyCheap: boolean;
  status: string | null; health: string | null; lastCheckedAt: string | null; accounts: V2Account[];
}
interface V2Ip {
  ip: string; verifiedCountry: string | null; geoCheckedAt: string | null;
  autoExtend: boolean | null; expiresAt: string | null; ports: V2Port[];
}

type Flag = { l: string; tip: string; tone: [string, string]; sev: number };

// Everything the row + expanded panel need, derived per IP (mirrors the mock).
function derive(ip: V2Ip) {
  const accts = ip.ports.flatMap((p) => p.accounts);
  const n = accts.length;
  const types = [...new Set(ip.ports.map((p) => capType(p.type)).filter(Boolean))];
  const type = types.length === 1 ? types[0] : types.length ? "mixed" : "";
  const cap = type === "mixed" ? Math.min(...types.map((t) => CAPS[t] ?? 3)) : (CAPS[type] ?? null);
  const untypedPorts = ip.ports.filter((p) => !p.type).length;
  const labels = [...new Set(ip.ports.map((p) => normCountry(p.labelCountry)).filter(Boolean))];
  const geo = ip.verifiedCountry ? normCountry(ip.verifiedCountry) : null;
  const geoBad = geo && labels.length ? labels.filter((l) => !sameCountry(l, geo)) : [];
  const err = ip.ports.some((p) => p.health === "failing" || p.status === "error");
  const badAccts = accts.filter((a) => a.flags.some((k) => AF[k].sev === 3));
  const idle = accts.filter((a) => a.flags.includes("inactive") || a.flags.includes("retired"));
  const over = cap != null && n > cap;
  const lapse = ip.autoExtend === false && n > 0;
  const payEmpty = ip.autoExtend === true && n === 0;
  const legacy = types.includes("datacenter");
  const expDays = ip.expiresAt ? Math.round((new Date(ip.expiresAt).getTime() - Date.now()) / 86400000) : null;
  const pcPorts = ip.ports.filter((p) => p.isProxyCheap);

  const flags: Flag[] = [];
  const add = (l: string, tone: [string, string], tip: string, sev: number) => flags.push({ l, tone, tip, sev });
  if (geoBad.length) add("Geo mismatch", RED, `Labeled ${geoBad.join(" / ")} but egress reads ${geo} — restriction risk. Re-label the port or swap the IP.`, 3);
  if (lapse) add(`Lapses in ${expDays ?? "?"}d`, RED, `Auto-extend is OFF on an in-use IP — lapses in ${expDays ?? "?"}d and drops ${pl(n, "account")}.`, 3);
  if (err) add("Failing", RED, "A port failed its last 3 checks — move its accounts or replace the proxy.", 3);
  if (over) add("Over cap", RED, `${pl(n, "account")} on this IP; cap for ${type} is ${cap}.`, 3);
  if (badAccts.length) add(`${pl(badAccts.length, "account")} flagged`, RED, `${badAccts.length} account(s) restricted or still shared in GoLogin — check before renting the others.`, 3);
  if (payEmpty) add("Paying for empty", AMB, "No accounts but auto-extend is ON — turn it off or fill the slot.", 2);
  if (type === "mixed" || untypedPorts) add(type === "mixed" ? "Mixed types" : "Untyped", AMB, type === "mixed" ? `Ports typed differently — strictest cap (${cap}) applied.` : `${pl(untypedPorts, "port")} with no type — cap can't be enforced.`, 2);
  if (pcPorts.some((p) => !p.providerProxyId)) add("No PC ID", GRY, "Proxy-Cheap ID missing — add it so issues can be raised fast.", 1);
  if (ip.ports.some((p) => !p.provider)) add("No provider", GRY, `Provider missing on ${pl(ip.ports.filter((p) => !p.provider).length, "port")}.`, 1);
  if (idle.length) add(`${idle.length} idle`, GRY, `${pl(idle.length, "inactive or retired account")} holding a slot — free it up.`, 1);
  if (legacy && n > 0) add("Migrate", GRY, `Proxy 6 datacenter is legacy — migrate ${pl(n, "account")} to residential.`, 1);

  const action = flags.some((f) => f.sev === 3);
  const room = cap != null && n < cap && type !== "datacenter" && !err && !geoBad.length;
  return { accts, n, type, cap, labels, geo, geoBad, err, over, lapse, payEmpty, legacy, expDays, flags, action, room, idle: idle.length };
}

function Pill({ tone, children, title }: { tone: [string, string]; children: React.ReactNode; title?: string }) {
  return <span title={title} style={{ font: `700 10.5px ${F}`, padding: "2px 8px", borderRadius: 999, background: tone[0], color: tone[1], whiteSpace: "nowrap" }}>{children}</span>;
}

export default function AdminProxiesPage() {
  const [ips, setIps] = useState<V2Ip[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"country" | "provider" | "flat">("country");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({}); // host:port -> "user:pass"
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState("");
  const [checking, setChecking] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetch("/api/admin/proxies/v2").then((r) => r.json()).then((d) => setIps(d.ips || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/proxies/export-url").then((r) => r.json()).then((d) => { if (d.configured) setSheetUrl(d.url); }).catch(() => {}); }, []);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(""), 2400); };

  const patchProxy = async (host: string, port: number, data: Record<string, unknown>) => {
    await fetch("/api/admin/proxies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, port, ...data }) });
    load();
  };

  const loadCreds = useCallback(async (host: string) => {
    const r = await fetch("/api/admin/proxies/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host }) });
    const d = await r.json();
    if (Array.isArray(d.creds)) {
      setCreds((c) => { const next = { ...c }; for (const x of d.creds) next[`${x.host}:${x.port}`] = `${x.username}:${x.password}`; return next; });
    }
    return d.creds as { host: string; port: number; username: string; password: string }[] | undefined;
  }, []);

  const toggleReveal = async () => {
    const next = !reveal; setReveal(next);
    if (next) { const hosts = [...new Set(ips.map((i) => i.ip))]; await Promise.all(hosts.map((h) => loadCreds(h))); }
  };

  const copy = async (host: string, port: number, kind: "line" | "url") => {
    let cp = creds[`${host}:${port}`];
    if (!cp) { const list = await loadCreds(host); const hit = list?.find((x) => x.host === host && x.port === port); if (hit) cp = `${hit.username}:${hit.password}`; }
    if (!cp) { flash("No stored password for this proxy"); return; }
    const ci = cp.indexOf(":");
    const user = ci >= 0 ? cp.slice(0, ci) : cp;
    const pass = ci >= 0 ? cp.slice(ci + 1) : "";
    const text = kind === "line" ? `${host}:${port}:${user}:${pass}` : `http://${user}:${pass}@${host}:${port}`;
    navigator.clipboard?.writeText(text);
    setCopied(`${host}:${port}:${kind}`); setTimeout(() => setCopied(""), 1400);
  };

  const toggleAuto = async (host: string, port: number, enabled: boolean) => {
    flash(`Auto-extend ${enabled ? "ON" : "OFF"} for ${host}…`);
    const r = await fetch("/api/admin/proxies/auto-extend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, port, enabled }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); flash(d.error || "Could not change auto-extend"); }
    load();
  };

  const runCheck = async () => {
    setChecking(true); flash("Health + geo + billing check running…");
    try {
      const r = await fetch("/api/admin/proxies/check", { method: "POST" });
      const d = await r.json();
      if (d.summary) flash(`Checked ${d.summary.checked} · ${d.summary.failing} failing · ${d.summary.geoMismatch} geo mismatch · ${d.summary.lapsingSoon} lapsing`);
      else flash(d.error || "Check failed");
      load();
    } finally { setChecking(false); }
  };

  const copySheets = () => { if (!sheetUrl) return; navigator.clipboard?.writeText(`=IMPORTDATA("${sheetUrl}")`); flash("Sheets formula copied"); };

  const rows = useMemo(() => ips.map((ip) => ({ ip, d: derive(ip) })), [ips]);
  const ql = q.trim().toLowerCase();
  const matchQ = (r: { ip: V2Ip; d: ReturnType<typeof derive> }) =>
    !ql || [r.ip.ip, r.d.type, r.d.geo || "", ...r.d.labels, ...r.ip.ports.flatMap((p) => [String(p.port), p.username || "", p.provider || "", p.label || "", p.providerProxyId || "", ...p.accounts.map((a) => a.email)])].join(" ").toLowerCase().includes(ql);
  const matchF = (r: { d: ReturnType<typeof derive> }) => {
    if (filter === "action") return r.d.action;
    if (filter === "billing") return r.d.lapse || r.d.payEmpty;
    if (filter === "geo") return r.d.geoBad.length > 0;
    if (filter === "legacy") return r.d.legacy && r.d.n > 0;
    if (filter === "room") return r.d.room;
    return true;
  };
  const vis = rows.filter((r) => matchQ(r) && matchF(r)).sort((a, b) => Number(b.d.action) - Number(a.d.action) || b.d.flags.length - a.d.flags.length || b.d.n - a.d.n);

  const count = (fn: (r: { d: ReturnType<typeof derive> }) => boolean) => rows.filter(fn).length;
  const sum = (fn: (r: { d: ReturnType<typeof derive> }) => boolean, val: (r: { d: ReturnType<typeof derive> }) => number) => rows.filter(fn).reduce((a, r) => a + val(r), 0);
  const tiles = [
    { k: "all", label: "Egress IPs", n: rows.length, sub: `${sum(() => true, (r) => r.d.n)} accounts`, dot: INK },
    { k: "action", label: "Needs action", n: count((r) => r.d.action), sub: "Geo · lapse · failing · over cap", dot: REDD },
    { k: "billing", label: "Billing risk", n: count((r) => r.d.lapse || r.d.payEmpty), sub: `${count((r) => r.d.lapse)} lapsing · ${count((r) => r.d.payEmpty)} paying empty`, dot: AMBERD },
    { k: "geo", label: "Geo mismatch", n: count((r) => r.d.geoBad.length > 0), sub: "Egress ≠ label", dot: REDD },
    { k: "legacy", label: "Legacy to migrate", n: count((r) => r.d.legacy && r.d.n > 0), sub: `${sum((r) => r.d.legacy, (r) => r.d.n)} on Proxy 6`, dot: MUT },
    { k: "room", label: "Room to spare", n: count((r) => r.d.room), sub: `${sum((r) => r.d.room, (r) => (r.d.cap ?? 0) - r.d.n)} free slots`, dot: GREEND },
  ];

  // Group visible IPs.
  const groups = useMemo(() => {
    if (group === "flat") return [{ name: "", list: vis }];
    const m = new Map<string, typeof vis>();
    const order: string[] = [];
    for (const r of vis) {
      const key = group === "provider" ? ([...new Set(r.ip.ports.map((p) => p.provider).filter(Boolean))].join(" + ") || "No provider") : (r.d.geo || r.d.labels[0] || "Not verified");
      if (!m.has(key)) { m.set(key, []); order.push(key); }
      m.get(key)!.push(r);
    }
    order.sort();
    return order.map((name) => ({ name, list: m.get(name)! }));
  }, [vis, group]);

  const COLS = "minmax(220px,1.9fr) 160px 128px 150px 164px minmax(190px,1.7fr) 22px";

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: "24px 24px 80px", margin: "-24px", fontFamily: F }}>
      <div style={{ maxWidth: 1360, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 740 }}>
            <h1 style={{ font: `700 30px ${G}`, color: INK, margin: "0 0 4px", letterSpacing: "-.01em" }}>Proxies</h1>
            <p style={{ font: `500 14px/1.5 ${F}`, color: SUB, margin: 0 }}>
              One row per egress IP — that&apos;s what LinkedIn sees. Caps: residential {CAPS.residential}, mobile {CAPS.mobile}, datacenter {CAPS.datacenter} accounts per IP. Datacenter (Proxy&nbsp;6) is legacy; migrate off.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sheetUrl && <button onClick={copySheets} style={{ border: "1px solid #cdebd9", background: "#f4fbf7", color: "#0f7a3d", borderRadius: 10, padding: "8px 12px", font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>Sheets formula</button>}
            <button onClick={runCheck} disabled={checking} style={{ border: "none", background: INK, color: "#fff", borderRadius: 10, padding: "9px 14px", font: `700 12.5px ${F}`, cursor: checking ? "default" : "pointer", opacity: checking ? 0.6 : 1, whiteSpace: "nowrap" }}>{checking ? "Checking…" : "Run check now"}</button>
          </div>
        </div>

        {/* tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          {tiles.map((t) => {
            const active = filter === t.k;
            return (
              <button key={t.k} onClick={() => setFilter((f) => (f === t.k && t.k !== "all" ? "all" : t.k))}
                style={{ textAlign: "left", cursor: "pointer", background: active ? "#eef4ff" : "#fff", border: `1.5px solid ${active ? BLUE : LINE}`, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, font: `700 11px ${F}`, letterSpacing: ".06em", textTransform: "uppercase", color: SUB, whiteSpace: "nowrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.dot }} />{t.label}
                </span>
                <span style={{ font: `700 26px ${G}`, color: INK }}>{t.n}</span>
                <span style={{ font: `600 12px ${F}`, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</span>
              </button>
            );
          })}
        </div>

        {/* toolbar */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "12px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: BG, borderRadius: 10, padding: 3, gap: 2 }}>
            {([["country", "By country"], ["provider", "By provider"], ["flat", "Flat"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setGroup(k)} style={{ border: "none", background: group === k ? "#fff" : "transparent", color: group === k ? INK : SUB, boxShadow: group === k ? "0 1px 2px rgba(11,18,32,.12)" : "none", borderRadius: 8, padding: "6px 12px", font: `700 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search IP, port, country, label, provider, Proxy-Cheap ID or account…" style={{ flex: 1, minWidth: 240, border: `1px solid #dde1e8`, background: "#f8f9fb", borderRadius: 10, padding: "9px 12px", font: `500 13.5px ${F}`, color: INK, outline: "none" }} />
          <button onClick={toggleReveal} style={{ border: `1px solid #dde1e8`, background: "#fff", color: INK, borderRadius: 10, padding: "8px 12px", font: `600 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{reveal ? "Hide passwords" : "Show passwords"}</button>
          <button onClick={() => { const anyOpen = vis.some((r) => open[r.ip.ip]); const next: Record<string, boolean> = {}; if (!anyOpen) vis.forEach((r) => { next[r.ip.ip] = true; }); setOpen(next); }} style={{ border: `1px solid #dde1e8`, background: "#fff", color: INK, borderRadius: 10, padding: "8px 12px", font: `600 12.5px ${F}`, cursor: "pointer", whiteSpace: "nowrap" }}>{vis.some((r) => open[r.ip.ip]) ? "Collapse all" : "Expand all"}</button>
        </div>

        {/* table */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, overflowX: "auto" }}>
          <div style={{ minWidth: 1060 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 14, padding: "11px 18px", borderBottom: `1px solid ${LINE2}`, font: `700 10.5px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>
              <span>Egress IP · verified country</span><span>Provider</span><span>Type</span><span>Load</span><span>Auto-extend</span><span>Flags</span><span />
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: MUT }}>Loading…</div>
            ) : vis.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", font: `500 13.5px ${F}`, color: MUT }}>Nothing matches — clear the search or pick another tile.</div>
            ) : groups.map((grp) => (
              <div key={grp.name || "flat"}>
                {grp.name && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 18px", background: "#f8f9fb", borderBottom: `1px solid ${LINE2}`, borderTop: `1px solid ${LINE}` }}>
                    <span style={{ font: `700 13.5px ${F}`, color: INK }}>{grp.name}</span>
                    <span style={{ font: `500 12px ${F}`, color: SUB }}>{pl(grp.list.length, "IP")} · {pl(grp.list.reduce((a, r) => a + r.d.n, 0), "account")}</span>
                  </div>
                )}
                {grp.list.map(({ ip, d }) => {
                  const isOpen = !!open[ip.ip];
                  const pct = d.cap ? Math.min(100, Math.round((d.n / d.cap) * 100)) : 0;
                  const barC = d.over ? "#dc2626" : pct >= 75 ? "#d97706" : "#16a34a";
                  const providers = [...new Set(ip.ports.map((p) => p.provider).filter(Boolean))];
                  const pcIds = ip.ports.filter((p) => p.isProxyCheap);
                  const pcLbl = pcIds.length ? (pcIds.every((p) => p.providerProxyId) ? pcIds.map((p) => `#${p.providerProxyId}`).join(", ") : "PC ID missing") : "";
                  const typeTone = d.type === "residential" ? GRN : d.type === "mobile" ? BLU : d.type === "datacenter" ? GRY : d.type === "mixed" ? AMB : AMB;
                  return (
                    <div key={ip.ip}>
                      <div onClick={() => setOpen((o) => ({ ...o, [ip.ip]: !o[ip.ip] }))}
                        style={{ display: "grid", gridTemplateColumns: COLS, gap: 14, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${LINE2}`, boxShadow: `inset 3px 0 0 ${d.action ? "#dc2626" : "transparent"}`, background: isOpen ? "#fafbfc" : "#fff", cursor: "pointer" }}>
                        {/* IP + geo */}
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ font: `600 14px ${MONO}`, color: INK }}>{ip.ip}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <Pill tone={ip.verifiedCountry ? (d.geoBad.length ? RED : GRN) : GRY} title={ip.verifiedCountry ? `Egress verified by majority vote · labeled ${d.labels.join(", ") || "—"}` : "Not checked yet"}>
                              {ip.verifiedCountry ? (d.geoBad.length ? `⚠ Reads ${d.geo}` : `✓ ${d.geo}`) : "Not verified"}
                            </Pill>
                            <span style={{ font: `500 11.5px ${F}`, color: MUT, whiteSpace: "nowrap" }}>{pl(ip.ports.length, "port")}{d.geoBad.length ? ` · labeled ${d.labels.join(", ")}` : ""}</span>
                          </div>
                        </div>
                        {/* provider */}
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ font: `600 13px ${F}`, color: providers.length ? INK : AMBERD, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{providers.join(" + ") || "No provider"}</span>
                          <span style={{ font: `500 11.5px ${MONO}`, color: pcLbl === "PC ID missing" ? AMBERD : SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pcLbl}</span>
                        </div>
                        {/* type */}
                        <span><span style={{ font: `700 11.5px ${F}`, padding: "3px 9px", borderRadius: 999, background: typeTone[0], color: typeTone[1], whiteSpace: "nowrap" }}>{typeLabel(d.type || null)}</span></span>
                        {/* load */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <span style={{ font: `700 14px ${G}`, color: d.over ? REDD : d.n ? INK : MUT }}>{d.cap != null ? `${d.n} / ${d.cap}` : d.n}<span style={{ font: `500 11.5px ${F}`, color: MUT }}> {d.cap != null ? "accounts" : "no cap"}</span></span>
                          <div style={{ height: 5, borderRadius: 999, background: LINE2, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: barC, borderRadius: 999 }} /></div>
                        </div>
                        {/* auto-extend */}
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          {ip.autoExtend == null ? (
                            <span style={{ font: `600 12px ${F}`, color: MUT }}>N/A · manual</span>
                          ) : (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); const port = pcIds[0]?.port ?? ip.ports[0].port; toggleAuto(ip.ip, port, !ip.autoExtend); }} title="Toggle auto-extend"
                                style={{ flex: "none", width: 32, height: 18, border: "none", borderRadius: 999, background: ip.autoExtend ? "#16a34a" : "#cbd2dc", position: "relative", cursor: "pointer", padding: 0 }}>
                                <span style={{ position: "absolute", top: 2, left: ip.autoExtend ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(11,18,32,.2)", transition: "left .15s" }} />
                              </button>
                              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                <span style={{ font: `700 12px ${F}`, color: d.lapse ? REDD : d.payEmpty ? AMBERD : ip.autoExtend ? GREEND : SUB, whiteSpace: "nowrap" }}>{ip.autoExtend ? "ON" : "OFF"}</span>
                                {d.expDays != null && <span style={{ font: `500 11px ${F}`, color: d.expDays <= 3 ? AMBERD : MUT, whiteSpace: "nowrap" }}>{ip.autoExtend ? "renews in " : "expires in "}{d.expDays}d</span>}
                              </div>
                            </>
                          )}
                        </div>
                        {/* flags */}
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {d.flags.map((f, i) => <Pill key={i} tone={f.tone} title={f.tip}>{f.l}</Pill>)}
                        </div>
                        <span style={{ font: `700 12px ${F}`, color: "#9aa3b2" }}>{isOpen ? "▾" : "▸"}</span>
                      </div>

                      {isOpen && (
                        <div style={{ background: "#f8f9fb", borderBottom: `1px solid ${LINE}`, padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                          {d.flags.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {d.flags.map((f, i) => (
                                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", font: `500 12.5px/1.45 ${F}`, color: "#334155" }}>
                                  <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: f.tone[1], transform: "translateY(-1px)" }} />{f.tip}
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, overflow: "hidden" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "80px minmax(150px,1fr) minmax(190px,1.1fr) 150px 120px minmax(220px,1.6fr)", gap: 12, padding: "9px 14px", borderBottom: `1px solid ${LINE2}`, font: `700 10px ${F}`, letterSpacing: ".07em", textTransform: "uppercase", color: MUT }}>
                              <span>Port</span><span>Label · type</span><span>Credentials</span><span>Proxy-Cheap ID</span><span>Health</span><span>Accounts</span>
                            </div>
                            {ip.ports.map((p) => {
                              const key = `${ip.ip}:${p.port}`;
                              const cp = creds[key];
                              const credShown = reveal && cp ? cp : `${p.username || "—"}:${"•".repeat(8)}`;
                              return (
                                <div key={p.port} style={{ display: "grid", gridTemplateColumns: "80px minmax(150px,1fr) minmax(190px,1.1fr) 150px 120px minmax(220px,1.6fr)", gap: 12, alignItems: "start", padding: "10px 14px", borderBottom: `1px solid #f0f2f5` }}>
                                  <span style={{ font: `600 13px ${MONO}`, color: INK, paddingTop: 6 }}>{p.port}</span>
                                  {/* label + type */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                                    <input defaultValue={p.label ?? ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.label ?? "")) patchProxy(ip.ip, p.port, { label: v || null }); }} placeholder="e.g. Philippines 28"
                                      style={{ minWidth: 0, border: `1px solid ${p.label ? "#dde1e8" : "#f0c98a"}`, background: "#fff", borderRadius: 8, padding: "6px 9px", font: `500 12.5px ${F}`, color: INK, outline: "none" }} />
                                    <select value={capType(p.type)} onChange={(e) => patchProxy(ip.ip, p.port, { type: e.target.value || null })}
                                      style={{ minWidth: 0, border: `1px solid ${p.type ? "#dde1e8" : "#f0c98a"}`, background: "#fff", borderRadius: 8, padding: "5px 7px", font: `600 12px ${F}`, color: INK }}>
                                      <option value="">No type</option><option value="residential">Residential</option><option value="mobile">Mobile</option><option value="datacenter">Datacenter (legacy)</option>
                                    </select>
                                  </div>
                                  {/* credentials */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, paddingTop: 4 }}>
                                    <span style={{ font: `500 12px ${MONO}`, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{credShown}</span>
                                    <div style={{ display: "flex", gap: 10 }}>
                                      <button onClick={() => copy(ip.ip, p.port, "line")} style={{ border: "none", background: "none", padding: 0, font: `700 11.5px ${F}`, color: BLUE, cursor: "pointer" }}>{copied === `${key}:line` ? "✓ Copied" : "Copy ip:port:user:pass"}</button>
                                      <button onClick={() => copy(ip.ip, p.port, "url")} style={{ border: "none", background: "none", padding: 0, font: `700 11.5px ${F}`, color: SUB, cursor: "pointer" }}>{copied === `${key}:url` ? "✓ Copied" : "Copy URL"}</button>
                                    </div>
                                  </div>
                                  {/* PC ID */}
                                  <div style={{ paddingTop: 2 }}>
                                    {p.isProxyCheap ? (
                                      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${p.providerProxyId ? "#dde1e8" : "#f0c98a"}`, background: "#fff", borderRadius: 8, overflow: "hidden" }}>
                                        <span style={{ paddingLeft: 8, font: `600 12px ${MONO}`, color: MUT }}>#</span>
                                        <input defaultValue={p.providerProxyId ?? ""} onBlur={(e) => { const v = e.target.value.replace(/^#/, "").trim(); if (v !== (p.providerProxyId ?? "")) patchProxy(ip.ip, p.port, { providerProxyId: v || null }); }} placeholder="Add ID"
                                          style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", padding: "6px 4px", font: `600 12px ${MONO}`, color: INK, outline: "none" }} />
                                        {p.providerProxyId && <a href={`https://app.proxy-cheap.com/proxies/${p.providerProxyId}`} target="_blank" rel="noreferrer" title="Open in Proxy-Cheap" style={{ padding: "6px 8px", font: `700 12px ${F}`, color: BLUE }}>↗</a>}
                                      </div>
                                    ) : <span style={{ font: `500 12px ${F}`, color: "#b4bccb" }}>—</span>}
                                  </div>
                                  {/* health */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                                    <span style={{ font: `700 12px ${F}`, color: p.health === "failing" ? REDD : GREEND }}>{p.health === "failing" ? "✕ Failing" : "● Healthy"}</span>
                                    <span style={{ font: `500 11px ${F}`, color: MUT }}>{p.lastCheckedAt ? `checked ${timeAgo(p.lastCheckedAt)}` : "never checked"}</span>
                                  </div>
                                  {/* accounts */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, paddingTop: 3 }}>
                                    {p.accounts.length === 0 ? (
                                      <span style={{ font: `500 12px ${F}`, color: MUT }}>No accounts — free slot</span>
                                    ) : p.accounts.map((a, i) => {
                                      const dim = a.flags.some((k) => AF[k].dim);
                                      const sev3 = a.flags.some((k) => AF[k].sev === 3);
                                      return (
                                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                                          <span title={a.flags.map((k) => AF[k].tip).join(" · ") || "Account"} style={{ font: `500 12px ${F}`, color: dim ? MUT : sev3 ? REDD : "#334155", textDecoration: dim ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{a.email}</span>
                                          {a.flags.map((k) => <Pill key={k} tone={AF[k].tone} title={AF[k].tip}>{AF[k].l}</Pill>)}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: INK, color: "#fff", borderRadius: 10, padding: "10px 16px", font: `600 13px ${F}`, zIndex: 60, boxShadow: "0 8px 24px rgba(11,18,32,.25)" }}>{toast}</div>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
