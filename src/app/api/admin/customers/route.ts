import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();

    const customers = await prisma.user.findMany({
      where: { role: "customer" },
      include: {
        rentals: {
          select: { id: true, status: true },
        },
        _count: {
          select: { rentals: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Auto-detect payment method from how they actually funded us:
    // a Stripe card top-up => "Card", a crypto deposit => "Crypto Wallet".
    const userIds = customers.map((c) => c.id);
    const deposits = userIds.length > 0
      ? await prisma.transaction.findMany({
          where: { userId: { in: userIds }, type: "deposit" },
          select: { userId: true, description: true },
        })
      : [];
    const fundingByUser = new Map<string, "Card" | "Crypto Wallet">();
    for (const d of deposits) {
      if ((d.description || "").startsWith("stripe_topup")) fundingByUser.set(d.userId, "Card");
      else if (!fundingByUser.has(d.userId)) fundingByUser.set(d.userId, "Crypto Wallet");
    }

    // Everyone signs up as role "customer" — renters AND ambassadors. The Renters tab
    // should only show renters, so exclude "pure ambassadors": anyone who submitted an
    // ambassador application and isn't actually renting. (A user who both shares and
    // rents still has rentals, so they stay listed here.)
    const emails = customers.map((c) => c.email);
    const ambEmails = new Set(
      (emails.length > 0
        ? await prisma.ambassadorApplication.findMany({
            where: { email: { in: emails } },
            select: { email: true },
          })
        : []
      ).map((a) => a.email)
    );

    const result = customers
      .filter((c) => c.rentals.length > 0 || !ambEmails.has(c.email))
      .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      contactNumber: c.contactNumber,
      status: c.status,
      createdAt: c.createdAt,
      activeRentals: c.rentals.filter((r) => r.status === "active").length,
      totalRentals: c._count.rentals,
      paymentMethod: fundingByUser.get(c.id) || "—",
      isTest: c.isTest,
      referralSource: c.referralSource,
      vettingStartedAt: c.vettingStartedAt,
      vettedAt: c.vettedAt,
      vettingInfo: c.vettingInfo,
      vettingReview: c.vettingReview,
      dailyRentalLimit: c.dailyRentalLimit,
      credentialAccess: c.credentialAccess,
      showProxy: c.showProxy,
    }));

    return NextResponse.json({ customers: result });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Permanently delete a customer + everything tied to them (sessions, transactions,
// rentals, waitlist, deposit address, ambassador applications, verification codes),
// freeing any accounts they were renting. Admins cannot be deleted here.
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, rentals: { select: { linkedinAccountId: true } } },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (user.role === "admin") {
      return NextResponse.json({ error: "Admins can't be deleted from here." }, { status: 400 });
    }

    const accountIds = [...new Set(user.rentals.map((r) => r.linkedinAccountId))];

    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId: id } });
      await tx.rental.deleteMany({ where: { userId: id } });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.waitlist.deleteMany({ where: { userId: id } });
      await tx.depositAddress.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.ambassadorApplication.deleteMany({ where: { email: user.email } }).catch(() => {});
      await tx.verificationCode.deleteMany({ where: { email: user.email } }).catch(() => {});
      await tx.user.delete({ where: { id } });

      // Free any account that no longer has an active/pending rental.
      for (const aid of accountIds) {
        const stillRented = await tx.rental.count({
          where: { linkedinAccountId: aid, status: { in: ["active", "pending_access"] } },
        });
        if (stillRented === 0) {
          await tx.linkedInAccount.updateMany({ where: { id: aid, status: "rented" }, data: { status: "available", twoFactorResetNeeded: true } });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "Forbidden" || msg === "Unauthorized") {
      return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
    }
    console.error("Delete customer error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();

    const { email, paymentMethod, paymentDetails, id, isTest, vettingReview, dailyRentalLimit, credentialAccess, showProxy } = await req.json();

    // Toggle a customer's test flag (by id) — keeps them out of / in live dashboard numbers.
    if (id && typeof isTest === "boolean") {
      await prisma.user.update({ where: { id }, data: { isTest } });
      return NextResponse.json({ ok: true });
    }

    // Admin's personal review verdict on a renter's vetting.
    if (id && typeof vettingReview === "string" && ["pending", "verified", "flagged"].includes(vettingReview)) {
      await prisma.user.update({ where: { id }, data: { vettingReview } });
      return NextResponse.json({ ok: true });
    }

    // Per-renter daily rental cap (anti-burn speed limit). Clamp to a sane 0–100.
    if (id && typeof dailyRentalLimit === "number" && Number.isFinite(dailyRentalLimit)) {
      const limit = Math.max(0, Math.min(100, Math.round(dailyRentalLimit)));
      await prisma.user.update({ where: { id }, data: { dailyRentalLimit: limit } });
      return NextResponse.json({ ok: true, dailyRentalLimit: limit });
    }

    // Tiered credential access: show login email + password + live 2FA code on this renter's
    // dashboard for every account they rent. Sensitive — log who turned it on/off for whom.
    if (id && typeof credentialAccess === "boolean") {
      await prisma.user.update({ where: { id }, data: { credentialAccess } });
      console.log(`[cred-access] ${admin.email} turned credential access ${credentialAccess ? "ON" : "OFF"} for user ${id}`);
      return NextResponse.json({ ok: true });
    }

    // Per-renter proxy reveal in the Sign-in panel (default on; only matters with credentialAccess).
    if (id && typeof showProxy === "boolean") {
      await prisma.user.update({ where: { id }, data: { showProxy } });
      console.log(`[show-proxy] ${admin.email} turned show-proxy ${showProxy ? "ON" : "OFF"} for user ${id}`);
      return NextResponse.json({ ok: true });
    }

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    // Note: role/admin promotion is intentionally NOT editable here — granting admin
    // is a rare, deliberate action done directly (not a casual button on a renter row).

    // Update payment method on ambassador application
    if (paymentMethod) {
      const application = await prisma.ambassadorApplication.findFirst({
        where: { email },
        orderBy: { createdAt: "desc" },
      });

      if (application) {
        await prisma.ambassadorApplication.update({
          where: { id: application.id },
          data: { paymentMethod },
        });
      } else {
        await prisma.ambassadorApplication.create({
          data: {
            fullName: email,
            email,
            linkedinUrl: "",
            status: "pending",
            paymentMethod,
          },
        });
      }
    }

    // Update payment details on user
    if (paymentDetails !== undefined) {
      await prisma.user.update({
        where: { email },
        data: { paymentDetails: paymentDetails || null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
