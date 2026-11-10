import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Name tidying lives in its own dependency-free module so API routes and tests can
// import it without pulling in clsx/tailwind-merge.
export { formatName } from "@/lib/format-name";

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
