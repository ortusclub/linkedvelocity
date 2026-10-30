export type IssueContact = { email?: string | null; whatsapp?: string | null; telegram?: string | null; viber?: string | null };

export function contactLink(channel: keyof IssueContact, handle: string | null | undefined, message: string): string | null {
  const value = (handle || "").trim();
  if (!value) return null;
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${encodeURIComponent(value)}?subject=${encodeURIComponent("LinkedVelocity: account access issue")}&body=${encodeURIComponent(message)}` : null;
  if (channel === "viber") {
    const phone = value.replace(/^viber:\s*/i, "");
    if (!/^\+?[\d\s().-]+$/.test(phone)) return null;
    const digits = phone.replace(/\D/g, "");
    return /^[1-9]\d{7,14}$/.test(digits) ? `viber://chat?number=${encodeURIComponent("+" + digits)}` : null;
  }
  if (channel === "whatsapp") {
    const phone = value.replace(/^(?:whatsapp|phone):\s*/i, "");
    if (!/^\+?[\d\s().-]+$/.test(phone)) return null;
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
  }
  const username = value.match(/(?:t\.me\/|@)([a-z][a-z0-9_]{3,31})/i)?.[1] || value.replace(/^telegram:\s*/i, "");
  if (/^[a-z][a-z0-9_]{3,31}$/i.test(username)) return `https://t.me/${username}?text=${encodeURIComponent(message)}`;
  const phone = value.replace(/^telegram:\s*/i, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? `https://t.me/${phone}?text=${encodeURIComponent(message)}` : null;
}

// Build the contactable channels for an ambassador from their saved contact number/handle.
// A t.me / @username handle resolves to Telegram only. A phone number is normalised (local PH
// 09xxxxxxxxx → +63) and then offered on WhatsApp, Telegram AND Viber, so the team can reach
// them on whichever app they use — the recorded `channel` is a hint, not a restriction (gating
// on it used to hide every mobile button for plain 09… numbers). Email always passes through.
export function ambassadorIssueContact(email: string | null, phone: string | null, channel: string | null, location?: string | null): IssueContact {
  const raw = `${channel || ""} ${phone || ""}`.trim();
  if (!phone?.trim()) return { email, whatsapp: null, telegram: null, viber: null };
  // A Telegram username / t.me link is not a phone — Telegram only.
  if (/(?:t\.me\/|@)[a-z][a-z0-9_]{3,31}/i.test(raw)) return { email, whatsapp: null, telegram: phone, viber: null };
  // Otherwise treat it as a phone number and normalise to international form.
  let digits = phone.replace(/\D/g, "");
  const isPH = /philippines|\bPH\b|manila/i.test(location || "");
  if (digits.startsWith("0") && (isPH || /^0?9\d{9}$/.test(digits))) digits = "63" + digits.slice(1);
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return { email, whatsapp: null, telegram: null, viber: null };
  const intl = "+" + digits;
  return { email, whatsapp: intl, telegram: intl, viber: intl };
}

// Direct "message them now" links for a raw contact number/handle, across all the apps, so the
// team can reach a contact on whichever one they use. A local PH mobile (09xxxxxxxxx) is
// formatted to +63 so Viber / WhatsApp / Telegram all resolve even when no channel was recorded.
// A t.me / @username handle resolves to Telegram only.
export function messagingLinks(value: string | null | undefined, location?: string | null): { viber?: string; whatsapp?: string; telegram?: string } {
  const v = (value || "").trim();
  if (!v) return {};
  const uname = v.match(/(?:t\.me\/|@)([a-z][a-z0-9_]{3,31})/i)?.[1];
  if (uname) return { telegram: `https://t.me/${uname}` };
  let digits = v.replace(/\D/g, "");
  if (!digits) return {};
  const isPH = /philippines|\bPH\b|manila/i.test(location || "");
  if (digits.startsWith("0") && (isPH || /^0?9\d{9}$/.test(digits))) digits = "63" + digits.slice(1);
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return {};
  return {
    viber: `viber://chat?number=${encodeURIComponent("+" + digits)}`,
    whatsapp: `https://wa.me/${digits}`,
    telegram: `https://t.me/+${digits}`,
  };
}

/** Contact cards deliberately contain no account credentials or recovery links. */
export function viberContactCard(name: string, handle: string | null | undefined): { phone: string; contents: string } | null {
  const link = contactLink("viber", handle, "");
  if (!link) return null;
  const phone = new URL(link).searchParams.get("number")!;
  const escapedName = name.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  return { phone, contents: ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapedName}`, `N:;${escapedName};;;`, `TEL;TYPE=CELL:${phone}`, "END:VCARD", ""].join("\r\n") };
}
