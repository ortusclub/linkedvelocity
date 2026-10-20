import { createHmac } from "node:crypto";

export class EmailSetupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function onboardingEmailFrom() {
  return process.env.ONBOARDING_EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
}

export function emailSetupConfig() {
  const parseDomains = (v?: string) => (v || "").split(",").map(s => s.trim().toLowerCase()).filter(s => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(s));
  const domains = parseDomains(process.env.ONBOARDING_EMAIL_DOMAINS);
  // Extra domains we CAPTURE inbound LinkedIn mail from but never assign NEW onboarding emails
  // on — e.g. a deprecated domain (islandcorrespondence.lol) whose existing accounts we still
  // want to watch, without allocateOnboardingAddress round-robining new accounts onto it. Only
  // the capture gate reads captureDomains; assignment + "is this ours" checks stay on `domains`.
  const captureDomains = [...new Set([...domains, ...parseDomains(process.env.ONBOARDING_CAPTURE_EXTRA_DOMAINS)])];
  return { domains: [...new Set(domains)], captureDomains, enabled: process.env.ONBOARDING_EMAIL_ENABLED === "true",
    ready: process.env.ONBOARDING_EMAIL_ENABLED === "true" && domains.length > 0 && !!process.env.RESEND_API_KEY && !!onboardingEmailFrom() && !!process.env.RESEND_INBOUND_WEBHOOK_SECRET && !!process.env.ONBOARDING_EMAIL_CODE_SECRET };
}

export function assignedEmail(name: string, domain: string, collision = 0) {
  const parts = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).map(s => s.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const base = (parts.length > 1 ? `${parts[0]}.${parts.at(-1)}` : parts[0] || "account").slice(0, 35);
  return `${base}${collision ? collision + 1 : ""}@${domain}`;
}

export function hashEmailCode(id: string, destination: string, code: string) {
  const secret = process.env.ONBOARDING_EMAIL_CODE_SECRET;
  if (!secret) throw new EmailSetupError("Email verification is not configured.", 503);
  return createHmac("sha256", secret).update(`${id}:${destination}:${code}`).digest("hex");
}

export function forwardingActive(setup: { destinationVerifiedAt: Date | null; forwardingUntil: Date | null; consentAt: Date }, state: string, now = new Date()) {
  return state !== "confirmed" && !!setup.consentAt && !!setup.destinationVerifiedAt && !!setup.forwardingUntil && setup.forwardingUntil > now;
}

// Sender matching is a routing filter, NOT proof of sender authenticity or primary-email status.
export function linkedinSender(from: string) {
  const address = (from.match(/<([^<>]+)>\s*$/)?.[1] || from).trim().toLowerCase();
  return /^[^\s<>@]+@(?:[a-z0-9-]+\.)*linkedin\.com$/.test(address);
}

export function forwardedText(text: string | null, html: string | null) {
  if (text) return text.slice(0, 50000);
  return (html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_all, href: string, label: string) => {
      try {
        const url = new URL(href.replaceAll("&amp;", "&"));
        if (url.protocol === "https:" && /(^|\.)linkedin\.com$/.test(url.hostname) && !url.username && !url.password) return `${label} (${url.href})`;
      } catch { /* Ignore malformed links. */ }
      return label;
    }).replace(/<[^>]*>/g, " ").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").slice(0, 50000);
}
