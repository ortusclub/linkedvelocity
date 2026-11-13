import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Display a person's name tidily even when it was entered in ALL CAPS
// (e.g. "AIZA MAE PULAO BARIATA" → "Aiza Mae Pulao Bariata"). Only fully-uppercase
// words are title-cased; already-mixed-case names are left alone so "McKay",
// "De Leon", "Hanna-Jen", and initials like "N." survive untouched.
export function formatName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().split(/\s+/).map((word) =>
    word.split("-").map((part) =>
      part.length > 1 && /[A-Z]/.test(part) && part === part.toUpperCase()
        ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        : part
    ).join("-")
  ).join(" ");
}

// Renter-facing display name: tidy the casing (via formatName) AND drop middle initials so
// long names fit in email tables. "Marian V. Araos" → "Marian Araos"; "AIRA FEJ ENCINARES" →
// "Aira Fej Encinares" (FEJ isn't an initial, so it stays). Only single-letter middle tokens
// (optionally with a trailing dot) are removed; the first and last word are always kept.
export function formatNameShort(name: string | null | undefined): string {
  const tidy = formatName(name);
  if (!tidy) return "";
  const words = tidy.split(/\s+/);
  if (words.length <= 2) return tidy;
  const isInitial = (w: string) => /^[A-Za-z]\.?$/.test(w);
  const kept = words.filter((w, i) => i === 0 || i === words.length - 1 || !isInitial(w));
  return kept.join(" ");
}

// Sales Navigator add-on: a flat +$70/mo layered on top of an account's base rate.
// Matches the catalogue banner ("add +$70/mo"). When a renter selects it, billing
// charges base + this amount and stores it as the rental's lockedPrice, so every
// renewal path (cron, webhook, exports, MRR) bills the add-on automatically.
export const SALES_NAV_MONTHLY = 70;

// Ambassador payouts are paid in Philippine pesos (₱500/mo, ₱1,000 setup) while rental
// revenue and everything else in the dashboard is USD. To combine them in a single USD
// figure (e.g. net profit) we convert PHP→USD at this rate. Update if the rate drifts.
export const PHP_PER_USD = 58;
export const phpToUsd = (php: number) => php / PHP_PER_USD;

// Ambassador payouts shown in their native pesos (₱1,234 — no cents; they're whole ₱).
export function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString("en-US")}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k+`;
  }
  if (num >= 100) {
    return `${Math.floor(num / 100) * 100}+`;
  }
  if (num > 0) {
    return "100+";
  }
  return num.toString();
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
