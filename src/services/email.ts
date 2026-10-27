import { Resend } from "resend";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { type Currency, CURRENCY_CONFIG, formatMoney } from "@/lib/referral-currency";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}
const from = process.env.RESEND_FROM_EMAIL || "LinkedVelocity <noreply@linkedvelocity.com>";
// Where internal admin notifications (top-ups, rentals) are sent.
const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "info@linkedvelocity.com";

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  bcc?: string | string[];
  replyTo?: string;
  from?: string; // override the default sender (e.g. force noreply@ for one-way marketing)
}

// BCC the team inbox on billing/renewal emails so there's visibility of what went out to renters
// (reminders, charges, failures) without checking the Resend dashboard.
const billingBcc = adminEmail;

// Capture mode: when set, sendEmail records the composed email instead of sending it. Lets the
// admin "upcoming emails" forecast render the REAL templates (identical to what the cron sends)
// without dispatching anything. Admin-only / low-traffic; renders are awaited one at a time.
let _capture: { to: string | string[]; subject: string; html: string; bcc?: string | string[] }[] | null = null;
export async function renderEmail(
  fn: () => Promise<unknown>
): Promise<{ to: string | string[]; subject: string; html: string; bcc?: string | string[] } | null> {
  const prev = _capture;
  _capture = [];
  try {
    await fn();
    return _capture[0] ?? null;
  } finally {
    _capture = prev;
  }
}

async function sendEmail({ to, subject, html, bcc, replyTo, from: fromOverride }: EmailOptions) {
  if (_capture) { _capture.push({ to, subject, html, bcc }); return; }
  let status: "sent" | "failed" | "skipped" = "sent";
  let errorMsg: string | null = null;
  try {
    if (!process.env.RESEND_API_KEY) {
      console.log(`[Email] Would send to ${to}${bcc ? ` (bcc ${bcc})` : ""}: ${subject}`);
      status = "skipped";
    } else {
      const result = await getResend().emails.send({ from: fromOverride || from, to, subject, html, ...(bcc ? { bcc } : {}), ...(replyTo ? { replyTo } : {}) });
      if (result.error) throw new Error(result.error.message);
    }
  } catch (e) {
    status = "failed";
    errorMsg = e instanceof Error ? e.message : String(e);
  }
  // In-app email log — a record of everything we send (to/subject/status), so the team can see
  // what went out without the Resend dashboard. Best-effort: logging must never break sending.
  try {
    await prisma.$executeRaw`
      INSERT INTO email_log (id, "to", subject, bcc, status, error, body, created_at)
      VALUES (${randomUUID()}, ${Array.isArray(to) ? to.join(", ") : to}, ${subject},
              ${bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc) : null}, ${status}, ${errorMsg}, ${html}, now())`;
  } catch (e) {
    console.error("[Email] log write failed:", e);
  }
  // Preserve prior behaviour: throw on a real send failure so callers don't mark things as sent.
  if (status === "failed") throw new Error(errorMsg ?? "email send failed");
}

export async function sendVerificationCode(email: string, code: string) {
  return sendEmail({
    to: email,
    subject: `Your LinkedVelocity verification code: ${code}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
        <h2 style="color:#2563eb;margin-bottom:8px;">LinkedVelocity</h2>
        <p style="color:#374151;font-size:15px;">Enter this code to sign in:</p>
        <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#111827;">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">&mdash; The LinkedVelocity Team</p>
      </div>
    `,
  });
}

// Shared branded wrapper so all customer emails look consistent.
function brandWrap(inner: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:36px 24px;color:#0F1419;">
      <h2 style="color:#0A66C2;margin:0 0 24px;font-size:22px;letter-spacing:-0.02em;">LinkedVelocity</h2>
      ${inner}
      <p style="color:#8899A6;font-size:12px;margin-top:32px;border-top:1px solid #E8E6E1;padding-top:16px;">
        Need help? Message us on Telegram <a href="https://t.me/linkedvelocity_support_bot" style="color:#0A66C2;text-decoration:none;">@linkedvelocity_support_bot</a> &nbsp;·&nbsp;
        <a href="${appUrl}/dashboard" style="color:#0A66C2;text-decoration:none;">Your dashboard</a>
      </p>
      <p style="color:#8899A6;font-size:12px;margin-top:8px;">&mdash; The LinkedVelocity Team</p>
    </div>
  `;
}

// Sent right after a user signs up — the most important touchpoint. Welcomes them
// and points to the guide so they know exactly how it all works before renting.
export async function sendSignupWelcomeEmail(email: string, fullName: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const firstName = (fullName || "").trim().split(" ")[0] || "there";
  return sendEmail({
    to: email,
    subject: `Welcome to LinkedVelocity, ${firstName} 👋`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>Welcome aboard, ${firstName}!</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">LinkedVelocity gives you access to real, established LinkedIn accounts so you can scale your outreach without creating new profiles or hiring more people.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 24px;">Here's everything you need to get started — how it works, setting up GoLogin, daily limits, and using your account safely:</p>
      <a href="${appUrl}/guide" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin-bottom:14px;">Read the getting-started guide</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:14px 0 0;">Ready to dive in? <a href="${appUrl}/catalogue" style="color:#0A66C2;font-weight:600;">Browse available accounts →</a></p>
    `),
  });
}

// Sent right after an AMBASSADOR signs up (the share-your-account side). Toned for
// earning, not renting — points them back to finish their application.
export async function sendAmbassadorSignupWelcomeEmail(email: string, fullName: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const firstName = (fullName || "").trim().split(" ")[0] || "there";
  return sendEmail({
    to: email,
    subject: `Welcome to LinkedVelocity, ${firstName} 👋 — let's get you earning`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>Welcome aboard, ${firstName}!</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">You're all set to share your LinkedIn account and earn a monthly payout — your account stays safely yours, it's just used for outreach.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px;"><strong>What's next:</strong></p>
      <ol style="font-size:14px;color:#374151;line-height:1.8;margin:0 0 20px;padding-left:20px;">
        <li>Choose how you'd like to get paid (bank, crypto, PayPal, or Wise).</li>
        <li>Share your profile securely through GoLogin — <strong>your password stays private.</strong></li>
        <li>That's it — you start earning on the next monthly payout.</li>
      </ol>
      <a href="${appUrl}/become-ambassador" style="display:inline-block;background:#00B85C;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Finish setting up →</a>
    `),
  });
}

// Sent right after someone signs up as a REFERRER on /become-a-referrer. Gives them
// their share link and dashboard so they can start sending people straight away.
export async function sendReferrerWelcomeEmail(email: string, name: string, shareUrl: string, portalUrl: string) {
  const firstName = (name || "").trim().split(" ")[0] || "there";
  return sendEmail({
    to: email,
    subject: `You're a LinkedVelocity referrer, ${firstName} — here's your link`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>You're all set, ${firstName}.</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">You earn ₱500 for every person who signs up through your link, or up to ₱1,000 when you help them get set up. You're paid the same day they are.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px;">Your referral link:</p>
      <p style="font-size:15px;margin:0 0 20px;"><a href="${shareUrl}" style="color:#0A66C2;font-weight:700;">${shareUrl}</a></p>
      <a href="${portalUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Open your dashboard →</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:18px 0 0;">Start with friends and family. Verified or not, we accept both. Your dashboard is where you track sign-ups, add your payout details, and see what you've earned.</p>
    `),
  });
}

// Referral-outreach campaign email (/admin/referral-outreach). Takes the plain campaign
// copy, renders it in the branded wrapper (links made clickable), and logs to email_log.
export async function sendReferralOutreachEmail(to: string, subject: string, bodyText: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = bodyText.replace(/\n*—\s*LinkedVelocity\s*$/, "").trimEnd(); // brandWrap adds the sign-off
  const html = brandWrap(
    esc(body)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0A66C2;font-weight:600;text-decoration:none;">$1</a>')
      .replace(/\n/g, "<br>")
  );
  return sendEmail({ to, subject, html });
}

// Pings the team when someone signs up as a referrer via /become-a-referrer, so the
// team knows (they also appear at the top of /admin/referrals).
export async function sendReferrerSignupNotification(name: string, email: string, slug: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const to = process.env.TEAM_NOTIFY_EMAIL || "info@linkedvelocity.com";
  return sendEmail({
    to,
    subject: `New referrer signed up: ${name}`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;margin:0 0 10px;"><strong>${name}</strong> just signed up as a referrer.</p>
      <p style="font-size:14px;color:#536471;line-height:1.7;margin:0 0 16px;">Email: ${email}<br>Code: ${slug}<br>Link: <a href="${appUrl}/r/${slug}" style="color:#0A66C2;">${appUrl}/r/${slug}</a></p>
      <a href="${appUrl}/admin/referrals?ref=${encodeURIComponent(slug)}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">Open in admin →</a>
    `),
  });
}

// Pings the team when a renter's self-serve proxy fix couldn't be completed automatically
// (no spare proxy, the new one failed its check, or the renter said it's still broken). The
// renter sees a tracked ticket; this is the team's cue to fix it by hand. Mirrors
// sendReferrerSignupNotification: internal recipient via TEAM_NOTIFY_EMAIL.
export async function sendProxyEscalation(opts: {
  ticketRef: string;
  accountName: string;
  renterEmail: string;
  reason: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const to = process.env.TEAM_NOTIFY_EMAIL || "info@linkedvelocity.com";
  const reasonText: Record<string, string> = {
    no_proxy_available: "No spare proxy was free to swap to (buy or free one up).",
    verify_failed: "The new proxy failed its connection check and we rolled back to the old one.",
    renter_still_broken: "The renter says it's still broken after an automatic swap.",
    error: "The automatic swap errored out.",
  };
  return sendEmail({
    to,
    subject: `Proxy escalation ${opts.ticketRef} — ${opts.accountName}`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;margin:0 0 10px;">A renter reported a proxy problem we couldn't fix automatically.</p>
      <p style="font-size:14px;color:#536471;line-height:1.7;margin:0 0 16px;">Account: <strong>${opts.accountName}</strong><br>Renter: ${opts.renterEmail}<br>Ticket: <strong>${opts.ticketRef}</strong><br>Reason: ${reasonText[opts.reason] || opts.reason}</p>
      <a href="${appUrl}/admin/proxies" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">Open proxies admin →</a>
    `),
  });
}

// Fired when an admin marks an account-security email "Wasn't us" — an incident is open and the
// account may be compromised. Internal only (TEAM_NOTIFY_EMAIL), mirrors sendProxyEscalation. The
// recommended-response steps shown in the email match the in-app checklist by email type.
export async function sendAccountMailAlert(opts: {
  accountName: string;
  accountId: string;
  type: string;
  typeLabel: string;
  subject: string;
  receivedAt: Date;
  openedBy: string;
  steps: string[];
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const to = process.env.TEAM_NOTIFY_EMAIL || "info@linkedvelocity.com";
  const when = opts.receivedAt.toLocaleString("en-GB", { timeZone: "Asia/Manila", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const stepsHtml = opts.steps.map((s) => `<li style="margin:0 0 6px;">${s}</li>`).join("");
  return sendEmail({
    to,
    subject: `⚠ Account-mail incident — ${opts.accountName} (${opts.typeLabel})`,
    html: brandWrap(`
      <p style="font-size:15px;color:#b91c1c;font-weight:700;margin:0 0 10px;">An account-security email was flagged "Wasn't us" — treat this account as possibly compromised.</p>
      <p style="font-size:14px;color:#536471;line-height:1.7;margin:0 0 16px;">Account: <strong>${opts.accountName}</strong><br>Event: <strong>${opts.typeLabel}</strong> — ${opts.subject}<br>Received: ${when} (PHT)<br>Opened by: ${opts.openedBy}</p>
      <p style="font-size:14px;color:#111827;font-weight:600;margin:0 0 6px;">Recommended response</p>
      <ol style="font-size:14px;color:#536471;line-height:1.6;margin:0 0 16px;padding-left:20px;">${stepsHtml}</ol>
      <a href="${appUrl}/admin/inventory-v2" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">Open inventory →</a>
    `),
  });
}

// Sent immediately after payment (card or USDC). Access is granted by our team
// after vetting + freeing the account internally — so this email is about what to
// do NOW (set up GoLogin) and what to expect, not "you're live yet".
export async function sendRentalOnboardingEmail(email: string, accountName: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  return sendEmail({
    to: email,
    subject: `You're in! Let's get "${accountName}" ready for you`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>Thanks for your rental — ${accountName} is reserved for you. 🎉</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 24px;">Here's exactly what happens next. Step 1 is on you and takes 2 minutes — please do it now so we can hand over access smoothly.</p>

      <div style="background:#F3F8FE;border:1px solid #D6E3F2;border-radius:12px;padding:18px 20px;margin-bottom:14px;">
        <p style="margin:0 0 4px;font-weight:700;font-size:15px;color:#0A66C2;">Step 1 — Set up GoLogin (do this now)</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;"><strong>New to GoLogin?</strong> Download it free at <a href="https://gologin.com/download" style="color:#0A66C2;">gologin.com/download</a> and create your account with <strong>this exact email (${email})</strong>. <strong>Already have GoLogin?</strong> Just make sure you're signed in with <strong>this email</strong>. It has to match — we share the account with the GoLogin account on this email.</p>
      </div>

      <div style="background:#F7F7F4;border:1px solid #E8E6E1;border-radius:12px;padding:18px 20px;margin-bottom:14px;">
        <p style="margin:0 0 4px;font-weight:700;font-size:15px;">Step 2 — We get it ready (within 24 hours)</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Our team prepares and verifies the account, then shares the profile to your GoLogin. Sharing can take a few minutes to appear after we send it.</p>
      </div>

      <div style="background:#F7F7F4;border:1px solid #E8E6E1;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:700;font-size:15px;">Step 3 — You're live</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">You'll get a "your account is ready" email. Open the profile from GoLogin (or your dashboard) and you're in — LinkedIn already logged in.</p>
      </div>

      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">New to this? Read our short guide on <a href="${appUrl}/guide" style="color:#0A66C2;font-weight:600;">how renting works &amp; using LinkedIn safely with us →</a></p>

      <a href="${appUrl}/guide" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Read the renting guide</a>
    `),
  });
}

// Fired automatically when an admin clicks "Grant access" — the renter is now live.
// One consolidated email for a whole rental order (avoids a burst of near-identical
// per-account emails that Gmail threads / Resend rate-limits).
export async function sendRentalReadyEmail(email: string, accounts: { name: string; ready: boolean }[]) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const count = accounts.length;
  const headline = count === 1
    ? `You're live — <strong>${accounts[0].name}</strong> is ready to use.`
    : `You're live — your <strong>${count} rented accounts</strong> are ready to use.`;
  const list = accounts
    .map((a) => `<li style="margin:0 0 4px;"><strong>${a.name}</strong>${a.ready ? "" : ' <span style="color:#8899A6;">— being prepared, ready shortly</span>'}</li>`)
    .join("");
  return sendEmail({
    to: email,
    subject: count === 1 ? `Your LinkedIn account "${accounts[0].name}" is ready 🎉` : `Your ${count} LinkedIn accounts are ready 🎉`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 12px;">${headline}</p>
      <ul style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;padding-left:20px;">${list}</ul>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px;">We've shared ${count === 1 ? "it" : "them"} to your GoLogin (<strong>${email}</strong>). Here's how to open:</p>
      <p style="font-size:13px;color:#536471;line-height:1.6;margin:0 0 16px;"><strong>New to GoLogin?</strong> Get it free at <a href="https://gologin.com/download" style="color:#0A66C2;">gologin.com/download</a> and sign in with this email first.</p>
      <ol style="font-size:14px;color:#374151;line-height:1.8;margin:0 0 24px;padding-left:20px;">
        <li>Open the <strong>GoLogin</strong> app (signed in with ${email}).</li>
        <li>Find the shared profile${count === 1 ? "" : "s"} in your dashboard — may take a few minutes to appear.</li>
        <li>Click <strong>Start</strong> to launch the browser with LinkedIn already logged in.</li>
      </ol>
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin-bottom:20px;">Open your dashboard</a>
      <p style="font-size:13px;color:#536471;line-height:1.6;margin:20px 0 0;">Please follow our <a href="${appUrl}/guide" style="color:#0A66C2;">safe-use guide</a> to keep the account${count === 1 ? "" : "s"} healthy. Always access through GoLogin, and don't change login or profile details.</p>
    `),
  });
}

export async function sendAccessReadyEmail(email: string, accountName: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  return sendEmail({
    to: email,
    subject: `Your LinkedIn account "${accountName}" is ready 🎉`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>You're live — ${accountName} is ready to use.</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px;">We've shared the account to your GoLogin (<strong>${email}</strong>). Here's how to open it:</p>
      <p style="font-size:13px;color:#536471;line-height:1.6;margin:0 0 16px;"><strong>New to GoLogin?</strong> Get it free at <a href="https://gologin.com/download" style="color:#0A66C2;">gologin.com/download</a> and sign in with this email first.</p>
      <ol style="font-size:14px;color:#374151;line-height:1.8;margin:0 0 24px;padding-left:20px;">
        <li>Open the <strong>GoLogin</strong> app (signed in with ${email}).</li>
        <li>Look under <strong>"Shared with me"</strong> for the profile. <strong>Don't see it? Refresh GoLogin</strong> — it can take a minute or two to appear right after renting.</li>
        <li>Click <strong>Start</strong> to launch the browser with LinkedIn already logged in.</li>
      </ol>
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin-bottom:20px;">Open your dashboard</a>
      <p style="font-size:13px;color:#536471;line-height:1.6;margin:20px 0 0;">Reminder: please follow our <a href="${appUrl}/guide" style="color:#0A66C2;">safe-use guide</a> to keep the account healthy. Always access it through GoLogin, and don't change the account's login or profile details.</p>
    `),
  });
}

// Friendly "your rental renews soon — pay here" reminder with a Stripe payment link.
// Used for manual/one-off renewals (e.g. manikaran) and as the pay-now building block.
export async function sendRenewalLinkEmail(
  email: string,
  firstName: string,
  payUrl: string,
  dueDate: string,
  amount: string
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  return sendEmail({
    to: email,
    subject: `Time to renew your LinkedVelocity rental`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Your LinkedVelocity rental is up for renewal on <strong>${dueDate}</strong>. We'd love for you to keep it going — renew below and your access carries on with <strong>zero interruption</strong>:</p>
      <ul style="font-size:14px;color:#374151;line-height:1.9;margin:0 0 20px;padding-left:4px;list-style:none;">
        <li>✅ Your account stays exactly as it is — connections, history, everything</li>
        <li>✅ Your campaigns and outreach keep running, no re-setup</li>
        <li>✅ Locked in for another month at <strong>${amount}</strong></li>
      </ul>
      <a href="${payUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Renew now →</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">It takes about a minute, and once it's done you're set for the month. Need a hand? Just reach out on Telegram <a href="https://t.me/linkedvelocity_support_bot" style="color:#0A66C2;">@linkedvelocity_support_bot</a> — happy to help.</p>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:14px 0 0;">Thanks for being part of LinkedVelocity! 💙</p>
    `),
  });
}

// --- Manual-renewal cadence (auto-renew OFF): 3 days before → day of (grace) → +7d win-back.
// One CTA each, value/reassurance first, no fake urgency, personalised.

// Email 1 — 3 days before the rental ends.
export async function sendRenewalReminder3d(
  email: string, firstName: string, renewUrl: string, endDate: string, amount: string
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  return sendEmail({
    to: email,
    subject: `Your LinkedVelocity rental ends ${endDate} — renew to keep it going`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Quick heads-up — your LinkedVelocity rental ends on <strong>${endDate}</strong>. It's not set to auto-renew, so you'll need to renew to keep your access going.</p>
      <a href="${renewUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Renew now → (${amount}/month)</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">Thanks for being part of LinkedVelocity! 💙</p>
    `),
  });
}

// Email 2 — day of expiry. Access stays on for a 24h grace window.
export async function sendRenewalGraceNotice(
  email: string, firstName: string, renewUrl: string, graceDeadline: string, amount: string
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  return sendEmail({
    to: email,
    subject: `Your LinkedVelocity rental — 24 hours left to renew`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Your LinkedVelocity rental ended today — but your access stays active for the next <strong>24 hours</strong> (until <strong>${graceDeadline}</strong>), so there's still time.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 18px;">If it lapses, you'll lose access to your rented account through GoLogin, and any campaigns running on it will stop.</p>
      <a href="${renewUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Renew now → (${amount}/month)</a>
    `),
  });
}

// Email 3 — last chance before we release the held profile to other renters.
export async function sendRenewalWinBack(
  email: string, firstName: string, renewUrl: string, amount: string, accountName?: string, releaseDate?: string
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  const acct = accountName ? `<strong>${accountName}</strong>` : "your account";
  const deadline = releaseDate
    ? `We're about to <strong>release ${acct} to other renters on ${releaseDate}</strong>. This is your last chance to keep it.`
    : `Your rental lapsed — but everything's intact and waiting for you.`;
  return sendEmail({
    to: email,
    subject: releaseDate ? `Last chance to keep your LinkedVelocity account` : `Your LinkedVelocity rental is still here whenever you're ready`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">${deadline} Re-activate now and you pick up the same account exactly where you left off — no re-setup. After that it's first-come, first-served for everyone.</p>
      <a href="${renewUrl}" style="display:inline-block;background:#00B85C;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Reactivate &amp; keep it → (${amount}/month)</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">That's the last we'll nudge you — thanks for being part of LinkedVelocity.</p>
    `),
  });
}

export async function sendRenewalReminder(
  email: string,
  accountName: string,
  daysUntilExpiry: number,
  autoRenew: boolean
) {
  const urgency =
    daysUntilExpiry <= 1 ? "Final Warning" : daysUntilExpiry <= 3 ? "Reminder" : "Upcoming Renewal";

  return sendEmail({
    to: email,
    subject: `${urgency}: Your rental of "${accountName}" ${
      autoRenew ? "will auto-renew" : "expires"
    } in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? "s" : ""}`,
    html: `
      <h2>${urgency}</h2>
      <p>Your rental of <strong>${accountName}</strong> ${
      autoRenew
        ? `will automatically renew in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? "s" : ""}.`
        : `expires in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? "s" : ""}. Auto-renew is OFF.`
    }</p>
      ${
        !autoRenew
          ? `<p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">Enable auto-renew</a> to keep your access.</p>`
          : ""
      }
      <p>— LinkedIn Ambassadors Team</p>
    `,
  });
}

export async function sendRenewalConfirmation(email: string, accounts?: string | string[]) {
  const list = accounts ? (Array.isArray(accounts) ? accounts : [accounts]) : [];
  const what = list.length === 1
    ? `Your rental of <strong>${list[0]}</strong> has been renewed`
    : list.length > 1
      ? `Your rentals of <strong>${list.join(", ")}</strong> have been renewed`
      : `Your LinkedVelocity rental has been renewed`;
  return sendEmail({
    to: email,
    subject: list.length > 1 ? `Your LinkedVelocity rentals are renewed 🎉` : `Your LinkedVelocity rental is renewed 🎉`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>You're renewed! 🎉</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">${what} for another month — your access continues uninterrupted.</p>
    `),
  });
}

// --- Auto-renew ON emails ---

// Reassuring heads-up sent ~3 days before an auto-renewing rental renews. When the rental is
// billed to a saved card on file, pass amount (+ optional cardLast4) so the notice states the
// exact upcoming charge — a card is never charged without this advance warning going out first.
export async function sendRenewalHeadsUp(
  email: string, firstName: string, renewDate: string, amount?: string, cardLast4?: string | null
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const card = cardLast4 ? `your card ending <strong>${cardLast4}</strong>` : "your card on file";
  const chargeLine = amount
    ? `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">On <strong>${renewDate}</strong> we'll automatically charge ${card} <strong>${amount}</strong> to renew your rental for another month. Your account keeps running exactly as it is — no interruption, nothing you need to do.</p>`
    : `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Just a quick heads-up that your LinkedVelocity rental renews on <strong>${renewDate}</strong>. Your account will keep running exactly as it is — no interruption.</p>`;
  return sendEmail({
    to: email,
    subject: amount
      ? `Heads-up: ${card.replace(/<[^>]+>/g, "")} will be charged ${amount} on ${renewDate}`
      : `Your LinkedVelocity rental renews on ${renewDate} — nothing to do`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      ${chargeLine}
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 18px;">Nothing to do to keep it going. If you'd like to review your plan, update your card, or cancel before then, you can do that anytime below.</p>
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#F3F2EE;color:#0F1419;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">Manage billing</a>
    `),
  });
}

// Consolidated pre-charge reminder — one email per renter covering several card-on-file
// accounts renewing around the same time. Lists each account + amount and the combined total
// that will hit the card. Charges still happen per-account; only the notice is bundled.
export async function sendRenewalHeadsUpBatch(
  email: string,
  firstName: string,
  items: { account: string; amount: string; date: string }[],
  total: string,
  cardLast4?: string | null
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const card = cardLast4 ? `your card ending <strong>${cardLast4}</strong>` : "your card on file";
  const cardPlain = cardLast4 ? `your card ending ${cardLast4}` : "your card on file";
  const dates = Array.from(new Set(items.map((i) => i.date)));
  const whenLabel = dates.length === 1 ? `on <strong>${dates[0]}</strong>` : `over the next few days`;
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;">${i.account}</td>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:13px;color:#536471;">renews ${i.date}</td>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;text-align:right;font-weight:600;">${i.amount}</td>
      </tr>`
    )
    .join("");
  return sendEmail({
    to: email,
    subject:
      dates.length === 1
        ? `Heads-up: ${cardPlain} will be charged ${total} on ${dates[0]}`
        : `Heads-up: upcoming renewals on ${cardPlain} (${total})`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Quick heads-up — we'll automatically renew your LinkedVelocity rentals ${whenLabel}, charging ${card} a combined <strong>${total}</strong>. Everything keeps running exactly as it is — no interruption, nothing you need to do.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
        <tbody>${rows}
          <tr>
            <td style="padding:11px 12px;border-top:2px solid #e2e5e8;font-size:14px;color:#0F1419;font-weight:700;" colspan="2">Total</td>
            <td style="padding:11px 12px;border-top:2px solid #e2e5e8;font-size:14px;color:#0F1419;text-align:right;font-weight:700;">${total}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:16px 0 18px;">Each account is billed separately, so you'll see them as individual charges. If you'd like to review, update your card, or cancel any before then, you can do that anytime below.</p>
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#F3F2EE;color:#0F1419;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">Manage billing</a>
    `),
  });
}

// Sent the moment a renter's billing pauses, so they're never surprised. Two causes, two
// sections: accounts they've turned renewal OFF for (which return to LinkedVelocity after the
// period ends) and accounts that got restricted (temporary pause, not charged while down).
// Always shows the renter's full current picture, not just the one that triggered it.
export async function sendBillingPausedEmail(
  email: string,
  firstName: string,
  opts: {
    trigger: "renewal_off" | "restricted";
    highlightAccount: string;
    notRenewing: { name: string; endDate: string; returnDate: string }[];
    restricted: { name: string; restrictedDate: string }[];
  }
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";

  const subject = opts.trigger === "renewal_off"
    ? "Renewal turned off for your rented accounts"
    : "An account you rent was restricted";

  const intro = opts.trigger === "renewal_off"
    ? `You've turned off renewal for <strong>${opts.highlightAccount}</strong>. It stays active until the date shown below, then returns to LinkedVelocity's control, and you won't be charged for it again.`
    : `<strong>${opts.highlightAccount}</strong> was restricted by LinkedIn. We've paused its billing while we work to recover it, so you're not charged while it's down. If it's still restricted after 2 days, you can swap it for an equivalent account from your dashboard.`;

  const notRenewingTable = opts.notRenewing.length ? `
    <p style="font-size:13px;font-weight:700;color:#0F1419;margin:22px 0 6px;">Accounts not renewing (returning to LinkedVelocity)</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
      <tbody>${opts.notRenewing.map((i) => `<tr>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;">${i.name}</td>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:13px;color:#536471;">active until ${i.endDate}</td>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:13px;color:#536471;text-align:right;">returns ${i.returnDate}</td>
      </tr>`).join("")}</tbody>
    </table>` : "";

  const restrictedTable = opts.restricted.length ? `
    <p style="font-size:13px;font-weight:700;color:#0F1419;margin:22px 0 6px;">Accounts temporarily paused (being recovered)</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
      <tbody>${opts.restricted.map((i) => `<tr>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;">${i.name}</td>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:13px;color:#536471;">restricted ${i.restrictedDate}, not charged while down</td>
      </tr>`).join("")}</tbody>
    </table>` : "";

  return sendEmail({
    to: email,
    subject,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">${intro}</p>
      ${notRenewingTable}
      ${restrictedTable}
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:18px 0 18px;">You can turn renewal back on or manage any of these anytime from your dashboard.</p>
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#F3F2EE;color:#0F1419;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">Manage billing</a>
    `),
  });
}

// Internal watchdog alert — sent when the daily renewal cron looks like it stopped running
// (rentals stuck past their renewal date). Goes to milee@ per request.
export async function sendRenewalCronAlert(stuck: number, activeAutoRenew: number) {
  const one = stuck === 1;
  return sendEmail({
    to: "milee@linkedvelocity.com",
    subject: `[Alert] LinkedVelocity renewal cron may not be running (${stuck} stuck)`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">Heads-up — the automated renewal job may have stopped running.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;"><strong>${stuck}</strong> active auto-renew rental${one ? "" : "s"} ${one ? "is" : "are"} more than 4 days past ${one ? "its" : "their"} renewal date and still unprocessed (of ${activeAutoRenew} active auto-renew total). If the daily job were running, ${one ? "it" : "they"} would have been charged, moved into the grace window, or expired by now.</p>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:0;">Check the Vercel cron for the <strong>klabber</strong> project — <code>/api/cron/process-renewals</code>, scheduled 09:00 UTC — and its deployment logs. Live status: <a href="https://linkedvelocity.com/api/cron/health" style="color:#0A66C2;">/api/cron/health</a>.</p>
    `),
  });
}

// Daily Stripe -> ledger reconciliation summary. Only sent when there is a gap: a
// charge Stripe collected that our ledger doesn't account for.
export async function sendReconciliationSummary(
  to: string,
  data: {
    windowDays: number;
    gapTotal: number;
    gaps: { date: string; amount: number; customerEmail: string; descriptor: string; attributedTo?: string; reason: string }[];
  }
) {
  const rows = data.gaps
    .map(
      (c) => `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #EEF0F3;font-size:13px;color:#374151;">${c.date}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #EEF0F3;font-size:13px;color:#0B1220;font-weight:600;">$${c.amount.toFixed(2)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #EEF0F3;font-size:13px;color:#536471;">${c.attributedTo || c.customerEmail}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #EEF0F3;font-size:12.5px;color:#536471;">${c.reason}${c.descriptor ? ` · ${c.descriptor}` : ""}</td>
      </tr>`
    )
    .join("");
  const one = data.gaps.length === 1;
  return sendEmail({
    to,
    subject: `[Reconcile] ${data.gaps.length} Stripe charge${one ? "" : "s"} ($${data.gapTotal.toFixed(2)}) not in the ledger`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">The daily Stripe reconciliation found <strong>${data.gaps.length}</strong> charge${one ? "" : "s"} (<strong>$${data.gapTotal.toFixed(2)}</strong>) that Stripe collected in the last ${data.windowDays} days but our transactions ledger doesn't appear to account for. Please check and enter ${one ? "it" : "them"} if missing.</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 16px;">
        <thead><tr>
          <th style="padding:7px 10px;border-bottom:2px solid #E6E8EC;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A2;text-align:left;">Date</th>
          <th style="padding:7px 10px;border-bottom:2px solid #E6E8EC;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A2;text-align:left;">Amount</th>
          <th style="padding:7px 10px;border-bottom:2px solid #E6E8EC;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A2;text-align:left;">Who</th>
          <th style="padding:7px 10px;border-bottom:2px solid #E6E8EC;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A2;text-align:left;">Note</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:0;">Open <a href="https://linkedvelocity.com/admin/transactions" style="color:#0A66C2;">Admin → Transactions</a> and use “Check Stripe” for the full picture. This is usually a legacy Payment-Link sub billed to an email with no linked account — enter the payment by hand, or migrate that renter to the website so it is captured automatically.</p>
    `),
  });
}

// Payment hiccup on an auto-renewing rental — access stays ON, we keep retrying.
export async function sendPaymentFailedEmail(email: string, firstName: string, payUrl: string) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  return sendEmail({
    to: email,
    subject: `Quick payment hiccup on your LinkedVelocity rental`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">We had trouble processing your latest payment — but no worries, <strong>your access is still on</strong>. We'll keep retrying automatically over the next few days.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 18px;">To avoid any interruption, you can settle it now in one click:</p>
      <a href="${payUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Pay now →</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">Having trouble? Message us on Telegram <a href="https://t.me/linkedvelocity_support_bot" style="color:#0A66C2;">@linkedvelocity_support_bot</a> and we'll sort it out.</p>
    `),
  });
}

// Access paused after payment couldn't be collected — pay to restore right away.
export async function sendAccessRevokedEmail(
  email: string, firstName: string, payUrl: string, releaseDate?: string, accountName?: string
) {
  const hi = firstName ? `Hi ${firstName},` : "Hi there,";
  const acct = accountName ? `<strong>${accountName}</strong>` : "your rented account";
  // If we're holding the profile for a reclaim window, make that crystal clear.
  const reclaim = releaseDate
    ? `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Good news — we're <strong>holding ${acct} for you</strong>. Re-activate before <strong>${releaseDate}</strong> and you'll pick up the <strong>same account</strong> exactly where you left off, campaigns and all. After that date it'll be released and available for anyone to rent.</p>`
    : `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Your account and everything in it are safe — settle below and we'll restore your access right away.</p>`;
  return sendEmail({
    to: email,
    subject: `Your LinkedVelocity access has been paused`,
    bcc: billingBcc,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">We weren't able to collect payment for your rental, so access to ${acct} has been paused for now.</p>
      ${reclaim}
      <a href="${payUrl}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Re-activate &amp; keep this account →</a>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">Questions? We're here on Telegram <a href="https://t.me/linkedvelocity_support_bot" style="color:#0A66C2;">@linkedvelocity_support_bot</a>.</p>
    `),
  });
}

// Shadow renter (e.g. Apex Strategy) reclaim notice: a real customer has rented an
// account the shadow renter was using, so we're taking it back and their GoLogin access
// to it has been removed. Plain, no celebratory opener.
export async function sendShadowYieldEmail(email: string, accountName: string, due: Date, credit: number) {
  if (!process.env.RESEND_API_KEY) throw new Error("Email delivery is not configured");
  const acct = accountName.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const deadline = due.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  return sendEmail({
    to: email,
    subject: "Seven-day notice: account handover",
    bcc: billingBcc,
    html: brandWrap(`
      <p>A customer has rented <strong>${acct}</strong>. You have seven days, until <strong>${deadline}</strong>, to finish your work and exit this account.</p>
      <p>Your access stays available during this notice period. At the deadline we will remove your access and prepare the account for the new renter. Please stop any campaigns and close the profile before then.</p>
      <p>${credit > 0 ? `Your latest monthly payment of <strong>US$${credit.toFixed(2)}</strong> has been returned to your LinkedVelocity wallet as credit during this notice period. You can use it towards another account.` : "No paid monthly charge was recorded for this rental, so there is no payment to credit back."} This account will not renew.</p>
      <p>Your other rentals are unaffected.</p>
    `),
  });
}

// ── Payout notifications ──
// Fired when a payment is logged WITH a Wise receipt link (setup / monthly / referral).
// Warm, celebratory tone — matches how the team actually messages people. The caller
// flips the payment's "notified" flag only once the send succeeds, and every send is
// captured in email_log like the rest.

// Monthly ₱500 starts the FIRST FULL MONTH after the setup fee is paid, on a 15th
// cut-off: setup paid 1st–15th → next month; paid 16th–end → the month after.
// Computed in Manila time so the cut-off matches the team's wall clock.
export function firstMonthlyPayoutLabel(setupPaidAt: Date): string {
  const manila = new Date(setupPaidAt.getTime() + 8 * 3600 * 1000);
  const day = manila.getUTCDate();
  const start = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth() + (day <= 15 ? 1 : 2), 1));
  return start.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

const receiptBlock = (receiptUrl: string) => `
  <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 6px;">Here's your transfer link:</p>
  <p style="margin:0 0 16px;word-break:break-all;"><a href="${receiptUrl}" style="color:#0A66C2;font-weight:600;">${receiptUrl}</a></p>
  <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">You should see a notification from Wise shortly. 😊</p>`;

// Setup fee paid — mirrors the team's real setup-fee email (monthly-start date + referral ask + don't-log-in reminder).
export async function sendSetupFeePaidEmail(email: string, fullName: string, amount: number, receiptUrl: string, setupPaidAt: Date, currency: Currency = "PHP") {
  const firstName = (fullName || "").trim().split(" ")[0] || "there";
  const cfg = CURRENCY_CONFIG[currency];
  return sendEmail({
    to: email,
    subject: "Your setup fee is on its way! 🎉",
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Good news — we've just sent your <strong>${formatMoney(amount, currency)} setup fee</strong> via Wise. ✅</p>
      ${receiptBlock(receiptUrl)}
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Your <strong>${formatMoney(cfg.monthlyAmount, currency)} monthly payout</strong> will start from your first full month — that's <strong>${firstMonthlyPayoutLabel(setupPaidAt)}</strong>, and then the first of each month after, for as long as the account stays active.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Also — if you know anyone else who'd like to join, please send them our way! You'll earn <strong>up to ${formatMoney(cfg.referralTiers.computer.verified, currency)} referral fee</strong> for each one that comes on board — the exact amount depends on how they're onboarded. Ideally people who can get their account verified like yours (with a passport for the blue checkmark) — those accounts are much more stable and easier to work with. Just reply here if you'd like more info and we'll walk you through it! 🙌</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0;">Thanks so much for partnering with us! And a small reminder — please try not to log into the account yourself so it stays nice and stable on our end. Let us know if you have any questions! 🙏</p>
    `),
  });
}

// Monthly payout paid.
export async function sendMonthlyPayoutEmail(email: string, fullName: string, amount: number, receiptUrl: string, monthLabel: string, currency: Currency = "PHP") {
  const firstName = (fullName || "").trim().split(" ")[0] || "there";
  const cfg = CURRENCY_CONFIG[currency];
  return sendEmail({
    to: email,
    subject: `Your ${formatMoney(amount, currency)} monthly payout is on its way! 🎉`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Good news — we've just sent your <strong>${formatMoney(amount, currency)} payout for ${monthLabel}</strong> via Wise. ✅</p>
      ${receiptBlock(receiptUrl)}
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">And if you know anyone else who'd like to join, send them our way — you'll earn <strong>up to ${formatMoney(cfg.referralTiers.computer.verified, currency)} referral fee</strong> for each one that comes on board (the exact amount depends on how they're onboarded). Just reply here if you'd like more info and we'll walk you through it! 🙌</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0;">Thanks so much for partnering with us — and the same small reminder, please try not to log into the account yourself so it stays nice and stable on our end. Let us know if you have any questions! 🙏</p>
    `),
  });
}

// Referral fee paid to a marketer/ambassador. `forNames` = who they referred
// (the payout's description, comma-separated); falls back to a plain signup count.
export async function sendReferralPayoutEmail(email: string, fullName: string, amount: number, receiptUrl: string, forNames?: string | null, count?: number, currency: Currency = "PHP") {
  const firstName = (fullName || "").trim().split(" ")[0] || "there";
  const cfg = CURRENCY_CONFIG[currency];
  const names = (forNames || "").split(",").map((s) => s.trim()).filter(Boolean);
  const forWhat = names.length
    ? `, for referring ${names.join(", ")}`
    : count && count > 0
      ? `, for the ${count} signup${count === 1 ? "" : "s"} you brought on board`
      : "";
  return sendEmail({
    to: email,
    subject: "Your referral reward is on its way! 🎉",
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Good news — we've just sent your <strong>${formatMoney(amount, currency)} referral fee</strong> via Wise${forWhat}. ✅ 🙌</p>
      ${receiptBlock(receiptUrl)}
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0;">Keep them coming — you can earn up to ${formatMoney(cfg.referralTiers.computer.verified, currency)} for every new person who joins through you (the exact amount depends on how they're onboarded). Just message us if you'd like the details. Thank you so much. 🙏</p>
    `),
  });
}

// Shared account-table rows for the consolidated (batch) renewal emails.
type AcctItem = { account: string; date?: string; amount?: string };
function acctRows(items: AcctItem[]) {
  return items.map((i) => `<tr>
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;">${i.account}</td>${i.date ? `
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:13px;color:#536471;">${i.date}</td>` : ""}${i.amount ? `
        <td style="padding:9px 12px;border-top:1px solid #eef0f2;font-size:14px;color:#0F1419;text-align:right;font-weight:600;">${i.amount}</td>` : ""}
      </tr>`).join("");
}
const dashUrl = () => `${process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com"}/dashboard`;
const btn = (label: string, href: string, bg = "#0A66C2") =>
  `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">${label}</a>`;
const acctTable = (items: AcctItem[]) =>
  `<table style="width:100%;border-collapse:collapse;margin:0 0 8px;"><tbody>${acctRows(items)}</tbody></table>`;

// --- Consolidated (one email per renter) versions of the manual-cadence emails. Each lists the
// accounts involved so the renter (and the team) can see exactly which profiles are affected. ---

export async function sendRenewalReminder3dBatch(email: string, first: string, items: AcctItem[]) {
  const hi = first ? `Hi ${first},` : "Hi there,";
  const dates = Array.from(new Set(items.map((i) => i.date).filter(Boolean)));
  const when = dates.length === 1 ? `on <strong>${dates[0]}</strong>` : `over the next few days`;
  const n = items.length;
  return sendEmail({
    to: email,
    bcc: billingBcc,
    subject: dates.length === 1 ? `Your LinkedVelocity rentals end ${dates[0]} — renew to keep them going` : `${n} of your LinkedVelocity rentals are ending soon — renew to keep them`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Quick heads-up — <strong>${n}</strong> of your LinkedVelocity rentals end ${when}. They're not set to auto-renew, so you'll need to renew to keep your access going.</p>
      ${acctTable(items)}
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:16px 0 18px;">Renew any of them from your dashboard below.</p>
      ${btn("Renew now →", dashUrl())}
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">Thanks for being part of LinkedVelocity! 💙</p>
    `),
  });
}

export async function sendRenewalGraceNoticeBatch(email: string, first: string, items: AcctItem[], graceDeadline: string) {
  const hi = first ? `Hi ${first},` : "Hi there,";
  const n = items.length;
  return sendEmail({
    to: email,
    bcc: billingBcc,
    subject: `Your LinkedVelocity rentals — 24 hours left to renew`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;"><strong>${n}</strong> of your LinkedVelocity rentals ended today — but your access stays active for the next <strong>24 hours</strong> (until <strong>${graceDeadline}</strong>), so there's still time.</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">If they lapse, you'll lose access to these profiles through GoLogin, and any campaigns running on them will stop:</p>
      ${acctTable(items)}
      <div style="margin:16px 0 0;">${btn("Renew now →", dashUrl())}</div>
    `),
  });
}

export async function sendRenewalWinBackBatch(email: string, first: string, items: AcctItem[], releaseDate?: string) {
  const hi = first ? `Hi ${first},` : "Hi there,";
  const n = items.length;
  const lead = releaseDate
    ? `We're about to <strong>release ${n} of your accounts to other renters on ${releaseDate}</strong>. This is your last chance to keep them.`
    : `Your rentals lapsed — but everything's intact and waiting for you.`;
  return sendEmail({
    to: email,
    bcc: billingBcc,
    subject: releaseDate ? `Last chance to keep your LinkedVelocity accounts` : `Your LinkedVelocity rentals are still here whenever you're ready`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">${lead} Re-activate now and you pick up the same accounts exactly where you left off — no re-setup.</p>
      ${acctTable(items)}
      <div style="margin:16px 0 0;">${btn("Reactivate &amp; keep them →", dashUrl(), "#00B85C")}</div>
      <p style="font-size:14px;color:#536471;line-height:1.6;margin:20px 0 0;">That's the last we'll nudge you — thanks for being part of LinkedVelocity.</p>
    `),
  });
}

export async function sendAccessRevokedBatch(email: string, first: string, items: AcctItem[], releaseDate?: string) {
  const hi = first ? `Hi ${first},` : "Hi there,";
  const n = items.length;
  const reclaim = releaseDate
    ? `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Good news — we're <strong>holding these for you</strong>. Re-activate before <strong>${releaseDate}</strong> and you'll pick up the <strong>same accounts</strong> exactly where you left off, campaigns and all. After that date they'll be released and available for anyone to rent.</p>`
    : `<p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">Your accounts and everything in them are safe — settle below and we'll restore your access right away.</p>`;
  return sendEmail({
    to: email,
    bcc: billingBcc,
    subject: `Your LinkedVelocity access has been paused`,
    html: brandWrap(`
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 14px;">${hi}</p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">We weren't able to collect payment, so access to <strong>${n}</strong> of your rented accounts has been paused for now:</p>
      ${acctTable(items)}
      ${reclaim}
      ${btn("Re-activate &amp; keep these accounts →", dashUrl())}
    `),
  });
}

export async function sendAmbassadorWelcomeEmail(
  email: string,
  fullName: string,
  tempPassword: string,
  monthlyAmount: number
) {
  return sendEmail({
    to: email,
    subject: "Welcome to LinkedIn Ambassadors — Your account is ready",
    html: `
      <h2>Welcome, ${fullName}!</h2>
      <p>You're now a LinkedIn Ambassador. Your account has been set up and is ready to go.</p>

      <h3>Your Login Details</h3>
      <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
        <p style="margin:4px 0;"><strong>Email:</strong> ${email}</p>
        <p style="margin:4px 0;"><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
        <p style="margin:8px 0 0;font-size:13px;color:#666;">You can change your password after logging in.</p>
      </div>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/login" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Log In to Your Dashboard</a></p>

      <h3>What Happens Next</h3>
      <ul>
        <li><strong>Monthly payments of $${monthlyAmount}</strong> will be sent to your bank account on the 1st of each month while your account is active.</li>
        <li><strong>Keep your LinkedIn session active.</strong> If your account gets logged out, we'll contact you to re-authenticate. Payments are paused until access is restored.</li>
        <li><strong>Cancel anytime</strong> with 30 days notice.</li>
      </ul>

      <p>Questions? Reply to this email or contact us at support@linkedvelocity.com</p>
      <p>— The LinkedIn Ambassadors Team</p>
    `,
  });
}

export async function sendAmbassadorApplicationLead(application: {
  fullName: string;
  email: string;
  linkedinEmail?: string | null;
  contactNumber?: string | null;
  linkedinUrl: string;
  connectionCount?: number | null;
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
  status?: string;
  offeredAmount?: number | string | null;
}) {
  const row = (label: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === ""
      ? ""
      : `<tr><td style="padding:6px 12px;color:#536471;font-size:13px;white-space:nowrap;">${label}</td><td style="padding:6px 12px;color:#0F1419;font-size:13px;">${value}</td></tr>`;

  return sendEmail({
    to: "info@linkedvelocity.com",
    subject: `New ambassador application: ${application.fullName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Ambassador Application</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">Someone just submitted the "Get Your Profile Valuation" form.</p>
        <table style="width:100%;border-collapse:collapse;background:#F8F8F5;border-radius:12px;overflow:hidden;">
          ${row("Name", application.fullName)}
          ${row("Email", application.email)}
          ${row("LinkedIn Email", application.linkedinEmail)}
          ${row("Contact", application.contactNumber)}
          ${row("LinkedIn URL", `<a href="${application.linkedinUrl}" style="color:#0A66C2;">${application.linkedinUrl}</a>`)}
          ${row("Connections", application.connectionCount)}
          ${row("Industry", application.industry)}
          ${row("Location", application.location)}
          ${row("Status", application.status)}
          ${row("Offered Amount", application.offeredAmount ? `$${application.offeredAmount}/mo` : null)}
          ${row("Notes", application.notes)}
        </table>
      </div>
    `,
  });
}

export async function sendFieldMarketingLead(app: {
  fullName: string;
  email: string;
  contactNumber: string;
  comfortApproaching?: string | null;
  handlesRejection?: string | null;
  experience?: string | null;
  trialAvailability?: string | null;
  source?: string | null;
}) {
  const row = (label: string, value: string | null | undefined) =>
    value === null || value === undefined || value === ""
      ? ""
      : `<tr><td style="padding:6px 12px;color:#536471;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 12px;color:#0F1419;font-size:13px;">${value}</td></tr>`;

  return sendEmail({
    to: "info@linkedvelocity.com",
    subject: `New promo team applicant: ${app.fullName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Promo Team Applicant</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">Someone just applied for the Metro Manila promo team role.</p>
        <table style="width:100%;border-collapse:collapse;background:#F8F8F5;border-radius:12px;overflow:hidden;">
          ${row("Name", app.fullName)}
          ${row("Email", app.email)}
          ${row("Contact", app.contactNumber)}
          ${row("Comfort approaching strangers", app.comfortApproaching ? `${app.comfortApproaching} / 5` : null)}
          ${row("Handles rejection", app.handlesRejection ? `${app.handlesRejection} / 5` : null)}
          ${row("Prior people-facing work", app.experience)}
          ${row("Trial availability (end July, Market! Market!)", app.trialAvailability)}
          ${row("Source", app.source || "Organic")}
        </table>
      </div>
    `,
  });
}

export async function sendTelegramMessageNotification(opts: {
  fromName: string;
  username?: string | null;
  chatId: number | string;
  text: string;
  recent?: { ts: string; body: string }[]; // newest first, incl. the current message
}) {
  const userHandle = opts.username ? `@${opts.username}` : "(no username)";
  const replyLink = opts.username
    ? `https://t.me/${opts.username}`
    : `tg://user?id=${opts.chatId}`;
  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escaped = esc(opts.text);
  // Show up to two prior messages beneath the latest so the team has context.
  const prior = (opts.recent || []).slice(1, 3);
  const historyHtml = prior.length
    ? `
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;margin-bottom:16px;">
          <p style="margin:0 0 6px;color:#536471;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Earlier messages</p>
          ${prior
            .map(
              (m) =>
                `<p style="margin:0 0 10px;color:#536471;font-size:14px;line-height:1.5;white-space:pre-wrap;border-left:2px solid #E1E1DC;padding-left:10px;">${esc(m.body)}</p>`,
            )
            .join("")}
        </div>`
    : "";
  return sendEmail({
    to: ["info@linkedvelocity.com", "sam@ortusclub.com", "ardi@linkedvelocity.com"],
    // Include a snippet of the actual message so each email stands alone in the
    // inbox instead of Gmail collapsing every message from one person into a
    // single same-subject thread (which buries follow-ups under the /start).
    subject: `New Telegram message from ${opts.fromName}${
      opts.text.trim().toLowerCase().startsWith("/start")
        ? ""
        : `: ${opts.text.slice(0, 60)}`
    }`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Telegram Message</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">${opts.fromName} ${userHandle} just messaged the LinkedVelocity support bot.</p>
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;margin-bottom:16px;">
          <p style="margin:0 0 6px;color:#536471;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Latest message</p>
          <p style="margin:0;color:#0F1419;font-size:15px;line-height:1.5;white-space:pre-wrap;">${escaped}</p>
        </div>
        ${historyHtml}
        <p style="margin:0;color:#536471;font-size:13px;">
          <a href="${replyLink}" style="color:#0A66C2;text-decoration:none;">Reply on Telegram →</a>
        </p>
      </div>
    `,
  });
}

export async function sendSignupNotification(user: {
  fullName: string;
  email: string;
  contactNumber?: string | null;
}) {
  return sendEmail({
    to: "info@linkedvelocity.com",
    subject: `New LinkedVelocity signup: ${user.fullName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Signup</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">A new user just created a LinkedVelocity account.</p>
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Name:</strong> ${user.fullName}</p>
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Email:</strong> <a href="mailto:${user.email}" style="color:#0A66C2;text-decoration:none;">${user.email}</a></p>
          ${user.contactNumber ? `<p style="margin:0;color:#0F1419;font-size:14px;"><strong>Contact:</strong> ${user.contactNumber}</p>` : ""}
        </div>
      </div>
    `,
  });
}

export async function sendTestAccountLead(name: string, email: string) {
  return sendEmail({
    to: "info@linkedvelocity.com",
    subject: `New test-account lead: ${name}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Test Account Lead</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">Someone just opened the test LinkedIn account from linkedvelocity.com.</p>
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Name:</strong> ${name}</p>
          <p style="margin:0;color:#0F1419;font-size:14px;"><strong>Email:</strong> <a href="mailto:${email}" style="color:#0A66C2;text-decoration:none;">${email}</a></p>
        </div>
      </div>
    `,
  });
}

// Customer-facing receipt sent the moment a top-up lands (card via Stripe webhook,
// or crypto via the deposit-detection cron). Method-aware so a card payment isn't
// mislabelled as "USDC".
export async function sendTopUpConfirmation(opts: {
  email: string;
  amount: number | string;
  method: "card" | "crypto";
  newBalance?: number | string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const amountStr = Number(opts.amount).toFixed(2);
  const paidLine = opts.method === "card"
    ? "Your card payment went through and the funds are now on your balance."
    : "Your USDC deposit was received and added to your balance.";
  const balanceLine = opts.newBalance != null
    ? `<p style="font-size:14px;color:#536471;line-height:1.6;margin:0 0 18px;">New balance: <strong style="color:#0F1419;">$${Number(opts.newBalance).toFixed(2)}</strong></p>`
    : "";
  return sendEmail({
    to: opts.email,
    subject: `Top-up confirmed — $${amountStr} added to your LinkedVelocity balance`,
    html: brandWrap(`
      <p style="font-size:16px;margin:0 0 8px;"><strong>You're topped up ✅</strong></p>
      <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">${paidLine}</p>
      <div style="background:#F8F8F5;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
        <p style="margin:0;color:#0F1419;font-size:15px;"><strong>Amount added:</strong> $${amountStr}</p>
        <p style="margin:8px 0 0;color:#536471;font-size:13px;">Paid by ${opts.method === "card" ? "card" : "USDC (Base network)"}</p>
      </div>
      ${balanceLine}
      <a href="${appUrl}/catalogue" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">Browse accounts</a>
    `),
  });
}

export async function sendTopUpNotification(opts: {
  customerEmail: string;
  customerName?: string | null;
  amount: number | string;
  method: "card" | "crypto";
}) {
  const amountStr = Number(opts.amount).toFixed(2);
  const methodLabel = opts.method === "card" ? "Card (Stripe)" : "Crypto (USDC on Base)";
  const amountUnit = opts.method === "card" ? `$${amountStr}` : `$${amountStr} USDC`;
  return sendEmail({
    to: adminEmail,
    subject: `💰 New top-up: $${amountStr} (${opts.method})`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Balance Top-Up</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">A customer just added funds to their LinkedVelocity balance.</p>
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Amount:</strong> ${amountUnit}</p>
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Method:</strong> ${methodLabel}</p>
          ${opts.customerName ? `<p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Customer:</strong> ${opts.customerName}</p>` : ""}
          <p style="margin:0;color:#0F1419;font-size:14px;"><strong>Email:</strong> <a href="mailto:${opts.customerEmail}" style="color:#0A66C2;text-decoration:none;">${opts.customerEmail}</a></p>
        </div>
      </div>
    `,
  });
}

export async function sendRentalNotification(opts: {
  customerEmail: string;
  customerName?: string | null;
  accountName: string;
}) {
  return sendEmail({
    to: adminEmail,
    subject: `🎉 New rental: ${opts.accountName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#0F1419;margin-bottom:8px;">New Account Rental</h2>
        <p style="color:#536471;font-size:14px;margin-bottom:20px;">A customer just rented a LinkedIn account.</p>
        <div style="background:#F8F8F5;border-radius:12px;padding:18px 20px;">
          <p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Account:</strong> ${opts.accountName}</p>
          ${opts.customerName ? `<p style="margin:0 0 8px;color:#0F1419;font-size:14px;"><strong>Customer:</strong> ${opts.customerName}</p>` : ""}
          <p style="margin:0;color:#0F1419;font-size:14px;"><strong>Email:</strong> <a href="mailto:${opts.customerEmail}" style="color:#0A66C2;text-decoration:none;">${opts.customerEmail}</a></p>
        </div>
      </div>
    `,
  });
}

export async function sendAccountAvailableEmail(email: string, accountName: string) {
  return sendEmail({
    to: email,
    subject: `"${accountName}" is now available!`,
    html: `
      <h2>Account Available</h2>
      <p>The LinkedIn account <strong>${accountName}</strong> you were interested in is now available for rent.</p>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/catalogue">Rent it now</a> before someone else does!</p>
      <p>— LinkedIn Ambassadors Team</p>
    `,
  });
}

// Post-signup nudge: offer a faster "send us your details" setup instead of waiting
// for the onboarding call. If they have a call booked, we reference the date and
// frame it as "skip the wait"; otherwise we simply offer the fast track or a call.
// Replies go to a monitored inbox so they can just hit reply.
const FAST_TRACK_REPLY_TO = process.env.FAST_TRACK_REPLY_TO || "info@linkedvelocity.com";
export async function sendFastTrackInvite(email: string | string[], firstName: string, callDateLabel: string | null) {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const opener = callDateLabel
    ? `Thanks again for signing up with LinkedVelocity! We've got your onboarding call booked for <strong>${callDateLabel}</strong> — but if you'd like, there's a faster way to get you set up and earning sooner.`
    : `Thanks again for signing up with LinkedVelocity! There's a quick way to get you set up and earning sooner.`;
  const option2 = callDateLabel
    ? `<strong>Option 2 — Keep your call:</strong> Totally fine to stick with your scheduled call on <strong>${callDateLabel}</strong> — it just means setup takes a little longer to get going.`
    : `<strong>Option 2 — Prefer a call?</strong> If you'd rather hop on a quick call first — or you've already got one booked with us — that's totally fine. It just means setup takes a little longer to get going.`;
  const p = "margin:0 0 14px;color:#0F1419;font-size:14.5px;line-height:1.6;";
  return sendEmail({
    to: email,
    replyTo: FAST_TRACK_REPLY_TO,
    subject: "A faster way to get set up with LinkedVelocity",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:30px 22px;">
        <p style="${p}">${hi}</p>
        <p style="${p}">${opener}</p>
        <p style="${p}"><strong>Option 1 — Skip the wait:</strong> Reply to this email with the word <strong>NOW</strong> (or just text us) and we'll get you set up much faster. To do it, we'll need:</p>
        <ul style="margin:0 0 14px;padding-left:20px;color:#0F1419;font-size:14.5px;line-height:1.6;">
          <li>Your LinkedIn <strong>login email</strong></li>
          <li>Your LinkedIn <strong>password</strong></li>
          <li>Sometimes a <strong>2-step (2FA) code</strong> — we'll walk you through it</li>
        </ul>
        <p style="${p}">The only thing we ask is that you're online and reachable for a short window while we do it, since LinkedIn sends a few verification codes we'll need you to pass along.</p>
        <p style="${p}">${option2}</p>
        <p style="margin:0 0 14px;padding:14px 16px;background:#F0F7F2;border:1px solid #CFE8D8;border-radius:10px;color:#0F1419;font-size:14.5px;line-height:1.6;">👉 Ready to skip the wait? Just reply with <strong>NOW</strong> and we'll take it from there.</p>
        <p style="margin:22px 0 0;color:#536471;font-size:13px;">— The LinkedVelocity Team</p>
      </div>
    `,
  });
}

// Internal "who's due to be paid" digest — ambassador setup fees + monthly payouts
// that have come due, plus marketer commissions cleared for payout. Sent to Milee.
// Dormant-signup re-engagement — ONE-WAY (no-reply). Sent from noreply@ so replies don't pile up in
// an unmonitored inbox; replyTo points at info@ so anyone who does reply still reaches the team.
const REENGAGE_FROM = "LinkedVelocity <noreply@linkedvelocity.com>";
const REENGAGE_REPLY_TO = "info@linkedvelocity.com";
const CATALOGUE_URL = "https://linkedvelocity.com/rent-linkedin-accounts";

export async function sendReengageNudge(email: string, firstName: string) {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const p = "margin:0 0 14px;color:#0F1419;font-size:14.5px;line-height:1.6;";
  return sendEmail({
    to: email,
    from: REENGAGE_FROM,
    replyTo: REENGAGE_REPLY_TO,
    subject: firstName ? `Want a hand getting started, ${firstName}?` : "Want a hand getting started?",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:30px 22px;">
        <p style="${p}">${hi}</p>
        <p style="${p}">You created a LinkedVelocity account a little while back but haven't rented a profile yet — just a nudge in case it slipped off your radar.</p>
        <p style="${p}">What's waiting for you:</p>
        <ul style="margin:0 0 14px;padding-left:20px;color:#0F1419;font-size:14.5px;line-height:1.6;">
          <li>A catalogue of <strong>aged, verified LinkedIn accounts</strong> — some with Sales Navigator included</li>
          <li>Rent one in a couple of minutes; secure access via GoLogin, and you keep full control of the profile</li>
          <li>Plans <strong>from $45/month</strong>, no long lock-in</li>
        </ul>
        <p style="margin:0 0 18px;"><a href="${CATALOGUE_URL}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:11px 20px;border-radius:8px;">Browse available accounts →</a></p>
        <p style="${p}">Questions? Email <strong>info@linkedvelocity.com</strong> or message us on Telegram <strong>@linkedvelocity_support_bot</strong> — happy to help you pick the right one.</p>
        <p style="margin:22px 0 0;color:#536471;font-size:13px;">— The LinkedVelocity Team</p>
      </div>
    `,
  });
}

export async function sendReengageFollowup(email: string, firstName: string) {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const p = "margin:0 0 14px;color:#0F1419;font-size:14.5px;line-height:1.6;";
  return sendEmail({
    to: email,
    from: REENGAGE_FROM,
    replyTo: REENGAGE_REPLY_TO,
    subject: firstName ? `Still here whenever you're ready, ${firstName}` : "Still here whenever you're ready",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:30px 22px;">
        <p style="${p}">${hi}</p>
        <p style="${p}">Following up on my last note — no pressure at all.</p>
        <p style="${p}">Most people who sign up but don't rent straight away just aren't sure which account fits, or want to know it's safe first. Totally fair. The short version: you keep full control, we handle secure access through GoLogin, accounts are aged and verified <strong>from $45/month</strong>, and there's no long lock-in.</p>
        <p style="margin:0 0 18px;"><a href="${CATALOGUE_URL}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:11px 20px;border-radius:8px;">Browse available accounts →</a></p>
        <p style="${p}">Questions? <strong>info@linkedvelocity.com</strong> or Telegram <strong>@linkedvelocity_support_bot</strong>.</p>
        <p style="margin:22px 0 0;color:#536471;font-size:13px;">— The LinkedVelocity Team</p>
      </div>
    `,
  });
}

export async function sendPaymentsDueDigest(
  to: string | string[],
  data: {
    setup: { name: string; email: string; amount: number; currency: Currency; dueDate: string; overdue: boolean; method: string | null; details: string | null; blocked?: string | null }[];
    monthly: { name: string; email: string; amount: number; currency: Currency; dueDate: string; overdue: boolean; method: string | null; details: string | null; blocked?: string | null }[];
    marketers: { name: string; count: number; amount: number; currency: Currency }[];
    upcoming: { kind: string; name: string; amount: number; currency: Currency; dueDate: string }[];
    totalDueNow: number;
    totalsByCurrency: Record<Currency, number>;
  }
) {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const pay = (m: string | null, d: string | null) => (m || d) ? `${m || ""}${m && d ? " · " : ""}${d || ""}` : "—";
  // ₱ and $ can't be summed — render each currency present, joined by " · ".
  const sumByCur = (rows: { amount: number; currency: Currency }[]) => {
    const t: Record<Currency, number> = { PHP: 0, USD: 0 };
    for (const r of rows) t[r.currency] += r.amount;
    return (["PHP", "USD"] as Currency[]).filter((c) => t[c] > 0).map((c) => formatMoney(t[c], c)).join(" · ") || formatMoney(0, "PHP");
  };
  const totalLabel = (["PHP", "USD"] as Currency[]).filter((c) => data.totalsByCurrency[c] > 0).map((c) => formatMoney(data.totalsByCurrency[c], c)).join(" · ") || formatMoney(0, "PHP");

  const dueRows = (items: typeof data.setup, label: string) =>
    items.length === 0 ? "" : `
      <p style="margin:22px 0 8px;font:600 13px sans-serif;color:#0F1419;">${label} — ${items.length}, ${sumByCur(items)}</p>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
        <tr style="color:#8899A6;text-align:left;"><th style="padding:6px 8px;font-weight:600;">Who</th><th style="padding:6px 8px;font-weight:600;">Pay to</th><th style="padding:6px 8px;font-weight:600;">Due</th><th style="padding:6px 8px;font-weight:600;text-align:right;">Amount</th></tr>
        ${items.map((i) => `<tr style="border-top:1px solid #EEF0F2;">
          <td style="padding:8px;color:#0F1419;">${i.name}<br><span style="color:#8899A6;font-size:11px;">${i.email}</span></td>
          <td style="padding:8px;color:#536471;">${pay(i.method, i.details)}</td>
          <td style="padding:8px;color:${i.overdue ? "#C0392B" : "#536471"};">${day(i.dueDate)}${i.overdue ? " · overdue" : ""}${i.blocked ? ` · <span style="color:#C0392B;font-weight:600;">⚠ can't log in (${i.blocked})</span>` : ""}</td>
          <td style="padding:8px;text-align:right;color:${i.blocked ? "#8899A6" : "#0F1419"};font-weight:600;${i.blocked ? "text-decoration:line-through;" : ""}">${formatMoney(i.amount, i.currency)}</td>
        </tr>`).join("")}
      </table>`;

  const marketerRows = data.marketers.length === 0 ? "" : `
      <p style="margin:22px 0 8px;font:600 13px sans-serif;color:#0F1419;">Marketer commissions ready — ${sumByCur(data.marketers)}</p>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
        <tr style="color:#8899A6;text-align:left;"><th style="padding:6px 8px;font-weight:600;">Marketer</th><th style="padding:6px 8px;font-weight:600;">Onboarded</th><th style="padding:6px 8px;font-weight:600;text-align:right;">Amount</th></tr>
        ${data.marketers.map((m) => `<tr style="border-top:1px solid #EEF0F2;">
          <td style="padding:8px;color:#0F1419;">${m.name}</td>
          <td style="padding:8px;color:#536471;">${m.count}</td>
          <td style="padding:8px;text-align:right;color:#0F1419;font-weight:600;">${formatMoney(m.amount, m.currency)}</td>
        </tr>`).join("")}
      </table>`;

  const upcomingBlock = data.upcoming.length === 0 ? "" : `
      <p style="margin:22px 0 6px;font:600 12px sans-serif;color:#8899A6;">Coming up (next 7 days)</p>
      <ul style="margin:0;padding-left:18px;font-family:sans-serif;font-size:12.5px;color:#536471;">
        ${data.upcoming.map((u) => `<li style="margin:0 0 3px;">${u.name} — ${u.kind === "setup" ? "setup fee" : "monthly"} ${formatMoney(u.amount, u.currency)}, due ${day(u.dueDate)}</li>`).join("")}
      </ul>`;

  const nothing = data.setup.length === 0 && data.monthly.length === 0 && data.marketers.length === 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";

  return sendEmail({
    to,
    subject: nothing
      ? "Payments due — nothing due today"
      : `Payments due — ${totalLabel} across ${data.setup.length + data.monthly.length + data.marketers.length} payout${data.setup.length + data.monthly.length + data.marketers.length !== 1 ? "s" : ""}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:28px 20px;">
        <h2 style="color:#0F1419;margin:0 0 4px;">Payments due</h2>
        <p style="color:#536471;font-size:14px;margin:0 0 4px;">${nothing ? "No ambassador or marketer payouts are due right now." : `<strong style="color:#0F1419;">${totalLabel}</strong> due now.`}</p>
        ${dueRows(data.setup, "Setup fees due")}
        ${dueRows(data.monthly, "Monthly payouts due")}
        ${marketerRows}
        ${upcomingBlock}
        <p style="margin:26px 0 0;"><a href="${appUrl}/admin/pipeline" style="color:#0A66C2;text-decoration:none;font-size:13px;">Open the Pipeline →</a></p>
      </div>
    `,
  });
}

// Internal alert: off-platform TRON rentals whose payment is overdue, so the team
// can manually follow up (chase the renter, pause access, or end the rental). Sent
// once daily to the team inbox only when there's at least one overdue rental — see
// src/app/api/cron/overdue-rentals-alert/route.ts.
export async function sendOverdueRentalsAlert(
  to: string | string[],
  items: {
    renter: string;
    account: string;
    cadence: "daily" | "weekly";
    rate: string;      // e.g. "$6/day" or "$40/week"
    daysOverdue: number;
    nextDue: string;   // YYYY-MM-DD the (missed) payment was due
    address: string | null;
  }[]
) {
  const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://linkedvelocity.com";
  const rows = items
    .map(
      (i) => `<tr style="border-top:1px solid #EEF0F2;">
          <td style="padding:8px;color:#0F1419;">${i.renter}<br><span style="color:#8899A6;font-size:11px;">${i.account}</span></td>
          <td style="padding:8px;color:#536471;">${i.rate}</td>
          <td style="padding:8px;color:#C0392B;font-weight:600;">${i.daysOverdue}d overdue<br><span style="color:#8899A6;font-weight:400;font-size:11px;">due ${day(i.nextDue)}</span></td>
          <td style="padding:8px;color:#8899A6;font-size:11px;word-break:break-all;">${i.address || "—"}</td>
        </tr>`
    )
    .join("");

  return sendEmail({
    to,
    subject: `⚠️ ${items.length} rental payment${items.length !== 1 ? "s" : ""} overdue — follow up`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:28px 20px;">
        <h2 style="color:#0F1419;margin:0 0 4px;">Overdue rental payments</h2>
        <p style="color:#536471;font-size:14px;margin:0 0 16px;"><strong style="color:#C0392B;">${items.length}</strong> off-platform rental${items.length !== 1 ? "s haven't" : " hasn't"} paid by the due date. Follow up manually — chase the renter, pause access, or end the rental.</p>
        <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
          <tr style="color:#8899A6;text-align:left;"><th style="padding:6px 8px;font-weight:600;">Renter</th><th style="padding:6px 8px;font-weight:600;">Rate</th><th style="padding:6px 8px;font-weight:600;">Status</th><th style="padding:6px 8px;font-weight:600;">Pay-to address</th></tr>
          ${rows}
        </table>
        <p style="margin:26px 0 0;"><a href="${appUrl}/admin/rentals" style="color:#0A66C2;text-decoration:none;font-size:13px;">Open the Rentals page →</a></p>
      </div>
    `,
  });
}
