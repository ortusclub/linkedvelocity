import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import { requireAdmin } from "@/lib/auth";
import { FIELD_LABEL, requestDetail, type ProfileChangeFieldKey, type ExperiencePayload } from "@/lib/profile-changes";

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// "Your change is live" email, sent to the renter when a profile-change request is marked done.
function changeDoneEmail(to: string, accountName: string, label: string, detail: string) {
  const dash = "https://linkedvelocity.com/login?redirect=%2Fdashboard";
  const what = detail ? `${label.toLowerCase()} (${detail})` : label.toLowerCase();
  return {
    from: "LinkedVelocity <info@linkedvelocity.com>", to, replyTo: "info@linkedvelocity.com",
    subject: `Your ${label.toLowerCase()} change is live on ${accountName}`,
    text: `We've applied the ${what} update you requested on ${accountName}. It's live on the profile now.\n\nIf you have more changes, request them from your dashboard and we'll space them out so LinkedIn doesn't restrict the account: ${dash}\n\nPlease keep letting us make the edits rather than changing the profile yourself.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;line-height:1.6;color:#111827"><h2>Your change is live</h2><p>We've applied the <strong>${escape(label.toLowerCase())}</strong>${detail ? ` (${escape(detail)})` : ""} update you requested on <strong>${escape(accountName)}</strong>. It's live on the profile now.</p><p>Have more changes? Request them from your dashboard and we'll space them out so LinkedIn doesn't restrict the account.</p><p><a href="${dash}" style="display:inline-block;background:#1550e8;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Open your dashboard →</a></p><p style="color:#5b6779;font-size:13px">Please keep letting us make the edits rather than changing the profile yourself — that's what keeps the account safe.</p></div>`,
  };
}

// Admin action on one profile-change request:
//   done        -> applied (sends the renter a "your change is live" email)
//   needs_info  -> we need more from the renter (note required; surfaced on their dashboard)
//   reject      -> we won't apply it (note required)
//   reschedule  -> move the planned date (status unchanged)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action;
    const note: string = typeof body?.note === "string" ? body.note.trim() : "";

    const existing = await prisma.profileChangeRequest.findUnique({
      where: { id },
      include: {
        rental: { select: { user: { select: { email: true } } } },
        linkedinAccount: { select: { linkedinName: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    if (action === "done") {
      await prisma.profileChangeRequest.update({ where: { id }, data: { status: "done", appliedAt: new Date(), adminNote: null } });
      // Best-effort email — a delivery hiccup must not fail the action (it's already applied).
      const key = (process.env.MEETING_SMTP_API_KEY || process.env.RESEND_API_KEY)?.trim();
      if (key && existing.rental.user.email) {
        try {
          const field = existing.field as ProfileChangeFieldKey;
          const detail = requestDetail({ field, value: existing.value, fileUrl: existing.fileUrl, experience: (existing.experience as ExperiencePayload | null) ?? null });
          await new Resend(key).emails.send(
            changeDoneEmail(existing.rental.user.email, existing.linkedinAccount.linkedinName, FIELD_LABEL[field], detail),
            { idempotencyKey: `profile-change-done/${id}` },
          );
        } catch (e) {
          console.error("Profile-change done email failed:", e);
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "needs_info" || action === "reject") {
      if (!note) return NextResponse.json({ error: "Add a reason for the renter." }, { status: 400 });
      await prisma.profileChangeRequest.update({
        where: { id },
        data: { status: action === "reject" ? "rejected" : "needs_info", adminNote: note },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reschedule") {
      const when = new Date(body?.plannedFor);
      if (isNaN(when.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
      await prisma.profileChangeRequest.update({ where: { id }, data: { plannedFor: when } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Admin profile-change action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
