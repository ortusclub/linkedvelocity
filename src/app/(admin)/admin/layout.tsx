"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { adminThemeVars, type AdminTheme } from "@/lib/admin-theme";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sans" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-grotesk" });

const sections = [
  { name: "Overview", items: [
    { href: "/admin/dashboard", label: "Dashboard" },
    { href: "/admin/inbound", label: "Inbound" },
    { href: "/admin/inbound-archive", label: "Inbound (Archive)" },
    { href: "/admin/crm", label: "CRM" },
    { href: "/admin/content", label: "Content" },
  ] },
  { name: "Renters", items: [
    { href: "/admin/renters", label: "Renters v3" },
    { href: "/admin/customers", label: "Renters" },
    { href: "/admin/rentals", label: "Rentals" },
    { href: "/admin/replacements", label: "Replacements" },
    { href: "/admin/profile-changes", label: "Profile changes" },
    { href: "/admin/transactions", label: "Transactions" },
    { href: "/admin/discounts", label: "Discounts" },
    { href: "/admin/emails", label: "Email log" },
  ] },
  { name: "Treasury", items: [
    { href: "/admin/treasury", label: "Treasury" },
  ] },
  { name: "Ambassadors", items: [
    // Pipeline replaces the old Applications / Ambassadors(owners) / Onboarding tabs.
    { href: "/admin/pipeline", label: "Pipeline" },
    { href: "/admin/onboarding-codes", label: "Verification codes" },
    { href: "/admin/referrals", label: "Referrals" },
    { href: "/admin/referral-outreach", label: "Outreach" },
    { href: "/admin/balances", label: "Payouts" },
    { href: "/admin/inventory-v2", label: "Inventory" },
    { href: "/admin/profile-maturing", label: "Profile Maturing" },
    { href: "/admin/restrictions", label: "Restrictions" },
    { href: "/admin/restrictions-v2", label: "Recovery" },
    { href: "/admin/proxies", label: "Proxies" },
    { href: "/admin/payouts-ii", label: "Payouts Schedule" },
  ] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [theme, setTheme] = useState<AdminTheme>("dark");

  useEffect(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("lv-admin-theme") : null;
    if (s === "light" || s === "dark") setTheme(s);
  }, []);
  const changeTheme = (t: AdminTheme) => { setTheme(t); try { localStorage.setItem("lv-admin-theme", t); } catch {} try { window.dispatchEvent(new CustomEvent("lv-admin-theme", { detail: t })); } catch {} };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user || data.user.role !== "admin") router.push("/login");
        else setAuthorized(true);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  const handleSignOut = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.push("/login"); }
  };

  if (!authorized) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const activeSection = sections.find((s) => s.items.some((i) => pathname.startsWith(i.href))) ?? sections[0];

  return (
    <div
      className={`${sans.variable} ${grotesk.variable}`}
      style={{ ...adminThemeVars(theme), minHeight: "100vh", background: "var(--page-bg)", color: "var(--text)", fontFamily: "var(--font-sans),system-ui,sans-serif", transition: "background .2s ease" }}
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Level 1: section tabs */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xl font-bold" style={{ color: "var(--text)" }}>Admin</span>
          <nav className="flex flex-wrap gap-1">
            {sections.map((s) => (
              <Link
                key={s.name}
                href={s.items[0].href}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                style={s.name === activeSection.name
                  ? { background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }
                  : { color: "var(--muted)" }}
              >
                {s.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center rounded-lg p-0.5" style={{ background: "var(--seg-bg)", border: "1px solid var(--seg-border)" }}>
              <button onClick={() => changeTheme("dark")} className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                style={theme === "dark" ? { background: "var(--text)", color: "var(--frame-bg)" } : { color: "var(--muted)", background: "transparent" }}>◗ Dark</button>
              <button onClick={() => changeTheme("light")} className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                style={theme === "light" ? { background: "var(--text)", color: "var(--frame-bg)" } : { color: "var(--muted)", background: "transparent" }}>◖ Light</button>
            </div>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{ border: "1px solid var(--card-border)", color: "var(--muted)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Sign out
            </button>
          </div>
        </div>

        {/* Level 2: sub-links */}
        <div className="mb-8 flex flex-wrap gap-2 py-3" style={{ borderTop: "1px solid var(--divider)", borderBottom: "1px solid var(--divider)" }}>
          {activeSection.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition-colors")}
              style={(pathname === item.href || pathname.startsWith(item.href + "/"))
                ? { background: "var(--blue-chip-bg)", color: "var(--blue-chip-text)" }
                : { background: "var(--card)", color: "var(--muted)", border: "1px solid var(--card-border)" }}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
