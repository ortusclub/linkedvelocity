"use client";
import { useEffect, useMemo, useState } from "react";
import { contactLink } from "@/lib/issue-contacts";
import { outreachCopy, SEGMENT_LABEL, type OutreachRow, type OutreachSegment } from "@/lib/referral-outreach";

const F = "system-ui,-apple-system,sans-serif";
const SEG_ORDER: (OutreachSegment | "all")[] = ["all", "1a", "1b", "2", "3"];
const SEG_COLOR: Record<OutreachSegment, string> = { "1a": "#1a56db", "1b": "#b7791f", "2": "#188038", "3": "#c0392b" };

type Preview = { row: OutreachRow; subject: string; text: string } | null;

export default function ReferralOutreachPage() {
  const [rows, setRows] = useState<OutreachRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [convertedCount, setConvertedCount] = useState(0);
  const [convOnly, setConvOnly] = useState(false);
  const [error, setError] = useState("");
  const [seg, setSeg] = useState<OutreachSegment | "all">("all");
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [localSup, setLocalSup] = useState<Map<string, { suppressed: boolean; reason: string | null }>>(new Map());
  const [localChat, setLocalChat] = useState<Map<string, { ch: "whatsapp" | "telegram" | "viber"; at: string }>>(new Map());
  const [batching, setBatching] = useState(false);

  useEffect(() => {
    fetch("/api/admin/referral-outreach", { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Failed to load")))
      .then(d => { setRows(d.rows); setCounts(d.counts || {}); setConvertedCount(d.convertedCount || 0); })
      .catch(e => setError(e.message));
  }, []);

  const visible = useMemo(() => (rows || []).filter(r => (seg === "all" || r.segment === seg) && (!convOnly || r.signedUpAfterEmailAt)), [rows, seg, convOnly]);

  const btn: React.CSSProperties = { border: "1px solid var(--line,#d6e4fb)", borderRadius: 8, padding: "6px 11px", background: "var(--card,#fff)", color: "var(--link,#0a66c2)", cursor: "pointer", font: `600 12px ${F}` };

  const chatKey = (row: OutreachRow) => `${row.kind}:${row.id}`;
  const effChat = (row: OutreachRow) => localChat.get(chatKey(row)) ?? (row.lastChatCh ? { ch: row.lastChatCh, at: row.lastChatAt! } : null);

  // Just opens the chat with the message prefilled. Opening is NOT proof it was sent (the link
  // can fail, or you back out), so this logs nothing — you confirm with "Mark messaged".
  const openChat = (row: OutreachRow) => {
    if (!row.chatMethod || !row.chatHandle) return;
    const { text } = outreachCopy(row.segment, "chat", row.name, row.link, row.isSignup);
    const contact = { [row.chatMethod]: row.chatHandle };
    const href = contactLink(row.chatMethod, contact[row.chatMethod], text);
    if (row.chatMethod === "viber") navigator.clipboard?.writeText(text).catch(() => {});
    if (!href) { setNote(`Couldn't build a ${row.chatMethod} link for ${row.name}.`); return; }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  // Explicit "I actually messaged them" — records when + which channel + who, so staff don't
  // double-message. Optimistic, and rolls the badge back if the write fails (never shows a
  // messaged state that wasn't saved). Works for a referrer (referrerId) or ambassador (applicationId).
  const markMessaged = (row: OutreachRow) => {
    if (!row.chatMethod) return;
    const ch = row.chatMethod;
    setLocalChat(m => new Map(m).set(chatKey(row), { ch, at: new Date().toISOString() }));
    const body = row.kind === "ambassador" ? { applicationId: row.id, channel: ch } : { referrerId: row.id, channel: ch };
    fetch("/api/admin/referral-outreach/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(r => { if (!r.ok) throw new Error(); setNote(`Marked ${row.name} messaged on ${chatLabel[ch]}.`); })
      .catch(() => { setNote("Couldn't save that — try again."); setLocalChat(m => { const n = new Map(m); n.delete(chatKey(row)); return n; }); });
  };

  const openEmail = (row: OutreachRow) => {
    setNote("");
    const { subject, text } = outreachCopy(row.segment, "email", row.name, row.link, row.isSignup);
    setPreview({ row, subject, text });
  };

  const sendOne = async (row: OutreachRow, subject: string, text: string) => {
    const res = await fetch("/api/admin/referral-outreach/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: row.email, subject, text, applicationId: row.kind === "ambassador" ? row.id : undefined }) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error);
    return d;
  };

  const sendEmail = async () => {
    if (!preview?.row.email) return;
    setBusy(true); setNote("");
    try {
      const d = await sendOne(preview.row, preview.subject, preview.text);
      setSent(s => new Set(s).add(preview.row.id));
      setNote(`Emailed ${d.to}.`);
      setPreview(null);
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not send."); }
    finally { setBusy(false); }
  };

  const sendAll = async () => {
    const targets = visible.filter(r => r.email && !effSup(r).suppressed && !(r.contacted || sent.has(r.id)));
    if (!targets.length) { setNote("No one left to email in this view (all done, no email, or do-not-contact)."); return; }
    const segName = seg === "all" ? "all segments" : SEGMENT_LABEL[seg as OutreachSegment];
    if (!window.confirm(`Email the referral invite to ${targets.length} people in ${segName}?\n\nSkips anyone already emailed or on the do-not-contact list. Chat is not included.`)) return;
    setBatching(true); setBusy(true); setNote("");
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const { subject, text } = outreachCopy(row.segment, "email", row.name, row.link, row.isSignup);
      try { await sendOne(row, subject, text); setSent(s => new Set(s).add(row.id)); ok++; } catch { fail++; }
      setNote(`Sending… ${i + 1}/${targets.length}  (${ok} sent${fail ? `, ${fail} failed` : ""})`);
      await new Promise(r => setTimeout(r, 350)); // gentle pacing
    }
    setNote(`Done. Emailed ${ok}${fail ? `, ${fail} failed` : ""}.`);
    setBatching(false); setBusy(false);
  };

  const effSup = (row: OutreachRow) => (row.email && localSup.has(row.email)) ? localSup.get(row.email)! : { suppressed: row.suppressed, reason: row.suppressReason };
  const toggleSuppress = async (row: OutreachRow) => {
    if (!row.email) return;
    setNote("");
    try {
      if (effSup(row).suppressed) {
        const res = await fetch("/api/admin/referral-outreach/suppress", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: row.email }) });
        if (!res.ok) throw new Error((await res.json()).error);
        setLocalSup(m => new Map(m).set(row.email!, { suppressed: false, reason: null }));
        setNote(`${row.name} can be contacted again.`);
      } else {
        const reason = window.prompt(`Add a note — why not contact ${row.name}?`, "");
        if (reason === null) return; // cancelled
        const res = await fetch("/api/admin/referral-outreach/suppress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: row.email, reason: reason || undefined }) });
        if (!res.ok) throw new Error((await res.json()).error);
        setLocalSup(m => new Map(m).set(row.email!, { suppressed: true, reason: reason || null }));
        setNote(`${row.name} added to do-not-contact.`);
      }
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not update."); }
  };
  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  const chatLabel = { whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber" };

  return (
    <div style={{ padding: "20px 22px", font: `400 13px ${F}`, color: "var(--fg,#111)" }}>
      <h1 style={{ font: `800 20px ${F}`, margin: "0 0 4px" }}>Referral outreach</h1>
      <p style={{ color: "var(--muted,#647189)", margin: "0 0 16px", maxWidth: 680 }}>
        Invite people to the referral program. Email sends from info@linkedvelocity.com and is logged. WhatsApp / Telegram / Viber open the chat with the message prefilled — you hit send, then press &ldquo;Mark messaged&rdquo; to log it (when + channel) so no one doubles up. People with no referral link yet get pointed to the self-serve signup. Each row shows when they signed up; use &ldquo;Don&apos;t contact&rdquo; to add a note and keep someone off every list.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {SEG_ORDER.map(s => {
          const n = s === "all" ? (rows?.length || 0) : (counts[s] || 0);
          const on = seg === s;
          return <button key={s} onClick={() => setSeg(s)} style={{ ...btn, background: on ? "var(--link,#0a66c2)" : "var(--card,#fff)", color: on ? "#fff" : "var(--link,#0a66c2)" }}>
            {s === "all" ? "All" : SEGMENT_LABEL[s]} <span style={{ opacity: .7 }}>({n})</span>
          </button>;
        })}
        {convertedCount > 0 && (
          <button onClick={() => setConvOnly(v => !v)} title="People who signed up after we emailed them" style={{ ...btn, marginLeft: 4, background: convOnly ? "#188038" : "#e6f4ea", color: convOnly ? "#fff" : "#188038", borderColor: convOnly ? "#188038" : "#bfe3cb" }}>
            🎉 Signed up after email <span style={{ opacity: .85 }}>({convertedCount})</span>
          </button>
        )}
      </div>

      {rows && (() => {
        const eligible = visible.filter(r => r.email && !effSup(r).suppressed && !(r.contacted || sent.has(r.id))).length;
        return <div style={{ marginBottom: 14 }}>
          <button onClick={sendAll} disabled={busy || batching || !eligible} style={{ ...btn, background: eligible ? "var(--link,#0a66c2)" : "var(--card,#fff)", color: eligible ? "#fff" : "var(--muted2,#9aa0a6)", padding: "9px 16px", fontSize: 13 }}>
            {batching ? "Sending…" : `Send email to all ${eligible} in ${seg === "all" ? "all segments" : SEGMENT_LABEL[seg as OutreachSegment]}`}
          </button>
          <span style={{ marginLeft: 10, font: `500 11.5px ${F}`, color: "var(--muted,#8a97ad)" }}>Emails only · skips already-emailed + do-not-contact</span>
        </div>;
      })()}

      {error && <p style={{ color: "#c0392b" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--link,#0a66c2)", fontWeight: 600 }}>{note}</p>}
      {!rows && !error && <p style={{ color: "var(--muted,#647189)" }}>Loading…</p>}

      {rows && <div style={{ display: "grid", gap: 8 }}>
        {visible.map(row => {
          const done = row.contacted || sent.has(row.id);
          return <div key={`${row.kind}-${row.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", border: "1px solid var(--card-border,#e7ebf0)", borderRadius: 10, padding: "10px 13px", background: "var(--card,#fff)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{row.name || "—"} {done && <span style={{ font: `700 10px ${F}`, color: "#188038", background: "#e6f4ea", padding: "2px 7px", borderRadius: 999, marginLeft: 6 }}>✓ emailed</span>}{(() => { const c = effChat(row); return c ? <span title={`Messaged on ${chatLabel[c.ch]} ${fmtDate(c.at)}`} style={{ font: `700 10px ${F}`, color: "#0a66c2", background: "#e8f0fe", padding: "2px 7px", borderRadius: 999, marginLeft: 6 }}>💬 {chatLabel[c.ch]} {fmtDate(c.at)}</span> : null; })()}{row.signedUpAfterEmailAt && <span title={`Signed up ${fmtDate(row.signedUpAfterEmailAt)}, after we emailed them`} style={{ font: `700 10px ${F}`, color: "#fff", background: "#188038", padding: "2px 7px", borderRadius: 999, marginLeft: 6 }}>🎉 signed up after email</span>}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted,#8a97ad)", marginTop: 2 }}>
                <span style={{ color: SEG_COLOR[row.segment], fontWeight: 700 }}>{SEGMENT_LABEL[row.segment]}</span>
                {" · "}{row.email || "no email"}
                {" · "}{row.isSignup ? "signup CTA" : "has link"}
                {row.signedUpAt && <>{" · "}signed up {fmtDate(row.signedUpAt)}</>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
              {effSup(row).suppressed ? <>
                <span title={effSup(row).reason || undefined} style={{ font: `700 10.5px ${F}`, color: "#c0392b", background: "#fdecea", padding: "4px 10px", borderRadius: 999, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⛔ Do not contact{effSup(row).reason ? `: ${effSup(row).reason}` : ""}</span>
                <button style={btn} disabled={busy} onClick={() => toggleSuppress(row)}>Allow again</button>
              </> : <>
                <button style={{ ...btn, opacity: row.email ? 1 : .4 }} disabled={!row.email || busy} title={row.email ? "Review, then send" : "No email saved"} onClick={() => openEmail(row)}>Email</button>
                {row.chatMethod && row.chatHandle
                  ? <button style={btn} disabled={busy} title="Open the chat with the message prefilled" onClick={() => openChat(row)}>{chatLabel[row.chatMethod]}</button>
                  : <span style={{ font: `500 11px ${F}`, color: "var(--muted2,#9aa0a6)", alignSelf: "center" }}>no chat</span>}
                {row.chatMethod && (() => { const c = effChat(row); return <button style={{ ...btn, color: c ? "#188038" : "var(--link,#0a66c2)", borderColor: c ? "#bfe3cb" : "var(--line,#d6e4fb)" }} disabled={busy} title={c ? `Messaged on ${chatLabel[c.ch]} ${fmtDate(c.at)} — click to update` : "Log that you actually messaged them (records when + channel)"} onClick={() => markMessaged(row)}>{c ? "Messaged ✓" : "Mark messaged"}</button>; })()}
                {row.email && <button style={{ ...btn, color: "#c0392b", borderColor: "#f3c0ba" }} disabled={busy} title="Add to do-not-contact" onClick={() => toggleSuppress(row)}>Don&apos;t contact</button>}
              </>}
            </div>
          </div>;
        })}
        {!visible.length && <p style={{ color: "var(--muted,#647189)" }}>No one in this segment.</p>}
      </div>}

      {preview && <div role="dialog" aria-label="Review outreach email" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }} onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}>
        <div style={{ background: "var(--card,#fff)", borderRadius: 14, padding: 18, width: "min(640px,100%)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 10 }}>
          <b style={{ font: `700 14px ${F}` }}>Email to {preview.row.name} · {preview.row.email}</b>
          <input aria-label="Subject" style={{ ...btn, color: "var(--fg,#111)", width: "100%", boxSizing: "border-box" }} value={preview.subject} onChange={e => setPreview({ ...preview, subject: e.target.value })} />
          <textarea aria-label="Message" rows={16} style={{ ...btn, color: "var(--fg,#111)", width: "100%", boxSizing: "border-box", fontFamily: F }} value={preview.text} onChange={e => setPreview({ ...preview, text: e.target.value })} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            <button style={{ ...btn, background: "var(--link,#0a66c2)", color: "#fff" }} disabled={busy || !preview.subject.trim() || !preview.text.trim()} onClick={sendEmail}>{busy ? "Sending…" : "Send email"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
