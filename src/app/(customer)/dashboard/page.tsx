"use client";

import { useEffect, useState, Suspense, Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/referral-currency";
import { useMeetingTimeZone } from "@/components/use-meeting-time-zone";
import { CompactDetail } from "@/components/compact-detail";
import { MeetingBooker } from "@/components/meeting-booker";
import { OnboardingPrice } from "@/components/onboarding-price";
import { CardTopUp } from "./card-topup";
import { AutoRecharge } from "./auto-recharge";
import { canShowRentalShareLink, isRentalBeingPrepared } from "@/lib/rental-dashboard-access";
import { startDashboardTour } from "@/lib/dashboard-tour";
import { canReplaceNow, replacementUnlockAt, REPLACEMENT_HOLD_MS } from "@/lib/replacement";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";

// Renter Dashboard v2 typography (scoped to this page, no layout change).
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

// v2 palette
const V = {
  blue: "#1550e8", green: "#12a150", ground: "#f6f8fb", text: "#0b1220",
  muted: "#5b6779", faint: "#8a93a3", border: "#e6e9ee", line: "#eef0f4",
  orange: "#ea580c", orangeDeep: "#c2410c", warnBg: "#fff7ed", warnBorder: "#fed7aa",
};

// Human-friendly duration from a start date to now (e.g. "3 months", "5 days", "today").
function humanDuration(from: string | Date): string {
  const d = Math.round((Date.now() - new Date(from).getTime()) / 864e5);
  if (d < 1) return "today";
  if (d < 31) return `${d} ${d === 1 ? "day" : "days"}`;
  const m = Math.floor(d / 30.4);
  return `${m} ${m === 1 ? "month" : "months"}`;
}

const initialsOf = (name: string) => name.split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

// Small "in ↗" chip linking out to the real LinkedIn profile.
function LinkedInChip({ url, onClick }: { url?: string | null; onClick?: (e: React.MouseEvent) => void }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" title="View LinkedIn profile" onClick={onClick}
      style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 2, padding: "2px 7px", borderRadius: 7, background: "#e8f0fe", color: "#0a66c2", fontWeight: 800, fontSize: 11.5, lineHeight: 1.2, textDecoration: "none" }}>
      in <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}><path d="M2.5 7.5L7.5 2.5M3.5 2.5h4v4" /></svg>
    </a>
  );
}
function VerifiedBadge() {
  return (
    <span title="Verified account" style={{ flex: "none", display: "inline-grid", placeItems: "center", width: 22, height: 19, borderRadius: 7, background: "#e8f0fe", color: V.blue }}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
    </span>
  );
}

// Sign-in credentials panel, shown only for renters with tiered credential access.
// Login email + password are delivered in the /api/rentals payload (already gated there);
// the 2FA code is fetched live from /api/rentals/[id]/signin-code so it always matches the
// current 30s TOTP window.
function RentalCredentials({ rental }: { rental: Rental }) {
  const acct = rental.linkedinAccount;
  const [showPass, setShowPass] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeExp, setCodeExp] = useState<number | null>(null);
  const [secsLeft, setSecsLeft] = useState(0);
  const [loadingCode, setLoadingCode] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);

  const copy = (val: string, which: string) => {
    try { navigator.clipboard?.writeText(val); setCopied(which); setTimeout(() => setCopied(null), 1200); } catch {}
  };

  const getCode = async () => {
    setLoadingCode(true); setCodeErr(null);
    try {
      const res = await fetch(`/api/rentals/${rental.id}/signin-code`);
      const data = await res.json();
      if (!res.ok) { setCodeErr(data.error || "Couldn't get a code."); setCode(null); setCodeExp(null); }
      else { setCode(data.code); setCodeExp(data.expiresAt); }
    } catch { setCodeErr("Couldn't get a code — try again."); }
    finally { setLoadingCode(false); }
  };

  useEffect(() => {
    if (!codeExp) return;
    const tick = () => {
      const left = Math.max(0, Math.round((codeExp - Date.now()) / 1000));
      setSecsLeft(left);
      if (left <= 0) { setCode(null); setCodeExp(null); }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [codeExp]);

  const CopyBtn = ({ val, id }: { val: string; id: string }) => (
    <button onClick={() => copy(val, id)}
      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-white hover:text-blue-700 cursor-pointer whitespace-nowrap">
      {copied === id ? "Copied" : "Copy"}
    </button>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 118 0v3" /></svg>
        <h4 className="text-sm font-semibold text-gray-900">Sign-in credentials</h4>
        <span className="ml-auto text-[11px] text-gray-400">Keep these private</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* login email */}
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Login email</p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-gray-900">{acct.accountEmail || "—"}</span>
            {acct.accountEmail && <CopyBtn val={acct.accountEmail} id="email" />}
          </div>
        </div>
        {/* password */}
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Password</p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-gray-900">{acct.accountPassword ? (showPass ? acct.accountPassword : "••••••••••••") : "—"}</span>
            {acct.accountPassword && (
              <>
                <button onClick={() => setShowPass((v) => !v)} className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-white hover:text-blue-700 cursor-pointer">{showPass ? "Hide" : "Show"}</button>
                <CopyBtn val={acct.accountPassword} id="pass" />
              </>
            )}
          </div>
        </div>
        {/* 2FA code */}
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">2FA code</p>
          <div className="flex items-center gap-3">
            {code ? (
              <>
                <span className="font-mono text-lg font-bold tracking-wider text-[#004182] tabular-nums">{code.replace(/(\d{3})(\d{3})/, "$1 $2")}</span>
                <span className="text-[11px] text-gray-400 tabular-nums">{secsLeft}s</span>
                <button onClick={getCode} className="ml-auto shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer">Refresh</button>
              </>
            ) : (
              <>
                <span className="text-[12px] text-gray-500">{codeErr || "Generate the current code"}</span>
                <button onClick={getCode} disabled={loadingCode} className="ml-auto shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60">{loadingCode ? "…" : "Get code"}</button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* 2FA secret key (TOTP seed) — for HeyReach / authenticator apps that answer 2-step themselves */}
      {acct.twoFactorSecret && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">2FA secret key <span className="font-normal normal-case text-gray-400">· for HeyReach / authenticator apps</span></p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-gray-900">{showSecret ? acct.twoFactorSecret : "••••••••••••••••••••••••••••••••"}</span>
            <button onClick={() => setShowSecret((v) => !v)} className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-white hover:text-blue-700 cursor-pointer">{showSecret ? "Hide" : "Show"}</button>
            <CopyBtn val={acct.twoFactorSecret} id="secret" />
          </div>
        </div>
      )}
    </div>
  );
}

interface ReplacementOption {
  id: string;
  linkedinName: string;
  linkedinHeadline: string | null;
  connectionCount: number;
  industry: string | null;
  location: string | null;
  profilePhotoUrl: string | null;
  linkedinVerified: boolean;
  hasSalesNav: boolean;
  monthlyPrice: number;
}

// Shared with the catalogue: unlocking the full roster there carries over to the picker here.
const FULL_KEY_STORAGE = "lv_full_roster_key";

// Picker modal for swapping a restricted rental to an equivalent available account (v2).
function ReplacementPicker({ rental, onClose, onReplaced }: { rental: Rental; onClose: () => void; onReplaced: () => void }) {
  const [options, setOptions] = useState<ReplacementOption[]>([]);
  const [oldPrice, setOldPrice] = useState<number | null>(null);
  // Upgrade support: what they pay now, days left to prorate over, whether upgrades are allowed
  // (non-shadow), and their wallet balance (upgrades are wallet-funded).
  const [effectiveRate, setEffectiveRate] = useState<number | null>(null);
  const [remainingDays, setRemainingDays] = useState(0);
  const [canUpgrade, setCanUpgrade] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filt, setFilt] = useState<"all" | "same" | "lower" | "upgrade">("all");
  const [submitting, setSubmitting] = useState(false);
  // Full-roster gate (mirrors the catalogue): without the password the picker only offers
  // the public slice; the password lifts it to the whole roster. Reload via reloadTick.
  const [fullList, setFullList] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyErr, setKeyErr] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const readKey = () => {
    if (typeof window === "undefined") return null;
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    if (fromUrl) { try { sessionStorage.setItem(FULL_KEY_STORAGE, fromUrl); } catch { /* ignore */ } return fromUrl; }
    try { return sessionStorage.getItem(FULL_KEY_STORAGE); } catch { return null; }
  };

  useEffect(() => {
    let stop = false;
    setLoading(true);
    const key = readKey();
    fetch(`/api/rentals/${rental.id}/replacement-options${key ? `?key=${encodeURIComponent(key)}` : ""}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (stop) return;
        if (!ok) { setError(data.error || "Couldn't load options."); return; }
        setError(null);
        setOptions(data.options || []);
        setOldPrice(typeof data.oldPrice === "number" ? data.oldPrice : null);
        setEffectiveRate(typeof data.effectiveRate === "number" ? data.effectiveRate : null);
        setRemainingDays(typeof data.remainingDays === "number" ? data.remainingDays : 0);
        setCanUpgrade(!!data.canUpgrade);
        setWalletBalance(typeof data.walletBalance === "number" ? data.walletBalance : 0);
        setFullList(!!data.fullList);
        // A supplied key that didn't unlock the roster is wrong — flag it and forget it.
        if (key && !data.fullList) { setKeyErr(true); try { sessionStorage.removeItem(FULL_KEY_STORAGE); } catch { /* ignore */ } }
      })
      .catch(() => { if (!stop) setError("Couldn't load options."); })
      .finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [rental.id, reloadTick]);

  const submitKey = (e: React.FormEvent) => {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k) return;
    setKeyErr(false);
    try { sessionStorage.setItem(FULL_KEY_STORAGE, k); } catch { /* ignore */ }
    setKeyInput("");
    setReloadTick((t) => t + 1);
  };
  const lockFull = () => {
    try { sessionStorage.removeItem(FULL_KEY_STORAGE); } catch { /* ignore */ }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("key")) {
      const u = new URL(window.location.href); u.searchParams.delete("key"); window.history.replaceState(null, "", u.toString());
    }
    setFullList(false);
    setReloadTick((t) => t + 1);
  };

  const confirm = async () => {
    if (!selected) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/rentals/${rental.id}/replace`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: selected }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Replacement failed."); setSubmitting(false); return; }
      onReplaced();
    } catch { setError("Replacement failed — try again."); setSubmitting(false); }
  };

  // A pick pricier than the restricted account's tier is a paid UPGRADE.
  const isUpgradeOf = (tier: number) => oldPrice != null && tier > oldPrice;
  const shown = options.filter((o) =>
    filt === "all" ? true
    : filt === "same" ? (oldPrice != null && o.monthlyPrice === oldPrice)
    : filt === "upgrade" ? isUpgradeOf(o.monthlyPrice)
    : (oldPrice != null && o.monthlyPrice < oldPrice));
  const picked = options.find((o) => o.id === selected);
  // The renter's actual (locked) rate — often discounted below the standard tier price. For a
  // same-or-lower pick they pay min(locked rate, tier) and never more; an upgrade moves them to
  // the new tier (no discount above their original band) and charges the prorated difference now.
  const lockedRate = effectiveRate ?? (typeof rental.price === "number" ? rental.price : oldPrice);
  const rateOf = (tier: number) => (isUpgradeOf(tier) ? tier : (lockedRate != null ? Math.min(lockedRate, tier) : tier));
  const upgradeDueOf = (tier: number) =>
    isUpgradeOf(tier) && lockedRate != null ? Math.round(((tier - lockedRate) / 30) * remainingDays * 100) / 100 : 0;
  const isDiscounted = lockedRate != null && oldPrice != null && lockedRate < oldPrice;
  const pickedDue = picked ? upgradeDueOf(picked.monthlyPrice) : 0;
  const shortBy = Math.max(0, Math.round((pickedDue - walletBalance) * 100) / 100);
  const summary = picked
    ? (isUpgradeOf(picked.monthlyPrice)
        ? (shortBy > 0
            ? `Upgrade costs $${pickedDue.toFixed(2)} now — add $${shortBy.toFixed(2)} to your wallet to continue (balance $${walletBalance.toFixed(2)}).`
            : `Pay $${pickedDue.toFixed(2)} now (prorated for ${remainingDays} ${remainingDays === 1 ? "day" : "days"} left), then $${picked.monthlyPrice}/mo from your next billing. Billing date unchanged.`)
        : isDiscounted
        ? `You keep your discounted rate: $${rateOf(picked.monthlyPrice)}/mo (standard $${picked.monthlyPrice}). Billing date unchanged.`
        : (oldPrice != null && picked.monthlyPrice < oldPrice ? `New rate $${picked.monthlyPrice}/mo from your next billing (was $${oldPrice}).` : `Same rate, $${oldPrice}/mo.`))
    : "Pick an account to continue.";
  const blockUpgrade = !!picked && isUpgradeOf(picked.monthlyPrice) && shortBy > 0;
  const chip = (k: "all" | "same" | "lower" | "upgrade", label: string) => (
    <button onClick={() => setFilt(k)} style={{ borderRadius: 999, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", border: `1px solid ${filt === k ? V.text : "#d5dbe5"}`, background: filt === k ? V.text : "#fff", color: filt === k ? "#fff" : V.text }}>{label}</button>
  );

  return (
    <div onClick={onClose} className={jakarta.className} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50, color: V.text }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: "calc(100vh - 40px)", background: "#fff", borderRadius: 18, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(11,18,32,.25)" }}>
        <div style={{ padding: "20px 22px 14px", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${V.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 19 }}>Replace {rental.linkedinAccount.linkedinName}</span>
            <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "none", fontWeight: 500, fontSize: 22, color: V.faint, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <span style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: V.muted }}>
            {isDiscounted ? (
              <>You&apos;re on a discounted rate of <b style={{ color: V.green }}>${lockedRate}/mo</b> <span style={{ textDecoration: "line-through", color: V.faint }}>${oldPrice}</span>. Same tier or lower keeps you at ${lockedRate}/mo, billing date unchanged.{canUpgrade && <> Want a premium account? <b>Upgrade</b> and just pay the prorated difference now.</>}</>
            ) : (
              <>Same tier or lower stays ${oldPrice ?? "—"}/mo, billing date unchanged.{canUpgrade && <> Want a premium account? <b>Upgrade</b> and just pay the prorated difference now.</>}</>
            )}
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{chip("all", "All")}{chip("same", "Same price")}{chip("lower", "Lower price")}{canUpgrade && chip("upgrade", "Upgrade ↑")}</div>
          {/* Full-roster gate — same password mechanism as the catalogue. */}
          {fullList ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, background: "#FFF7E6", border: "1px solid #F3D9A4", borderRadius: 9, padding: "7px 11px" }}>
              <span style={{ fontWeight: 600, fontSize: 12, color: "#7A4B00" }}>Full roster unlocked — every available account, not just the standard selection.</span>
              <button onClick={lockFull} style={{ marginLeft: "auto", flex: "none", border: "1px solid #7A4B00", background: "transparent", color: "#7A4B00", borderRadius: 7, padding: "4px 9px", fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}>Back to selection</button>
            </div>
          ) : (
            <form onSubmit={submitKey} style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ fontSize: 12, color: V.faint }}>Have a full-roster password?</span>
              <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Password" autoComplete="off" style={{ border: `1px solid ${keyErr ? "#b91c1c" : "#d5dbe5"}`, borderRadius: 7, padding: "5px 9px", fontSize: 12.5, width: 150 }} />
              <button type="submit" style={{ flex: "none", border: `1px solid ${V.text}`, background: V.text, color: "#fff", borderRadius: 7, padding: "5px 11px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Show full roster</button>
              {keyErr && <span style={{ fontSize: 11.5, color: "#b91c1c", width: "100%" }}>That password didn&apos;t work.</span>}
            </form>
          )}
        </div>

        <div style={{ overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <p style={{ padding: "32px 0", textAlign: "center", fontWeight: 500, fontSize: 13, color: V.muted }}>Loading available accounts…</p>
          ) : error && options.length === 0 ? (
            <p style={{ padding: "32px 0", textAlign: "center", fontWeight: 500, fontSize: 13, color: "#b91c1c" }}>{error}</p>
          ) : shown.length === 0 ? (
            <p style={{ padding: "32px 0", textAlign: "center", fontWeight: 500, fontSize: 13, color: V.muted }}>{options.length === 0 ? "No equivalent accounts are available right now. Please check back soon or contact our team." : "No accounts match this filter."}</p>
          ) : shown.map((o) => {
            const on = selected === o.id;
            return (
              <div key={o.id} onClick={() => setSelected(o.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${on ? V.blue : V.border}`, background: on ? "#f5f8ff" : "#fff" }}>
                <div style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", background: "#e8eefc", color: V.blue, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, overflow: "hidden" }}>
                  {o.profilePhotoUrl ? <img src={o.profilePhotoUrl} alt={o.linkedinName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsOf(o.linkedinName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.linkedinName}</span>
                    {o.linkedinVerified && <VerifiedBadge />}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 12, color: V.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[o.linkedinHeadline, `${o.connectionCount.toLocaleString()} connections`, o.location].filter(Boolean).join(" · ")}</div>
                </div>
                {(() => {
                  const up = isUpgradeOf(o.monthlyPrice);
                  if (up) {
                    const due = upgradeDueOf(o.monthlyPrice);
                    return (
                      <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        <span style={{ fontWeight: 800, fontSize: 13.5, color: V.text }}>${o.monthlyPrice}<span style={{ fontWeight: 500, color: V.faint }}>/mo</span></span>
                        <span style={{ fontWeight: 700, fontSize: 11, color: V.blue, whiteSpace: "nowrap" }}>+${due.toFixed(2)} now</span>
                      </span>
                    );
                  }
                  const eff = rateOf(o.monthlyPrice);
                  const disc = lockedRate != null && eff < o.monthlyPrice;
                  return disc ? (
                    <span style={{ flex: "none", display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ textDecoration: "line-through", textDecorationColor: "#c3c9d3", fontWeight: 500, fontSize: 12.5, color: V.faint }}>${o.monthlyPrice}</span>
                      <span style={{ fontWeight: 800, fontSize: 13.5, color: V.green }}>${eff}<span style={{ fontWeight: 500, color: V.faint }}>/mo</span></span>
                    </span>
                  ) : (
                    <span style={{ flex: "none", fontWeight: 700, fontSize: 13 }}>${o.monthlyPrice}<span style={{ fontWeight: 500, color: V.faint }}>/mo</span></span>
                  );
                })()}
                <span style={{ flex: "none", width: 18, height: 18, borderRadius: "50%", border: `2px solid ${on ? V.blue : "#c3c9d3"}`, display: "grid", placeItems: "center" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? V.blue : "transparent" }} /></span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${V.line}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 200px", fontWeight: 500, fontSize: 12.5, lineHeight: 1.45, color: error && options.length > 0 ? "#b91c1c" : V.muted }}>{error && options.length > 0 ? error : summary}</span>
          <button onClick={onClose} style={{ border: "1px solid #d5dbe5", background: "#fff", color: V.text, borderRadius: 9, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={confirm} disabled={!picked || submitting || blockUpgrade} style={{ border: "none", background: picked && !submitting && !blockUpgrade ? V.blue : "#a9c0f7", color: "#fff", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: picked && !blockUpgrade ? "pointer" : "default" }}>{submitting ? "Switching…" : blockUpgrade ? `Add $${shortBy.toFixed(2)} to upgrade` : picked && pickedDue > 0 ? `Pay $${pickedDue.toFixed(2)} & upgrade` : "Confirm replacement"}</button>
        </div>
      </div>
    </div>
  );
}

interface Rental {
  id: string;
  status: string;
  isShadow?: boolean;
  handoverAt?: string | null;
  shadowExitAt?: string | null;
  paused?: boolean;
  startDate: string;
  currentPeriodEnd: string | null;
  autoRenew: boolean;
  // Tiered credential access: true when this renter is flagged to see sign-in details
  // (login email, password, live 2FA) for the accounts they rent. Default false.
  credentialAccess?: boolean;
  // Self-serve replacement: set on a NEW rental that replaced a restricted one (points to
  // the old rental's id). The old rental carries status "replaced".
  replacesRentalId?: string | null;
  createdAt?: string;
  // What the renter pays (locked rate, else the account's current tier price).
  price?: number;
  // Set briefly after an account recovers from a restriction (explains the credited renewal date).
  recovery?: { at: string; creditedDays: number } | null;
  // Renter chose to keep waiting for recovery instead of replacing (persisted).
  waitingForRecovery?: boolean;
  // Banked downtime-credit days already added to this rental's renewal date (any cause).
  downtimeCreditDays?: number;
  // Open self-serve proxy-fix case: "swapped" (awaiting the renter's confirm) or "escalated".
  proxyFix?: { status: string; ticketRef: string; openedAt?: string } | null;
  // The exact email this renter must set GoLogin up with — shown on the "finish setup" card
  // while a rental is still pending access (that's the address we share the profile to).
  gologinLoginEmail?: string | null;
  linkedinAccount: {
    id: string;
    linkedinName: string;
    linkedinHeadline: string | null;
    linkedinUrl: string | null;
    accountEmail: string | null;
    accountPassword?: string | null;
    twoFactorSecret?: string | null;
    profilePhotoUrl: string | null;
    connectionCount: number;
    linkedinVerified?: boolean;
    gologinProfileId: string | null;
    gologinShareLink: string | null;
    restrictedAt: string | null;
    permanentlyRestricted?: boolean;
  };
}

interface AmbassadorAccount {
  id: string;
  linkedinUrl?: string | null;
  linkedinName: string;
  linkedinHeadline: string | null;
  notes: string | null;
  profilePhotoUrl: string | null;
  connectionCount: number;
  status: string;
  monthlyPrice: string | number;
  ambassadorPayment: string | number;
  gologinProfileId: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  removedAt: string | null;
  removedBy: string | null;
  createdAt: string;
  currency?: "PHP" | "USD"; // payout currency (follows the ambassador's referrer)
  rentals: Array<{ id: string; startDate: string; currentPeriodEnd: string | null }>;
}

interface Submission {
  linkedAccountId?: string | null;
  ownerAccount?: AmbassadorAccount;
  accountOnly?: boolean;
  setupInProgress?: boolean;
  resumeUrl?: string | null;
  deal?: { setupUsd: number; setupPhp: number; monthlyUsd: number; monthlyPhp: number };
  scheduledMeeting?: { id: string; startsAt: string; inviteSentAt: string | null; sequence: number } | null;
  id: string;
  fullName: string;
  email: string;
  linkedinEmail: string | null;
  linkedinUrl: string;
  status: string;
  createdAt: string;
  gologinShareLink: string | null;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[80vh] items-center justify-center"><div className="text-gray-400">Loading...</div></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const { timeZone: meetingTimeZone } = useMeetingTimeZone();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Admin "view as client": when ?view_as=<userId> is present, the dashboard renders that
  // renter's own data (the API honours it only for admins) and goes see-only — every
  // mutating action is disabled, so an admin can look without any risk of acting as them.
  const viewAsId = searchParams.get("view_as");
  const viewAs = !!viewAsId;
  const vqs = (u: string) => (viewAsId ? u + (u.includes("?") ? "&" : "?") + `view_as=${encodeURIComponent(viewAsId)}` : u);
  const [viewAsInfo, setViewAsInfo] = useState<{ name: string; email: string } | null>(null);
  const [meetingSubmissionId, setMeetingSubmissionId] = useState<string | null>(null);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [openCredsId, setOpenCredsId] = useState<string | null>(null);
  const [openLinkId, setOpenLinkId] = useState<string | null>(null);
  // Client-side "I'll wait" choice for restricted accounts past the recovery hold (hides the
  // replace nudge; resets on refresh — it's a soft dismiss, not a persisted decision).
  const [waitingIds, setWaitingIds] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState<string | null>(null);
  const [setupEmailCopied, setSetupEmailCopied] = useState<string | null>(null);
  const [replacingRental, setReplacingRental] = useState<Rental | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(t); }, []);
  const refreshRentals = () => {
    fetch(vqs("/api/rentals"), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.rentals)) setRentals(d.rentals); })
      .catch(() => {});
  };
  // Self-serve "fix my proxy": transient UI override while the renter reports/confirms. The
  // persisted truth is rental.proxyFix (swapped/escalated); this takes precedence mid-flow.
  const [proxyFix, setProxyFix] = useState<Record<string, { status: string; ticketRef?: string }>>({});
  const reportProxy = (rental: Rental) => {
    if (viewAs) return;
    setProxyFix((p) => ({ ...p, [rental.id]: { status: "fixing" } }));
    fetch(`/api/rentals/${rental.id}/proxy-fix`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => { setProxyFix((p) => ({ ...p, [rental.id]: { status: d.status, ticketRef: d.ticketRef } })); refreshRentals(); })
      .catch(() => setProxyFix((p) => ({ ...p, [rental.id]: { status: "escalated" } })));
  };
  const confirmProxy = (rental: Rental, working: boolean) => {
    if (viewAs) return;
    fetch(`/api/rentals/${rental.id}/proxy-fix/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ working }) })
      .then((r) => r.json())
      .then((d) => { setProxyFix((p) => ({ ...p, [rental.id]: working ? { status: "done" } : { status: "escalated", ticketRef: d.ticketRef } })); refreshRentals(); })
      .catch(() => {});
  };
  const dismissProxyFix = (rentalId: string) => setProxyFix((p) => { const n = { ...p }; delete n[rentalId]; return n; });
  const [ambassadorAccounts, setAmbassadorAccounts] = useState<AmbassadorAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState<string>("0");
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AmbassadorAccount | null>(null);
  const [editForm, setEditForm] = useState({ linkedinName: "", linkedinHeadline: "", linkedinUrl: "", industry: "", location: "", connectionCount: 0, profilePhotoUrl: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [removedAccounts, setRemovedAccounts] = useState<AmbassadorAccount[]>([]);
  const [deletingSubmission, setDeletingSubmission] = useState<string | null>(null);
  const [depositPolling, setDepositPolling] = useState(false);
  const [lastDetectedBalance, setLastDetectedBalance] = useState<string>("0");
  const [cardOnFile, setCardOnFile] = useState<{ brand: string | null; last4: string } | null>(null);

  const removeCard = async () => {
    if (viewAs) return;
    if (!confirm("Remove your saved card? Renewals won't be able to charge a shortfall not covered by your balance.")) return;
    const res = await fetch("/api/wallet/card", { method: "DELETE" });
    if (res.ok) setCardOnFile(null);
  };

  // Poll balance every 10 seconds when deposit panel is open
  useEffect(() => {
    if (!showTopUp) return;
    setDepositPolling(true);
    const prevBalance = usdcBalance;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(vqs("/api/wallet/balance"));
        const data = await res.json();
        const newBalance = data.balance || "0";
        if (parseFloat(newBalance) > parseFloat(prevBalance)) {
          setLastDetectedBalance((parseFloat(newBalance) - parseFloat(prevBalance)).toFixed(2));
          setUsdcBalance(newBalance);
          setTimeout(() => setLastDetectedBalance("0"), 5000);
        }
      } catch {}
    }, 10000);
    return () => { clearInterval(interval); setDepositPolling(false); };
  }, [showTopUp]);

  useEffect(() => {
    Promise.all([
      fetch(vqs("/api/rentals")).then((r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        return r.json();
      }),
      fetch("/api/ambassador/my-accounts").then((r) => r.json()).catch(() => ({ accounts: [] })),
      fetch(vqs("/api/wallet/balance")).then((r) => r.json()).catch(() => ({ balance: "0" })),
      fetch(vqs("/api/wallet/deposit-address")).then((r) => r.json()).catch(() => ({ address: null })),
      fetch("/api/ambassador/my-submissions", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ submissions: [] })),
      fetch(vqs("/api/wallet/card")).then((r) => r.json()).catch(() => ({ card: null })),
    ]).then(([rentalData, ambassadorData, balanceData, addressData, submissionsData, cardData]) => {
      if (rentalData) { setRentals(rentalData.rentals || []); setViewAsInfo(rentalData.viewAs || null); }
      setAmbassadorAccounts(ambassadorData.accounts || []);
      setRemovedAccounts(ambassadorData.removedAccounts || []);
      setUsdcBalance(balanceData.balance || "0");
      setDepositAddress(addressData.address || null);
      setSubmissions(submissionsData.submissions || []);
      setCardOnFile(cardData.card || null);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    if (loading) return;
    let stopped = false;
    let refreshing = false;
    const refreshSubmissions = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        await Promise.allSettled([
          fetch("/api/ambassador/my-submissions", { cache: "no-store" }).then(async response => {
            if (!response.ok) return;
            const data = await response.json();
            if (!stopped && Array.isArray(data.submissions)) setSubmissions(data.submissions);
          }),
          fetch("/api/ambassador/my-accounts", { cache: "no-store" }).then(async response => {
            if (!response.ok) return;
            const data = await response.json();
            if (!stopped && Array.isArray(data.accounts)) setAmbassadorAccounts(data.accounts);
            if (!stopped && Array.isArray(data.removedAccounts)) setRemovedAccounts(data.removedAccounts);
          }),
          fetch(vqs("/api/rentals"), { cache: "no-store" }).then(async response => {
            if (!response.ok) return;
            const data = await response.json();
            if (!stopped && Array.isArray(data.rentals)) setRentals(data.rentals);
          }),
        ]);
      } catch { /* Retain the current list while a refresh is unavailable. */ }
      finally { refreshing = false; }
    };
    const timer = window.setInterval(refreshSubmissions, 10000);
    window.addEventListener("focus", refreshSubmissions);
    document.addEventListener("visibilitychange", refreshSubmissions);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("focus", refreshSubmissions); document.removeEventListener("visibilitychange", refreshSubmissions); };
  }, [loading]);

  useEffect(() => {
    if (searchParams.get("topup") === "1") {
      setShowTopUp(true);
      setShowWithdraw(false);
    }
  }, [searchParams]);

  // Auto-run the guided tour once for new users, after the dashboard has rendered
  // (so the highlighted elements exist in the DOM).
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => startDashboardTour(false), 700);
    return () => clearTimeout(t);
  }, [loading]);

  const handleWithdraw = async () => {
    if (viewAs) return;
    setWithdrawing(true);
    setWithdrawError("");
    setWithdrawSuccess(false);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: withdrawAddress, amount: withdrawAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWithdrawError(data.error || "Withdrawal failed");
        return;
      }
      setWithdrawSuccess(true);
      setUsdcBalance((prev) => (parseFloat(prev) - parseFloat(withdrawAmount)).toString());
      setWithdrawAddress("");
      setWithdrawAmount("");
    } catch {
      setWithdrawError("Something went wrong");
    } finally {
      setWithdrawing(false);
    }
  };

  const [removeAccountId, setRemoveAccountId] = useState<string | null>(null);

  const handleRemoveAccount = async () => {
    if (viewAs) return;
    if (!removeAccountId) return;
    const res = await fetch(`/api/ambassador/accounts/${removeAccountId}`, { method: "DELETE" });
    if (res.ok) {
      const removed = ambassadorAccounts.find((a) => a.id === removeAccountId);
      setAmbassadorAccounts((prev) => prev.filter((a) => a.id !== removeAccountId));
      if (removed) {
        setRemovedAccounts((prev) => [{ ...removed, status: "removed", removedAt: new Date().toISOString(), removedBy: "ambassador" }, ...prev]);
      }
    }
    setRemoveAccountId(null);
  };

  const handleToggleStatus = async (account: AmbassadorAccount) => {
    const newStatus = account.status === "available" ? "unavailable" : "available";
    const res = await fetch("/api/ambassador/my-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id, status: newStatus }),
    });
    if (res.ok) {
      setAmbassadorAccounts((prev) =>
        prev.map((a) => a.id === account.id ? { ...a, status: newStatus } : a)
      );
    }
  };

  const openEditModal = (account: AmbassadorAccount) => {
    setEditingAccount(account);
    setEditForm({
      linkedinName: account.linkedinName || "",
      linkedinHeadline: account.linkedinHeadline || "",
      linkedinUrl: "",
      industry: "",
      location: "",
      connectionCount: account.connectionCount || 0,
      profilePhotoUrl: account.profilePhotoUrl || "",
    });
  };

  const handleEditSave = async () => {
    if (!editingAccount) return;
    setEditSaving(true);
    const res = await fetch("/api/ambassador/my-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingAccount.id,
        linkedinName: editForm.linkedinName,
        linkedinHeadline: editForm.linkedinHeadline || null,
        connectionCount: editForm.connectionCount,
        profilePhotoUrl: editForm.profilePhotoUrl || null,
      }),
    });
    if (res.ok) {
      setAmbassadorAccounts((prev) =>
        prev.map((a) =>
          a.id === editingAccount.id
            ? { ...a, linkedinName: editForm.linkedinName, linkedinHeadline: editForm.linkedinHeadline, connectionCount: editForm.connectionCount, profilePhotoUrl: editForm.profilePhotoUrl || null }
            : a
        )
      );
    }
    setEditSaving(false);
    setEditingAccount(null);
  };

  const toggleAutoRenew = async (rental: Rental) => {
    if (viewAs) return;
    const newVal = !rental.autoRenew;
    const res = await fetch(`/api/rentals/${rental.id}/auto-renew`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoRenew: newVal }),
    });
    if (res.ok) setRentals((prev) => prev.map((r) => (r.id === rental.id ? { ...r, autoRenew: newVal } : r)));
  };

  const currentRentals = rentals.filter((r) => r.status === "active" || r.status === "payment_failed" || r.status === "pending_access");
  // v2: restricted accounts stay inline in the main table, sorted to the top (then active, then preparing).
  const rentalRank = (r: Rental) => (r.linkedinAccount.restrictedAt ? 0 : isRentalBeingPrepared(r) ? 2 : 1);
  const sortedRentals = [...currentRentals].sort((a, b) => rentalRank(a) - rentalRank(b));
  const restrictedCount = currentRentals.filter((r) => !!r.linkedinAccount.restrictedAt).length;
  // Payment problems float to the very top so the renter can fix billing before anything renews.
  const paymentIssueRentals = currentRentals.filter((r) => r.status === "payment_failed");
  const paymentIssueTotal = paymentIssueRentals.reduce((t, r) => t + (r.price || 0), 0);
  // Earliest renewal date among the failing rentals — the deadline to fix things.
  const paymentIssueDueDate = paymentIssueRentals
    .map((r) => r.currentPeriodEnd)
    .filter((d): d is string => !!d)
    .sort((a, b) => a.localeCompare(b))[0];
  const openWalletToFix = () => {
    setShowTopUp(true);
    setShowWithdraw(false);
    if (!depositAddress) {
      fetch(vqs("/api/wallet/deposit-address")).then((r) => r.json()).then((data) => {
        if (data.address) setDepositAddress(data.address);
      }).catch(() => {});
    }
    if (typeof document !== "undefined") document.getElementById("wallet")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Downtime credit accrued so far across restricted accounts (added to the rental on recovery).
  // Uses the same per-account expression as the row-level "X days credited" (max(1, ceil)) so the
  // banner total always equals the sum of the per-account figures shown below.
  const downtimeCreditDays = currentRentals.reduce((t, r) => (r.linkedinAccount.restrictedAt ? t + Math.max(1, Math.ceil((nowTick - new Date(r.linkedinAccount.restrictedAt).getTime()) / 864e5)) : t), 0);
  // Banked/applied downtime credit: days already pushed onto renewal dates (any cause — a
  // restriction recovery, a swap, or our own proxy/infra outage). Persisted per rental, so this
  // is the settled figure, distinct from the live "accruing" estimate above.
  const bankedCreditDays = currentRentals.reduce((t, r) => t + (r.downtimeCreditDays || 0), 0);
  // Past rentals incl. "replaced" (the old side of a swap); newest first.
  const pastRentals = rentals
    .filter((r) => ["expired", "cancelled", "replaced"].includes(r.status))
    .sort((a, b) => (b.createdAt || b.startDate || "").localeCompare(a.createdAt || a.startDate || ""));
  // Replacement pairing (both directions): a NEW rental's replacesRentalId points to the OLD one.
  const rById = new Map(rentals.map((r) => [r.id, r]));
  // For a new (replacement) rental -> the account it replaced.
  const replacedAccountName = (r: Rental) => (r.replacesRentalId ? rById.get(r.replacesRentalId)?.linkedinAccount.linkedinName : undefined);
  // Downtime credit carried into a replacement: the new rental's billing date is pushed out past
  // the old rental's by exactly the restricted-account downtime (see replace route). Recover the
  // credited days from the gap so the swap row can show it.
  const replacementCreditDays = (r: Rental) => {
    if (!r.replacesRentalId || !r.currentPeriodEnd) return 0;
    const old = rById.get(r.replacesRentalId);
    if (!old?.currentPeriodEnd) return 0;
    const ms = new Date(r.currentPeriodEnd).getTime() - new Date(old.currentPeriodEnd).getTime();
    return ms > 0 ? Math.round(ms / 864e5) : 0;
  };
  // For an old (replaced) rental -> the account that replaced it.
  const swappedForName = new Map<string, string>();
  for (const r of rentals) if (r.replacesRentalId) swappedForName.set(r.replacesRentalId, r.linkedinAccount.linkedinName);
  // Adaptive dashboard: lean ambassador-first if they share/submit accounts.
  const profileKey = (url?: string | null) => (url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split(/[?#]/)[0].replace(/\/$/, "");
  const matchedAccounts = new Set<string>();
  const sharedAccounts: Submission[] = submissions.map(sub => {
    const account = ambassadorAccounts.find(account => !matchedAccounts.has(account.id) && (sub.linkedAccountId
      ? sub.linkedAccountId === account.id
      : !!sub.linkedinUrl && profileKey(account.linkedinUrl) === profileKey(sub.linkedinUrl)));
    if (account) matchedAccounts.add(account.id);
    return { ...sub, ownerAccount: account };
  });
  for (const account of ambassadorAccounts) {
    if (matchedAccounts.has(account.id)) continue;
    sharedAccounts.push({ id: account.id, fullName: account.linkedinName, email: account.notes?.match(/Profile email: ([^\s]+)/)?.[1]?.replace(/\.$/, "") || "", linkedinEmail: null, linkedinUrl: account.linkedinUrl || "", status: account.status, createdAt: account.createdAt, gologinShareLink: null, ownerAccount: account, accountOnly: true });
  }
  sharedAccounts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const isOnboardedAccount = (sub: Submission) => !sub.setupInProgress && (sub.status === "onboarded" || !!sub.ownerAccount && (sub.ownerAccount.rentals.length > 0 || ["available", "rented", "trial"].includes(sub.ownerAccount.status)));
  const sharedAccountGroups = [
    { label: "Onboarded accounts", rows: sharedAccounts.filter(isOnboardedAccount) },
    { label: "Accounts being onboarded", rows: sharedAccounts.filter(sub => !isOnboardedAccount(sub)) },
  ];
  const isAmbassador = ambassadorAccounts.length > 0 || submissions.length > 0;
  const hasRealRentals = currentRentals.length > 0 || pastRentals.length > 0;
  const showRenterSide = !isAmbassador || hasRealRentals; // pure ambassadors hide renter-only bits


  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-200" />)}
        </div>
      </div>
    );
  }

  const showRentalSuccess = searchParams.get("rental") === "success";

  return (
    <div className={`mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 ${jakarta.className}`} style={{ color: V.text }}>
      {viewAs && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20, padding: "11px 16px", borderRadius: 12, background: "#1f2937", color: "#fff" }}>
          <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>👁</span>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>
              Viewing {viewAsInfo?.name || "this renter"}&apos;s dashboard as a client
            </span>
            <span style={{ fontWeight: 500, fontSize: 12, color: "#c3cad6" }}>
              {viewAsInfo?.email ? `${viewAsInfo.email} · ` : ""}See-only — actions are disabled here.
            </span>
          </div>
          <a href="/admin/customers" style={{ marginLeft: "auto", flex: "none", textDecoration: "none", background: "#fff", color: "#1f2937", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12.5 }}>Exit view</a>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Dashboard</h1>
        <div className="flex items-center gap-2">
          {!isAmbassador && (
            <>
              <button
                onClick={() => startDashboardTour(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors whitespace-nowrap"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>
                Take a tour
              </button>
              <Link
                href="/catalogue"
                data-tour="browse"
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                Browse accounts
              </Link>
              <a
                href="/guide"
                data-tour="getting-started"
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                Getting started
              </a>
            </>
          )}
        </div>
      </div>

      {/* ===== Adaptive content reordered via flex order: renter actions + lists on top; ambassador guide pushed to the bottom (Sam) ===== */}
      <div className="flex flex-col">

      {/* Payment issue — pinned above everything so it's the first thing a renter fixes */}
      {showRenterSide && paymentIssueRentals.length > 0 && (
        <div style={{ order: -1, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: "14px 16px", background: "#fdecec", border: "1px solid #f3c2c2", borderRadius: 14, marginBottom: 20 }}>
          <span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: "#dc2626", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, marginTop: 1 }}>!</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, letterSpacing: "-.01em", color: "#991b1b" }}>
              Payment issue on {paymentIssueRentals.length === 1 ? "1 account" : `${paymentIssueRentals.length} accounts`}
            </p>
            <p style={{ margin: "3px 0 0", fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: "#7f1d1d" }}>
              {paymentIssueRentals.length === 1 ? "This rental couldn't renew." : "These rentals couldn't renew."} Add funds{paymentIssueTotal > 0 ? ` (about $${paymentIssueTotal}/mo needed)` : ""} or save a card{paymentIssueDueDate ? ` before ${formatDate(paymentIssueDueDate)}` : ""}, or they&apos;ll be returned to LinkedVelocity.
            </p>
          </div>
          <button
            onClick={openWalletToFix}
            style={{ flex: "none", border: "none", background: "#dc2626", color: "#fff", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", alignSelf: "center" }}
          >
            Fix payment
          </button>
        </div>
      )}

      {/* Ambassador getting-started — how the programme works */}
      {isAmbassador && (
        <div className="order-6 mb-8 overflow-hidden rounded-2xl border border-green-100 bg-gradient-to-br from-green-50/80 via-white to-white p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#00B85C]/10 text-base">💸</span>
              <p className="text-base font-bold text-gray-900">Turn your LinkedIn into monthly income</p>
            </div>
            <span className="text-xs font-medium text-green-700">Share as many accounts as you like — each one earns separately</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {[
              { t: "Share your profile", d: "Add your LinkedIn — or several. Takes 2 minutes.", icon: <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" /> },
              { t: "Book a call or do it yourself", d: "We can help you set up on a call, or complete the setup yourself for a larger sign-on bonus.", icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /> },
              { t: "We do the work", d: "We run outreach via GoLogin. You keep full control.", icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.042 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.746 3.746 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" /> },
              { t: "Get paid, every month", d: "Passive income at the start of every month — even while you sleep.", icon: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /> },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#00B85C] to-[#007A3D] text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>{s.icon}</svg>
                </div>
                <p className="text-sm font-bold text-gray-900">{s.t}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-green-100 pt-4 text-xs font-medium text-gray-600">
            <span className="inline-flex items-center gap-1"><span className="text-[#00B85C]">✓</span> You keep full control</span>
            <span className="inline-flex items-center gap-1"><span className="text-[#00B85C]">✓</span> Cancel anytime after 6 months</span>
            <span className="inline-flex items-center gap-1"><span className="text-[#00B85C]">✓</span> Paid monthly, guaranteed</span>
            <span className="inline-flex items-center gap-1"><span className="text-[#00B85C]">✓</span> Your network grows with high-level execs</span>
          </div>
        </div>
      )}

      {/* Post-payment confirmation — what to do now */}
      {showRentalSuccess && (
        <div className="mb-8 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-green-900">Payment received — your account is ready! 🎉</p>
              <p className="mt-1 text-sm text-green-800 leading-relaxed">
                From your rentals below, click <strong>&quot;Reveal GoLogin share link&quot;</strong> to get your access link, then open it in GoLogin. Just make sure GoLogin is installed and signed in with <strong>this same email</strong> — that&apos;s how your rented profile opens. New to GoLogin? Grab it free below and sign in with this email.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="https://gologin.com/download" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors">
                  Download GoLogin
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg>
                </a>
                <a href="/guide" className="inline-flex items-center gap-1.5 rounded-md border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors">
                  Read the guide
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wallet — renter side (top up to rent). Hidden for pure ambassadors. */}
      {showRenterSide && (
      <section id="wallet" data-tour="wallet" className="mb-8">
        <Card>
          <CardContent className="px-5 py-4">
            <div style={{ display: "flex", alignItems: "center", gap: "14px 28px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: V.faint }}>Balance</span>
                <span style={{ fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", color: V.text }}>${parseFloat(usdcBalance).toFixed(2)}</span>
              </div>
              {downtimeCreditDays > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 24, borderLeft: `1px solid ${V.line}` }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: V.faint }}>Downtime credit <span style={{ color: "#aab2c0" }}>· accruing on {restrictedCount} restricted {restrictedCount === 1 ? "account" : "accounts"}</span></span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: V.green }}>+{downtimeCreditDays} {downtimeCreditDays === 1 ? "day" : "days"}</span>
                  <span style={{ fontWeight: 500, fontSize: 10.5, color: "#aab2c0", lineHeight: 1.35 }}>Added to each when it&apos;s recovered or replaced. Accounts already credited aren&apos;t counted here.</span>
                </div>
              )}
              {bankedCreditDays > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 24, borderLeft: `1px solid ${V.line}` }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: V.faint }}>Downtime credit applied <span style={{ color: "#aab2c0" }}>· added to your renewal date</span></span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: V.green }}>+{bankedCreditDays} {bankedCreditDays === 1 ? "day" : "days"}</span>
                </div>
              )}
              {cardOnFile && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 24, borderLeft: `1px solid ${V.line}` }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: V.faint }}>Card on file <span style={{ color: "#aab2c0" }}>· covers renewal shortfalls</span></span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: V.text }}>{cardOnFile.brand ? `${cardOnFile.brand} ` : ""}•••• {cardOnFile.last4}
                    <button onClick={removeCard} style={{ border: "none", background: "none", fontWeight: 600, fontSize: 12.5, color: "#b91c1c", cursor: "pointer", marginLeft: 8 }}>Remove</button>
                  </span>
                </div>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button
                  disabled={viewAs}
                  onClick={() => {
                    setShowTopUp(!showTopUp);
                    setShowWithdraw(false);
                    if (!depositAddress) {
                      fetch(vqs("/api/wallet/deposit-address")).then(r => r.json()).then(data => {
                        if (data.address) setDepositAddress(data.address);
                      }).catch(() => {});
                    }
                  }}
                  style={{ border: "none", background: V.green, color: "#fff", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13.5, cursor: viewAs ? "not-allowed" : "pointer", opacity: viewAs ? 0.45 : 1 }}
                >
                  + Deposit
                </button>
                <button
                  disabled={viewAs}
                  onClick={() => { setShowWithdraw(!showWithdraw); setShowTopUp(false); }}
                  style={{ border: "1px solid #d5dbe5", background: "#fff", color: V.text, borderRadius: 9, padding: "9px 14px", fontWeight: 600, fontSize: 13.5, cursor: viewAs ? "not-allowed" : "pointer", opacity: viewAs ? 0.45 : 1 }}
                >
                  Withdraw
                </button>
              </div>
            </div>

            {/* Deposit Panel */}
            {showTopUp && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                {/* Crypto deposit */}
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Transfer USDC <span className="font-normal text-gray-400">— no fees</span></p>
                  {depositAddress ? (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 break-all text-gray-700">{depositAddress}</code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(depositAddress); setAddressCopied(true); setTimeout(() => setAddressCopied(false), 2000); }}
                        className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                      >
                        {addressCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">Loading your deposit address...</p>
                  )}
                  {lastDetectedBalance !== "0" ? (
                    <p className="text-xs text-green-600 font-semibold mt-1.5 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Deposit of ${lastDetectedBalance} USDC detected!
                    </p>
                  ) : depositPolling ? (
                    <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      Watching for deposits... Base network only.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1.5">Base network only. Unique to your account. Please allow up to one minute for deposits to be detected.</p>
                  )}
                </div>
                {/* Card deposit */}
                <CardTopUp />
                {!cardOnFile && (
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    We&apos;ll securely save this card so future renewals can cover any shortfall not met by your balance. You can remove it anytime.
                  </p>
                )}
                {/* Auto-recharge — keep the balance topped up from the saved card */}
                <AutoRecharge />
              </div>
            )}

            {/* Withdraw Panel */}
            {showWithdraw && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Wallet Address</label>
                    <input type="text" placeholder="0x..." value={withdrawAddress} onChange={(e) => setWithdrawAddress(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                    <input type="number" placeholder="0.00" step="0.01" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                  </div>
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing || !withdrawAddress || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > parseFloat(usdcBalance)}
                  className="w-full rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {withdrawing ? "Processing..." : "Withdraw"}
                </button>
                {withdrawError && <p className="text-xs text-red-600 mt-1">{withdrawError}</p>}
                {withdrawSuccess && <p className="text-xs text-green-600 mt-1">Withdrawal submitted!</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      )}

      {/* (Per v2 design: the old "Rent an Account" card is removed — the header's
          Browse-accounts button replaces it.) */}

      {/* Accounts I'm Renting Out — always shown (empty state when none); ordered to the bottom */}
        <section id="shared-accounts" className="mb-12 order-3">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 5, alignSelf: "stretch", minHeight: 40, borderRadius: 4, background: "#12a150", flex: "none" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", color: "#0f7a3d", lineHeight: 1.2 }}>Accounts I&apos;m Renting Out</h2>
              <p style={{ margin: "3px 0 0", fontWeight: 500, fontSize: 13.5, lineHeight: 1.45, color: V.muted }}>Your LinkedIn accounts shared on LinkedVelocity — you earn every month.</p>
            </div>
            <a href="/onboarding" title="Choose from three account setup options" style={{ flex: "none", border: "1px solid #bfe6cf", background: "#fff", color: "#0f7a3d", borderRadius: 9, padding: "8px 14px", fontWeight: 700, fontSize: 13, textDecoration: "none", whiteSpace: "nowrap" }}>+ Share an account</a>
          </div>
        {(() => { const sub = submissions.find(s => s.id === meetingSubmissionId); return sub ? <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="flex items-center justify-between gap-3"><strong>{sub.fullName} · Onboarding meeting</strong><button className="text-sm underline" onClick={() => setMeetingSubmissionId(null)}>Close</button></div>
          <MeetingBooker key={sub.id} applicationId={sub.id} email={sub.email} startRescheduling={!!sub.scheduledMeeting} onBooked={() => { void fetch("/api/ambassador/my-submissions", { cache: "no-store" }).then(r => r.json()).then(data => { if (Array.isArray(data.submissions)) setSubmissions(data.submissions); }); }} />
        </div> : null; })()}
          {sharedAccounts.length > 0 ? (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm" style={{ minWidth: 980 }}>
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">LinkedIn</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Your Deal</th>
                    <th className="px-3 py-3">Meeting</th>
                    <th className="px-3 py-3">Proxy</th>
                    <th className="px-3 py-3">Added</th>
                    <th className="px-3 py-3">Access</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sharedAccountGroups.filter(group => group.rows.length > 0).map(group => <Fragment key={group.label}>
                    <tr className="bg-green-50/60 border-b"><th colSpan={10} scope="rowgroup" className="px-3 py-3 text-left text-sm font-semibold text-green-800">{group.label} <span className="font-normal text-gray-500">({group.rows.length})</span></th></tr>
                  {group.rows.map((sub) => (
                    <tr key={sub.id} className="border-b last:border-b-0">
                      <td className="px-3 py-3 font-semibold text-gray-900"><CompactDetail summary={sub.fullName} title={sub.fullName} className="max-w-[120px]">{sub.fullName}</CompactDetail></td>
                      <td className="px-3 py-3 text-gray-500"><CompactDetail summary={sub.linkedinEmail || sub.email} title={sub.linkedinEmail || sub.email} className="max-w-[180px]"><span className="break-all">{sub.linkedinEmail || sub.email}</span></CompactDetail></td>
                      <td className="px-3 py-3">
                        <a href={sub.linkedinUrl} title={sub.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-sm font-medium truncate block max-w-[100px]">
                          {sub.linkedinUrl.replace(/https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
                        </a>
                      </td>
                      <td className="px-3 py-3">
                        {sub.setupInProgress && sub.resumeUrl ? <Link href={sub.resumeUrl} title="Continue setup where you left off" className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap">Setup in progress →</Link> : <Badge variant={sub.status === "approved" || sub.status === "onboarded" ? "success" : sub.status === "rejected" ? "danger" : "warning"}>
                          {sub.ownerAccount ? (sub.ownerAccount.rentals.length ? "Rented" : sub.ownerAccount.status === "available" ? "Available" : ["under_construction", "onboarding"].includes(sub.ownerAccount.status) ? "Setup in progress" : sub.ownerAccount.status.replaceAll("_", " ")) : sub.status === "onboarding" ? "Setup in progress" : sub.status}
                        </Badge>}
                      </td>
                      <td className="px-3 py-3">
                        {sub.deal ? <CompactDetail
                          summary={<><span className="font-semibold text-gray-900">${sub.deal.setupUsd} bonus</span><span className="text-gray-400"> · </span><span className="font-semibold text-green-700">${sub.deal.monthlyUsd}/mo</span></>}
                          title={`One-time sign-on bonus: $${sub.deal.setupUsd} (₱${sub.deal.setupPhp.toLocaleString("en-US")}). Monthly rate: $${sub.deal.monthlyUsd} (₱${sub.deal.monthlyPhp.toLocaleString("en-US")}), once onboarding is complete.`}>
                          <div className="font-semibold"><OnboardingPrice usd={sub.deal.setupUsd} php={sub.deal.setupPhp} /></div><div className="text-gray-500">One-time sign-on bonus</div>
                          <div className="mt-3 font-semibold text-green-700"><OnboardingPrice usd={sub.deal.monthlyUsd} php={sub.deal.monthlyPhp} /> /month</div><div className="text-gray-500">Once onboarding is complete</div>
                        </CompactDetail> : sub.ownerAccount && Number(sub.ownerAccount.ambassadorPayment) > 0 ? <span className="font-semibold text-green-700">{formatMoney(Number(sub.ownerAccount.ambassadorPayment), sub.ownerAccount.currency ?? "PHP")}/mo</span> : <span className="text-gray-400">To be confirmed</span>}
                      </td>
                      <td className="px-3 py-3">
                        {!sub.accountOnly ? <button className="inline-flex items-center rounded-lg border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50"
                          title={sub.scheduledMeeting ? `Reschedule meeting: ${new Date(sub.scheduledMeeting.startsAt).toLocaleString("en-PH", { timeZone: meetingTimeZone, dateStyle: "full", timeStyle: "short" })}. ${meetingTimeZone} · 30 minutes.` : "No meeting booked — book a 30-minute onboarding call"}
                          aria-label={sub.scheduledMeeting ? "Reschedule meeting" : "Book meeting"}
                          onClick={() => setMeetingSubmissionId(sub.id)}>
                          {sub.scheduledMeeting ? <>{new Date(sub.scheduledMeeting.startsAt).toLocaleString("en-PH", { timeZone: meetingTimeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ↗</> : "Book meeting"}
                        </button> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{sub.ownerAccount?.proxyHost ? "Assigned" : "—"}</td>
                      <td className="px-3 py-3 text-gray-400 text-sm"><time dateTime={sub.createdAt} title={formatDate(sub.createdAt)}>{new Date(sub.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time></td>
                      <td className="px-3 py-3">
                        {sub.setupInProgress && sub.resumeUrl ? <Link href={sub.resumeUrl} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap">Continue setup →</Link> : sub.gologinShareLink ? (
                          <button
                            onClick={() => {
                              // Extract path from share link and build gologin:// protocol URL
                              try {
                                const shareUrl = new URL(sub.gologinShareLink!);
                                const gologinProto = `gologin:/${shareUrl.pathname}`;
                                window.location.href = gologinProto;
                              } catch {
                                // Fallback: open share link in browser
                                window.open(sub.gologinShareLink!, "_blank");
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap cursor-pointer border-none"
                          >
                            GoLogin
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </button>
                        ) : (sub.status === "onboarded" || sub.status === "approved") ? (
                          <button
                            onClick={() => {
                              window.location.href = "gologin://";
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap cursor-pointer border-none"
                          >
                            GoLogin
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {sub.ownerAccount ? <div className="flex items-center justify-end gap-2">
                          {!sub.ownerAccount.rentals.length && ["available", "unavailable"].includes(sub.ownerAccount.status) && <button onClick={() => handleToggleStatus(sub.ownerAccount!)} className="rounded-md border px-2.5 py-1 text-xs font-medium">{sub.ownerAccount.status === "available" ? "Pause" : "Activate"}</button>}
                          <button onClick={() => setRemoveAccountId(sub.ownerAccount!.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
                        </div> : <button
                          onClick={async () => {
                            if (!confirm("Are you sure you want to delete this submission?")) return;
                            setDeletingSubmission(sub.id);
                            const res = await fetch(`/api/ambassador/my-submissions/${sub.id}`, { method: "DELETE" });
                            if (res.ok) {
                              setSubmissions((prev) => prev.filter((s) => s.id !== sub.id));
                            }
                            setDeletingSubmission(null);
                          }}
                          disabled={deletingSubmission === sub.id}
                          className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          {deletingSubmission === sub.id ? "Deleting..." : "Delete"}
                        </button>}
                      </td>
                    </tr>
                  ))}
                  </Fragment>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
          ) : (
            <div style={{ background: "#fff", border: `1px solid ${V.border}`, borderRadius: 14, padding: "30px 22px", textAlign: "center", fontWeight: 500, fontSize: 14, color: V.muted }}>
              You haven&apos;t shared any accounts yet.{" "}
              <a href="/onboarding" style={{ fontWeight: 700, color: "#0f7a3d", textDecoration: "none" }}>Share an account to start earning →</a>
            </div>
          )}
        </section>

      {/* Removed Accounts */}
      {removedAccounts.length > 0 && (
        <section className="mb-12 order-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Removed Accounts</h2>
            <span className="text-xs text-gray-400">Paper trail of removed accounts</span>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Profile</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Monthly Payment</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Removed</th>
                  </tr>
                </thead>
                <tbody>
                  {removedAccounts.map((account) => {
                    const price = typeof account.ambassadorPayment === "string"
                      ? parseFloat(account.ambassadorPayment)
                      : account.ambassadorPayment;
                    const initials = account.linkedinName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
                    const emailMatch = account.notes?.match(/Profile email: ([^.]+@[^.]+\.[^.]+)/);
                    const profileEmail = emailMatch ? emailMatch[1] : null;

                    return (
                      <tr key={account.id} className="border-b last:border-b-0 opacity-60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-400">
                              {initials}
                            </div>
                            <div>
                              <p className="font-medium text-gray-500">{account.linkedinName}</p>
                              {profileEmail && <p className="text-xs text-gray-400">{profileEmail}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                            Removed
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{price > 0 ? formatMoney(price, account.currency ?? "PHP") : "—"}</td>
                        <td className="px-4 py-3 text-gray-400">{formatDate(account.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-400">{account.removedAt ? formatDate(account.removedAt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Accounts I'm renting (v2) — restricted sorted to top, inline */}
      <section data-tour="rentals" className="mb-12 order-1">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 5, alignSelf: "stretch", minHeight: 40, borderRadius: 4, background: "#0b4fa8", flex: "none" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", color: "#0b4fa8", lineHeight: 1.2 }}>Accounts I&apos;m Renting</h2>
            <p style={{ margin: "3px 0 0", fontWeight: 500, fontSize: 13.5, lineHeight: 1.45, color: V.muted }}>Accounts you&apos;re renting from other members — open them in GoLogin. <Link href="/account-guide-v2" style={{ color: V.blue, fontWeight: 700, textDecoration: "none" }}>Account guide →</Link></p>
          </div>
          <span style={{ fontWeight: 600, fontSize: 13, color: V.faint, whiteSpace: "nowrap", marginTop: 2 }}>{currentRentals.length} {currentRentals.length === 1 ? "account" : "accounts"}</span>
        </div>

        {restrictedCount > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", background: V.warnBg, border: `1px solid ${V.warnBorder}`, borderRadius: 11, fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: "#7c2d12", marginBottom: 12 }}>
            <span style={{ flex: "none", width: 18, height: 18, borderRadius: "50%", background: V.orange, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 11, marginTop: 1 }}>!</span>
            <span><b>{restrictedCount === 1 ? "1 account is restricted." : `${restrictedCount} accounts are restricted.`}</b> Billing is paused and you get those days added back to your rental while we try to recover it (up to 2 days). If we can&apos;t, replace it with any account at the same price or lower — or upgrade to a premium one and just pay the prorated difference.</span>
          </div>
        )}

        {currentRentals.length === 0 ? (
          <div style={{ background: "#fff", border: "1px dashed #d5dbe5", borderRadius: 14, padding: 22, textAlign: "center", fontWeight: 500, fontSize: 13.5, color: V.muted }}>
            You&apos;re not renting any accounts yet. <Link href="/catalogue" style={{ color: V.blue, fontWeight: 600 }}>Browse accounts to rent →</Link>
          </div>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${V.border}`, borderRadius: 14, overflowX: "auto" }}>
            <div style={{ minWidth: 820 }}>
              {sortedRentals.map((rental, i) => {
                const acct = rental.linkedinAccount;
                const R = !!acct.restrictedAt;
                const prep = isRentalBeingPrepared(rental);
                const ready = canShowRentalShareLink(rental) && !!acct.gologinShareLink;
                const perm = R && !!acct.permanentlyRestricted;
                // Permanently-restricted accounts can be replaced right away (no hold to wait out).
                const eligible = R && (perm || canReplaceNow(acct.restrictedAt!));
                const isWaiting = R && (rental.waitingForRecovery === true || waitingIds.has(rental.id));
                const remH = R ? Math.max(0, Math.ceil((replacementUnlockAt(acct.restrictedAt!) - nowTick) / 3600000)) : 0;
                const creditDays = R ? Math.max(1, Math.ceil((nowTick - new Date(acct.restrictedAt!).getTime()) / 3600000 / 24)) : 0;
                const progress = R ? Math.min(100, Math.max(0, (nowTick - new Date(acct.restrictedAt!).getTime()) / REPLACEMENT_HOLD_MS * 100)) : 0;
                // Recently recovered (active, not restricted/prepping): show the green "recovered" treatment.
                // Only treat as "recovered" when days were actually credited — a sub-day
                // restriction that rounded to 0 downtime never surfaced to the renter, so it
                // reads as plain Active (the API already withholds these; this is defensive).
                const rec = (!R && !prep && rental.recovery && rental.recovery.creditedDays > 0) ? rental.recovery : null;
                const recDaysAgo = rec ? Math.floor((Date.now() - new Date(rec.at).getTime()) / 864e5) : 0;
                const recWhen = recDaysAgo <= 0 ? "today" : `${recDaysAgo} ${recDaysAgo === 1 ? "day" : "days"} ago`;
                const canSeeCreds = !!rental.credentialAccess;
                const credsOpen = openCredsId === rental.id;
                const linkOpen = openLinkId === rental.id;
                // Self-serve proxy fix: local override (mid-flow) wins over the persisted case.
                const pf = proxyFix[rental.id] ?? (rental.proxyFix ? { status: rental.proxyFix.status, ticketRef: rental.proxyFix.ticketRef } : undefined);
                const pfStatus = pf?.status; // fixing | swapped | done | escalated
                const canReportProxy = !R && !prep && !rental.paused && rental.status === "active" && ready && !pfStatus;
                // Paid but not live yet: the renter still has to finish GoLogin setup on their
                // end (install + sign in with the exact email we share to). We keep auto-granting
                // every ~30 min, so this clears itself once they've signed in — but until then we
                // show them exactly what to do instead of a dead "awaiting access" label.
                const pendingSetup = !R && !prep && !rental.paused && rental.status === "pending_access" && !ready;
                const setupEmail = rental.gologinLoginEmail || "";

                const cDays = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
                let sc = V.green, sl = "Active", ss = "Ready in GoLogin";
                if (rec) {
                  sc = V.green; sl = "Active · recovered"; ss = `Back ${recWhen} · ${cDays(rec.creditedDays)} added to your rental`;
                } else if (R) {
                  if (perm) { sc = "#b91c1c"; sl = "Permanently restricted"; ss = "This account can't be recovered. Replace it to keep going."; }
                  else if (isWaiting) { sc = V.orangeDeep; sl = "Restricted · waiting for recovery"; ss = `You chose to wait · billing paused · ${cDays(creditDays)} credited`; }
                  else { sc = eligible ? "#b91c1c" : V.orangeDeep; sl = eligible ? "Restricted · couldn't recover" : "Restricted · recovering"; ss = `Billing paused · ${cDays(creditDays)} credited`; }
                } else if (prep) { sc = V.faint; sl = "Being prepared"; ss = "We'll email you at handover"; }
                else if (rental.paused) { sc = V.faint; sl = "Paused"; ss = "Access paused"; }
                else if (rental.status === "payment_failed") { sc = "#b91c1c"; sl = "Payment issue"; ss = "Update your balance or card"; }
                else if (ready) { sc = V.green; sl = "Active"; ss = "Ready in GoLogin"; }
                else if (pendingSetup) { sc = V.blue; sl = "Setting up access"; ss = "Finish GoLogin setup to go live"; }
                else { sc = V.faint; sl = "Awaiting access"; ss = "Share link not available yet"; }

                const billL = R ? "Billing" : prep ? "Billing" : rental.autoRenew ? "Renews" : "Ends";
                const billV = R ? "Paused" : prep ? "Starts at handover" : rental.currentPeriodEnd ? formatDate(rental.currentPeriodEnd) : "—";
                const billNote = rec ? `+${cDays(rec.creditedDays)}` : "";
                const shareUrl = acct.gologinShareLink;

                return (
                  <div key={rental.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${V.line}`, background: R ? "#fffaf5" : rec ? "#f4fbf7" : "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1.2fr) 140px 250px", alignItems: "center", gap: "12px 20px", padding: "14px 18px" }}>
                      {/* profile */}
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: "none", width: 40, height: 40, borderRadius: "50%", background: "#e8eefc", color: V.blue, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, overflow: "hidden" }}>
                          {acct.profilePhotoUrl ? <img src={acct.profilePhotoUrl} alt={acct.linkedinName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsOf(acct.linkedinName)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                            <span style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{acct.linkedinName}</span>
                            <LinkedInChip url={acct.linkedinUrl} />
                            {acct.linkedinVerified && <VerifiedBadge />}
                          </div>
                          {/* Headline truncates, but the price is its own flex-none element so a
                              long headline can never ellipsize it away — the renter always sees $/mo. */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0, fontWeight: 500, fontSize: 12.5, color: V.muted }}>
                            {acct.linkedinHeadline && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.linkedinHeadline}</span>}
                            {rental.price != null && <span style={{ flex: "none", whiteSpace: "nowrap" }}>{acct.linkedinHeadline ? "· " : ""}${rental.price}/mo</span>}
                          </div>
                          <div style={{ fontWeight: 500, fontSize: 11.5, color: V.faint, whiteSpace: "nowrap" }}>Renting since {formatDate(rental.startDate)} · {humanDuration(rental.startDate)}</div>
                          {replacedAccountName(rental) && (
                            <div style={{ fontWeight: 600, fontSize: 11, color: V.orangeDeep, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>↔ Replaced {replacedAccountName(rental)}{replacementCreditDays(rental) > 0 && <span style={{ color: V.green }}> · {replacementCreditDays(rental)} {replacementCreditDays(rental) === 1 ? "day" : "days"} credited</span>}</div>
                          )}
                        </div>
                      </div>
                      {/* status */}
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: sc }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc }} />{sl}
                        </div>
                        <span style={{ fontWeight: 500, fontSize: 12, color: V.faint }}>{ss}</span>
                        {R && !eligible && !isWaiting && (
                          <div style={{ height: 4, maxWidth: 170, borderRadius: 4, background: "#fde3cc", overflow: "hidden" }}><div style={{ height: "100%", width: `${progress}%`, background: V.orange }} /></div>
                        )}
                        {canReportProxy && (
                          <button onClick={() => reportProxy(rental)} title="LinkedIn not loading or acting up in GoLogin? Report the proxy and we'll switch this account to a fresh one." style={{ alignSelf: "flex-start", border: "none", background: "none", padding: "0 0 0 2px", color: V.faint, fontWeight: 600, fontSize: 12, cursor: "pointer", textDecoration: "underline", textDecorationColor: "#c3c9d3", textUnderlineOffset: 3 }}>Proxy not working? Report it</button>
                        )}
                      </div>
                      {/* billing */}
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontWeight: 500, fontSize: 12, color: V.faint }}>{billL}</span>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{billV}{billNote && <span style={{ fontWeight: 700, fontSize: 11.5, color: V.green, marginLeft: 6 }}>{billNote}</span>}</span>
                        {!R && !prep && rental.status === "active" && (
                          <button onClick={() => toggleAutoRenew(rental)} disabled={viewAs} title="Turn auto-renew on or off" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, border: "none", borderRadius: 999, padding: "3px 10px 3px 4px", fontWeight: 700, fontSize: 11.5, cursor: viewAs ? "not-allowed" : "pointer", opacity: viewAs ? 0.5 : 1, background: rental.autoRenew ? "#e7f7ee" : "#f1f3f6", color: rental.autoRenew ? "#0f7a3d" : V.muted }}>
                            <span style={{ width: 22, height: 14, borderRadius: 999, background: rental.autoRenew ? V.green : "#c3c9d3", position: "relative", display: "block" }}><span style={{ position: "absolute", top: 2, left: rental.autoRenew ? 10 : 2, width: 10, height: 10, borderRadius: "50%", background: "#fff" }} /></span>
                            {rental.autoRenew ? "Auto-renew on" : "Auto-renew off"}
                          </button>
                        )}
                      </div>
                      {/* actions — fixed two-column grid: [sign-in / I'll wait] [open / replace] */}
                      <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "116px 132px", gap: 8, justifyContent: "end", alignItems: "center" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          {(!R && !prep && ready && canSeeCreds) ? (
                            <button onClick={() => setOpenCredsId((p) => (p === rental.id ? null : rental.id))} style={{ border: "1px solid #c9d6f5", background: "#fff", color: V.blue, width: 116, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "7px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>{credsOpen ? "Hide sign-in" : "Sign-in"}</button>
                          ) : (R && eligible && !isWaiting && !perm) ? (
                            <button onClick={() => { if (viewAs) return; setWaitingIds((p) => new Set(p).add(rental.id)); fetch(`/api/rentals/${rental.id}/wait`, { method: "POST" }).then(() => refreshRentals()).catch(() => {}); }} title="Keep this account. We'll keep trying to recover it, and billing stays paused." style={{ border: "1px solid #f5c39b", background: "#fff", color: "#9a3412", width: 116, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "7px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>I&apos;ll wait</button>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          {R ? (
                            isWaiting ? (
                              <button onClick={() => { if (viewAs) return; setReplacingRental(rental); }} style={{ border: "1px solid #f5c39b", background: "#fff", color: "#9a3412", width: 132, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "7px 0", fontWeight: 700, fontSize: 12.5, cursor: viewAs ? "not-allowed" : "pointer", opacity: viewAs ? 0.5 : 1, whiteSpace: "nowrap" }}>Replace instead</button>
                            ) : eligible ? (
                              <button onClick={() => { if (viewAs) return; setReplacingRental(rental); }} style={{ border: "none", background: V.orange, color: "#fff", width: 132, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12.5, cursor: viewAs ? "not-allowed" : "pointer", opacity: viewAs ? 0.5 : 1, whiteSpace: "nowrap" }}>Replace account</button>
                            ) : (
                              <span title="You can replace it if we haven't recovered it by then" style={{ width: 132, boxSizing: "border-box", textAlign: "center", border: "1px dashed #f5c39b", color: "#9a3412", borderRadius: 8, padding: "7px 0", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>Replace in {remH}h</span>
                            )
                          ) : prep ? (
                            <span style={{ width: 132, boxSizing: "border-box", textAlign: "center", border: "1px dashed #d5dbe5", color: V.faint, borderRadius: 8, padding: "7px 0", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>After handover</span>
                          ) : ready ? (
                            <button onClick={() => setOpenLinkId((p) => (p === rental.id ? null : rental.id))} style={{ border: "none", background: V.blue, color: "#fff", width: 132, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>{linkOpen ? "Hide link" : "Open in GoLogin"}</button>
                          ) : pendingSetup ? (
                            <a href="https://gologin.com/download" target="_blank" rel="noopener noreferrer" style={{ border: "none", background: V.blue, color: "#fff", width: 132, boxSizing: "border-box", textAlign: "center", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>Get GoLogin ↗</a>
                          ) : (
                            <span style={{ width: 132, boxSizing: "border-box", textAlign: "center", fontWeight: 600, fontSize: 12, color: V.faint, whiteSpace: "nowrap" }}>Not ready yet</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {pendingSetup && (
                      <div style={{ margin: "0 18px 16px", padding: 16, background: "#f5f8ff", border: "1px solid #dfe7fb", borderRadius: 12, display: "flex", flexDirection: "column", gap: 13 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "#1f2b45" }}>Two quick steps to go live — then you&apos;re set</span>
                          <span style={{ fontWeight: 500, fontSize: 12.5, lineHeight: 1.45, color: "#5b6779" }}>You run this profile inside GoLogin (free). Once you&apos;ve installed it and signed in with the email below, this account unlocks here <strong>automatically</strong> — usually within ~30 minutes. Nothing else to do.</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                          {/* Step 1 — install */}
                          <div style={{ display: "flex", gap: 9 }}>
                            <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", background: V.blue, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 11 }}>1</span>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                              <span style={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.4, color: "#3b4657" }}>Install GoLogin (free) and open it.</span>
                              <a href="https://gologin.com/download" target="_blank" rel="noopener noreferrer" style={{ background: V.blue, color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 700, fontSize: 12, textDecoration: "none" }}>Download GoLogin ↗</a>
                            </div>
                          </div>
                          {/* Step 2 — sign in with the exact email */}
                          <div style={{ display: "flex", gap: 9 }}>
                            <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", background: V.blue, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 11 }}>2</span>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                              <span style={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.4, color: "#3b4657" }}>Sign in to GoLogin with <strong>this exact email</strong> — it&apos;s how we share your profile:</span>
                              {setupEmail && (
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", maxWidth: "100%" }}>
                                  <span className={mono.className} style={{ background: "#fff", border: "1px solid #d5dbe5", borderRadius: 7, padding: "5px 9px", fontWeight: 600, fontSize: 12, color: V.text, wordBreak: "break-all" }}>{setupEmail}</span>
                                  <button onClick={() => { try { navigator.clipboard?.writeText(setupEmail); setSetupEmailCopied(rental.id); setTimeout(() => setSetupEmailCopied(null), 1500); } catch {} }} style={{ border: "1px solid #d5dbe5", background: "#fff", color: V.text, borderRadius: 7, padding: "5px 10px", fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>{setupEmailCopied === rental.id ? "Copied" : "Copy"}</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 11px", background: "#eef3ff", borderRadius: 9 }}>
                          <span aria-hidden style={{ fontSize: 13, lineHeight: 1.3 }}>✓</span>
                          <span style={{ fontWeight: 500, fontSize: 12, lineHeight: 1.45, color: "#3b4657" }}>That&apos;s it — the profile appears under &quot;Shared with me&quot; in GoLogin and this row flips to <strong>Active</strong> on its own. Prefer a different GoLogin email? Email <span style={{ fontWeight: 700 }}>info@linkedvelocity.com</span> and we&apos;ll point your access there.</span>
                        </div>
                      </div>
                    )}

                    {linkOpen && shareUrl && (
                      <div style={{ margin: "0 18px 16px", padding: 14, background: "#f5f8ff", border: "1px solid #dfe7fb", borderRadius: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span className={mono.className} style={{ flex: "1 1 280px", minWidth: 0, background: "#fff", border: "1px solid #d5dbe5", borderRadius: 8, padding: "8px 10px", fontWeight: 500, fontSize: 12.5, color: V.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shareUrl}</span>
                          <button onClick={() => { try { navigator.clipboard?.writeText(shareUrl); setLinkCopied(rental.id); setTimeout(() => setLinkCopied(null), 1500); } catch {} }} style={{ border: "1px solid #d5dbe5", background: "#fff", color: V.text, borderRadius: 8, padding: "7px 12px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>{linkCopied === rental.id ? "Copied" : "Copy"}</button>
                          <a href={shareUrl} target="_blank" rel="noreferrer" style={{ background: V.blue, color: "#fff", borderRadius: 8, padding: "8px 13px", fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>Open link ↗</a>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                          {[
                            "Open the link in a browser signed in to GoLogin with this same email",
                            "Refresh GoLogin: Cmd + R on Mac, Ctrl + R on Windows",
                            "Find it under “Shared with me”. It can take a minute or two.",
                          ].map((step, si) => (
                            <div key={si} style={{ display: "flex", gap: 8, fontWeight: 500, fontSize: 12.5, lineHeight: 1.45, color: "#3b4657" }}>
                              <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", background: V.blue, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 11 }}>{si + 1}</span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {canSeeCreds && credsOpen && (
                      <div style={{ padding: "0 18px 16px" }}>
                        <RentalCredentials rental={rental} />
                      </div>
                    )}

                    {pfStatus === "fixing" && (
                      <div style={{ margin: "0 18px 16px", padding: "13px 14px", background: "#f5f8ff", border: "1px solid #dfe7fb", borderRadius: 12, display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="animate-spin" style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", border: "2.5px solid #c9d6f5", borderTopColor: V.blue, display: "block" }} />
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 13.5 }}>Finding you a working proxy…</span>
                          <span style={{ fontWeight: 500, fontSize: 12.5, color: "#5b6779" }}>Usually a few seconds. You can stay on this page.</span>
                        </div>
                      </div>
                    )}

                    {pfStatus === "swapped" && (
                      <div style={{ margin: "0 18px 16px", padding: "13px 14px", background: "#f4fbf7", border: "1px solid #cdebd9", borderRadius: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 13.5, color: "#0b3d22" }}>You&apos;re on a new proxy. Is everything working?</span>
                          <span style={{ fontWeight: 500, fontSize: 12.5, lineHeight: 1.45, color: "#3b4657" }}>Close and reopen the profile in GoLogin, then load LinkedIn.</span>
                        </div>
                        <div style={{ flex: "none", display: "flex", gap: 8 }}>
                          <button onClick={() => confirmProxy(rental, false)} style={{ border: "1px solid #d5dbe5", background: "#fff", color: V.text, borderRadius: 8, padding: "8px 13px", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>No, still broken</button>
                          <button onClick={() => confirmProxy(rental, true)} style={{ border: "none", background: V.green, color: "#fff", borderRadius: 8, padding: "9px 15px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>Yes, working</button>
                        </div>
                      </div>
                    )}

                    {pfStatus === "done" && (
                      <div style={{ margin: "0 18px 16px", padding: "10px 14px", background: "#f4fbf7", border: "1px solid #cdebd9", borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "#0b3d22" }}>Fixed. Your new proxy is confirmed — thanks for checking.</span>
                        <button onClick={() => dismissProxyFix(rental.id)} title="Dismiss" style={{ border: "none", background: "none", color: "#5b6779", fontWeight: 500, fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>×</button>
                      </div>
                    )}

                    {pfStatus === "escalated" && (
                      <div style={{ margin: "0 18px 16px", padding: 14, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#7c2d12" }}>We&apos;ve got it from here</span>
                        <span style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: "#7c2d12" }}>We&apos;ve opened a ticket for this account&apos;s proxy and notified the team — we&apos;ll get this sorted and email you when it&apos;s fixed. No need to chase us.</span>
                        <div style={{ display: "flex", gap: "6px 18px", flexWrap: "wrap", fontWeight: 500, fontSize: 12, color: "#9a3412" }}>
                          {(pf?.ticketRef || rental.proxyFix?.ticketRef) && <span>Ticket <b>{pf?.ticketRef || rental.proxyFix?.ticketRef}</b></span>}
                          <span>Opened {rental.proxyFix?.openedAt ? formatDate(rental.proxyFix.openedAt) : "just now"}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Past Rentals (v2) */}
      {pastRentals.length > 0 && (
        <section className="mb-12 order-5">
          <details className="group">
            <summary className="mb-4 flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden">
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 17, color: V.text }}>Past rentals <span style={{ fontWeight: 600, fontSize: 13, color: V.faint, marginLeft: 6 }}>({pastRentals.length})</span></h2>
              <span style={{ fontWeight: 700, fontSize: 13, color: V.blue }}><span className="group-open:hidden">Show history</span><span className="hidden group-open:inline">Hide history</span><span aria-hidden="true" className="transition-transform group-open:rotate-180" style={{ marginLeft: 4, display: "inline-block" }}>⌄</span></span>
            </summary>
            <div style={{ background: "#fff", border: `1px solid ${V.border}`, borderRadius: 14, overflowX: "auto" }}>
              <div style={{ minWidth: 820 }}>
                {pastRentals.map((rental, i) => {
                  const acct = rental.linkedinAccount;
                  const st = rental.status === "replaced" ? "Replaced" : rental.status === "cancelled" ? "Cancelled" : "Expired";
                  const [stBg, stFg] = st === "Replaced" ? ["#fff1e6", "#c2410c"] : ["#f1f3f6", "#5b6779"];
                  const swappedFor = swappedForName.get(rental.id);
                  const why = rental.status === "replaced" ? (swappedFor ? `Restricted · swapped for ${swappedFor}` : "Restricted · swapped for a new account")
                    : rental.status === "cancelled" ? "You cancelled renewal"
                    : !rental.autoRenew ? "Auto-renew was off" : "Rental ended";
                  const end = rental.currentPeriodEnd ? formatDate(rental.currentPeriodEnd) : null;
                  const range = end ? `${formatDate(rental.startDate)} – ${end}` : formatDate(rental.startDate);
                  const len = humanDuration(rental.startDate);
                  return (
                    <div key={rental.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1.2fr) 160px 150px", gap: "12px 20px", alignItems: "center", padding: "12px 18px", borderTop: i === 0 ? "none" : `1px solid ${V.line}` }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: "none", width: 36, height: 36, borderRadius: "50%", background: "#f1f3f6", color: V.muted, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>{initialsOf(acct.linkedinName)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: V.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{acct.linkedinName}</span>
                            <LinkedInChip url={acct.linkedinUrl} />
                          </div>
                          {rental.price != null && <div style={{ fontWeight: 500, fontSize: 12, color: V.muted }}>${rental.price}/mo</div>}
                        </div>
                      </div>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "2px 9px", fontWeight: 700, fontSize: 11.5, background: stBg, color: stFg }}>{st}</span>
                        <span style={{ fontWeight: 500, fontSize: 12, color: V.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{why}</span>
                      </div>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: V.text }}>{range}</span>
                        <span style={{ fontWeight: 500, fontSize: 12, color: V.faint }}>{len}</span>
                      </div>
                      <div style={{ minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
                        <Link href="/catalogue" style={{ border: "1px solid #c9d6f5", background: "#fff", color: V.blue, borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>Rent again</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        </section>
      )}
      </div>
      {/* ===== end reordered account sections ===== */}



      {/* Remove Account Modal */}
      {removeAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRemoveAccountId(null)}>
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Remove this account?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Once removed, this account will no longer be listed and you will not receive any further monthly payments for it. This action cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRemoveAccountId(null)}>Keep Account</Button>
              <button
                onClick={handleRemoveAccount}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
              >
                Remove Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replacement picker */}
      {replacingRental && (
        <ReplacementPicker
          rental={replacingRental}
          onClose={() => setReplacingRental(null)}
          onReplaced={() => { setReplacingRental(null); refreshRentals(); fetch(vqs("/api/wallet/balance")).then((r) => r.json()).then((d) => { if (d.balance != null) setUsdcBalance(d.balance); }).catch(() => {}); }}
        />
      )}

      {/* Edit Listing Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingAccount(null)}>
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Listing</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-gray-200">
                  {editForm.profilePhotoUrl ? (
                    <img src={editForm.profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-gray-400">
                      {editForm.linkedinName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo URL</label>
                  <Input
                    value={editForm.profilePhotoUrl}
                    onChange={(e) => setEditForm(f => ({ ...f, profilePhotoUrl: e.target.value }))}
                    placeholder="https://example.com/photo.jpg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <Input
                  value={editForm.linkedinName}
                  onChange={(e) => setEditForm(f => ({ ...f, linkedinName: e.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Headline</label>
                <Input
                  value={editForm.linkedinHeadline}
                  onChange={(e) => setEditForm(f => ({ ...f, linkedinHeadline: e.target.value }))}
                  placeholder="e.g. Senior Software Engineer at Google"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Connections</label>
                <Input
                  type="number"
                  value={editForm.connectionCount}
                  onChange={(e) => setEditForm(f => ({ ...f, connectionCount: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
