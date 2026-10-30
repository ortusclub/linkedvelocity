"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/brand";

// Marketing footer — shown on public/landing pages, hidden on app/admin/auth pages.
const HIDE_PREFIXES = ["/guide/primary-email", "/admin", "/dashboard", "/login", "/register", "/profile", "/checkout", "/m"];

const CALENDAR_URL =
  "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1he_qAS5s8faJzrAIjTJi8KIX9xvPhGbC4Ipn38lPTLzkfSuoyMIiqUrB0viY2jpXr_W_zLSdq";

export function Footer({ brand }: { brand: Brand }) {
  const pathname = usePathname() || "";
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // LinkedArmy homepage ships its own footer.
  if (brand.id === "linkedarmy" && pathname === "/") return null;
  const telegramUrl = `https://t.me/${brand.supportTelegram.replace(/^@/, "")}`;
  const brandSuffix = brand.name.replace(/^Linked/, "");

  return (
    <footer className="lv-footer">
      <style>{`
        .lv-footer{background:#0B1A2E;color:rgba(255,255,255,0.7);font-size:13px;font-family:'Karla',system-ui,sans-serif}
        .lv-foot-inner{max-width:1200px;margin:0 auto;padding:56px 40px 36px;display:grid;grid-template-columns:1.3fr 2fr;gap:48px}
        .lv-foot-logo{display:flex;align-items:center;gap:9px;font-family:'Montserrat',sans-serif;font-weight:700;font-size:20px;color:#fff;letter-spacing:-0.02em}
        .lv-foot-mark{width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .lv-foot-velo{color:#00B85C}
        .lv-foot-slogan{margin:8px 0 0;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.42)}
        .lv-foot-tag{margin:12px 0 16px;max-width:300px;line-height:1.6;color:rgba(255,255,255,0.6)}
        .lv-foot-chat{display:inline-flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-weight:600;border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:9px 14px;font-size:13px;transition:background .15s}
        .lv-foot-chat:hover{background:rgba(255,255,255,0.08)}
        .lv-foot-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
        .lv-foot-col b{display:block;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;font-weight:700}
        .lv-foot-col a{display:block;color:rgba(255,255,255,0.62);text-decoration:none;margin:9px 0;font-size:14px;transition:color .15s}
        .lv-foot-col a:hover{color:#fff}
        .lv-foot-bottom{border-top:1px solid rgba(255,255,255,0.1);max-width:1200px;margin:0 auto;padding:20px 40px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;color:rgba(255,255,255,0.5);font-size:12.5px}
        .lv-foot-legal{display:flex;gap:20px}
        .lv-foot-legal a{color:rgba(255,255,255,0.5);text-decoration:none}
        .lv-foot-legal a:hover{color:#fff}
        @media(max-width:760px){.lv-foot-inner{grid-template-columns:1fr;gap:32px;padding:40px 20px 28px}.lv-foot-cols{grid-template-columns:1fr 1fr}.lv-foot-bottom{padding:18px 20px}}
      `}</style>
      <div className="lv-foot-inner">
        <div>
          <div className="lv-foot-logo">
            {brand.id === "linkedarmy" ? (
              <span style={{ width: 32, height: 32, borderRadius: 8, background: "#e4fb25", color: "#0e404b", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>L</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt={brand.name} width={32} height={32} style={{ borderRadius: 8 }} />
            )}
            <span>Linked<span className="lv-foot-velo">{brandSuffix}</span></span>
          </div>
          <p className="lv-foot-slogan">{brand.term.slogan}</p>
          <p className="lv-foot-tag">{brand.term.footerBlurb}</p>
          <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="lv-foot-chat">💬 Chat with us on Telegram</a>
        </div>
        {brand.id !== "linkedarmy" && (
          <div className="lv-foot-cols">
            <div className="lv-foot-col">
              <b>Product</b>
              <Link href="/catalogue">Browse profiles</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/how-it-works">How it works</Link>
              <Link href="/blog">Blog</Link>
              <Link href="/faqs">FAQs</Link>
            </div>
            <div className="lv-foot-col">
              <b>For ambassadors</b>
              <Link href="/become-ambassador">Earn with your account</Link>
              <Link href="/become-ambassador">How payouts work</Link>
              <Link href="/ambassador-guide">What to expect</Link>
              <Link href="/ambassador-terms">Ambassador terms</Link>
            </div>
            <div className="lv-foot-col">
              <b>Company</b>
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer">Book a meeting</a>
              <a href={telegramUrl} target="_blank" rel="noopener noreferrer">Contact</a>
              <a href="#">About</a>
            </div>
          </div>
        )}
      </div>
      <div className="lv-foot-bottom">
        <span>© 2026 {brand.name}. All rights reserved.</span>
        <div className="lv-foot-legal"><a href="#">Privacy</a><a href="#">Terms</a></div>
      </div>
    </footer>
  );
}
