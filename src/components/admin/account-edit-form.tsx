"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageUpload } from "@/components/ui/image-upload";
import { ProxyTestButton } from "@/components/admin/proxy-test-button";
import { formatDate } from "@/lib/utils";

/**
 * The full account editor, extracted from /admin/accounts/[id] so it can be
 * rendered both as that standalone page and inline inside the Inventory v2
 * detail panel (no navigation). Single source of truth — same fields, same
 * PATCH to /api/admin/accounts/[id].
 *
 * - `embedded` drops the page chrome (max width + big heading) so it sits
 *   cleanly inside the detail panel.
 * - `onSaved` fires after a successful save (the inventory list uses it to
 *   refresh the read-only view underneath).
 * - `onClose` handles Cancel (inline: collapse back to read-only; page: back()).
 * - `onDeleted` fires after a delete (inline: collapse + refresh; page: route
 *   back to the inventory list).
 */
export default function AccountEditForm({
  accountId,
  embedded = false,
  onSaved,
  onClose,
  onDeleted,
}: {
  accountId: string;
  embedded?: boolean;
  onSaved?: () => void;
  onClose?: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [rentals, setRentals] = useState<Array<{
    id: string;
    status: string;
    startDate: string;
    currentPeriodEnd: string | null;
    user: { fullName: string; email: string };
  }>>([]);

  useEffect(() => {
    fetch(`/api/admin/accounts/${accountId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.account) {
          const { rentals: r, ...rest } = data.account;
          setForm(rest);
          setRentals(r || []);
        }
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);

    try {
      // Build payload, converting empty strings to null for optional fields
      const payload: Record<string, unknown> = {};
      if (form.linkedinName) payload.linkedinName = form.linkedinName;
      if (form.linkedinHeadline || form.linkedinHeadline === "") payload.linkedinHeadline = form.linkedinHeadline || null;
      if (form.linkedinUrl || form.linkedinUrl === "") payload.linkedinUrl = form.linkedinUrl || null;
      if (form.connectionCount !== undefined) payload.connectionCount = Number(form.connectionCount) || 0;
      if (form.industry !== undefined) payload.industry = form.industry || null;
      if (form.location !== undefined) payload.location = form.location || null;
      if (form.profileScreenshotUrl !== undefined) payload.profileScreenshotUrl = form.profileScreenshotUrl || null;
      if (form.profilePhotoUrl !== undefined) payload.profilePhotoUrl = form.profilePhotoUrl || null;
      if (form.proxyHost !== undefined) payload.proxyHost = form.proxyHost || null;
      if (form.proxyPort !== undefined && form.proxyPort !== "" && form.proxyPort !== null) payload.proxyPort = Number(form.proxyPort);
      if (form.proxyUsername !== undefined) payload.proxyUsername = form.proxyUsername || null;
      if (form.proxyPassword !== undefined) payload.proxyPassword = form.proxyPassword || null;
      if (form.proxyLocation !== undefined) payload.proxyLocation = form.proxyLocation || null;
      if (form.accountAgeMonths !== undefined && form.accountAgeMonths !== "" && form.accountAgeMonths !== null) payload.accountAgeMonths = Number(form.accountAgeMonths);
      if (form.hasSalesNav !== undefined) payload.hasSalesNav = !!form.hasSalesNav;
      if (form.linkedinVerified !== undefined) payload.linkedinVerified = !!form.linkedinVerified;
      if (form.listed !== undefined) payload.listed = !!form.listed;
      if (form.notes !== undefined) payload.notes = form.notes || null;
      if (form.monthlyPrice !== undefined && form.monthlyPrice !== "") payload.monthlyPrice = Number(form.monthlyPrice) || 0;
      if (form.ambassadorPayment !== undefined && form.ambassadorPayment !== "") payload.ambassadorPayment = Number(form.ambassadorPayment) || 0;
      if (form.status) payload.status = form.status;
      if (form.gologinProfileId !== undefined) payload.gologinProfileId = form.gologinProfileId || null;
      if (form.gologinShareLink !== undefined) payload.gologinShareLink = form.gologinShareLink || null;
      if (form.loginEmail !== undefined) payload.loginEmail = form.loginEmail || null;
      if (form.personalEmail !== undefined) payload.personalEmail = form.personalEmail || null;
      if (form.accountPassword !== undefined) payload.accountPassword = form.accountPassword || null;
      if (form.twoFactor !== undefined) payload.twoFactor = form.twoFactor || null;
      if (form.twoFactorResetNeeded !== undefined) payload.twoFactorResetNeeded = !!form.twoFactorResetNeeded;
      if (form.workEmail !== undefined) payload.workEmail = form.workEmail || null;

      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(typeof data.error === "string" ? data.error : "Failed to update");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  if (loading) return <div className="h-96 animate-pulse rounded-xl bg-gray-200" />;

  return (
    <div className={embedded ? "max-w-3xl" : "max-w-2xl"}>
      {!embedded && (
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Edit: {(form.linkedinName as string) || "Account"}
        </h2>
      )}

      {saved && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 font-medium">Changes saved successfully.</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Profile Details</h3></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={((s) => (s === "available" ? "available" : s === "rented" ? "rented" : s === "under_construction" ? "under_construction" : s === "construction_immature" ? "construction_immature" : s === "retired" || s === "removed" ? "retired" : "maintenance"))((form.status as string) || "maintenance")}
                onChange={(e) => update("status", e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="available">Available</option>
                <option value="rented">Rented</option>
                <option value="under_construction">Pipeline</option>
                <option value="construction_immature">Construction (Immature)</option>
                <option value="maintenance">Maintenance</option>
                <option value="retired">Permanently restricted/Inaccessible (retire)</option>
              </select>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => update("status", "under_construction")}
                  disabled={form.status === "under_construction"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  🚧 Move to Pipeline
                </button>
                {form.status === "under_construction" && <span className="text-xs font-medium text-amber-700">Set — click “Save” to apply.</span>}
              </div>
              <p className="mt-1 text-xs text-gray-500">One status per account. <b>Pipeline</b> is for onboarding and readiness checks. <b>Construction (Immature)</b> is for accounts that need more time to mature. <b>Restricted</b> is set from the inventory list (Mark restricted button), not here.</p>
            </div>
            <Input id="linkedinName" label="LinkedIn Name" value={(form.linkedinName as string) || ""} onChange={(e) => update("linkedinName", e.target.value)} />
            <Input id="linkedinHeadline" label="Headline" value={(form.linkedinHeadline as string) || ""} onChange={(e) => update("linkedinHeadline", e.target.value)} />
            <Input id="linkedinUrl" label="LinkedIn URL" value={(form.linkedinUrl as string) || ""} onChange={(e) => update("linkedinUrl", e.target.value)} />
            <div className="grid grid-cols-2 gap-4">
              <Input id="connectionCount" label="Connections" type="text" inputMode="numeric" value={(form.connectionCount as number) || ""} onChange={(e) => update("connectionCount", parseInt(e.target.value) || 0)} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Opened</label>
                <input
                  type="date"
                  value={(form.accountOpenedDate as string) || (() => {
                    // No explicit opened-date on the record — derive an approximate one
                    // from the stored age so this field mirrors the inline "Account opened"
                    // (both drive accountAgeMonths). Otherwise it always shows blank.
                    const m = form.accountAgeMonths;
                    if (m == null || m === "") return "";
                    const d = new Date();
                    d.setMonth(d.getMonth() - Number(m));
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
                  })()}
                  onChange={(e) => {
                    update("accountOpenedDate", e.target.value);
                    if (e.target.value) {
                      const opened = new Date(e.target.value);
                      const now = new Date();
                      const months = (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth());
                      update("accountAgeMonths", Math.max(0, months));
                    }
                  }}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="industry" label="Industry" value={(form.industry as string) || ""} onChange={(e) => update("industry", e.target.value)} />
              <Input id="location" label="Location" value={(form.location as string) || ""} onChange={(e) => update("location", e.target.value)} />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(form.hasSalesNav as boolean) || false} onChange={(e) => update("hasSalesNav", e.target.checked)} className="rounded border-gray-300" />
                Has Sales Navigator
              </label>
              <label className="flex items-center gap-2 text-sm">
                {/* Available always implies Listed (enforced server-side). Show it locked
                    on so the box can't strand an available account off the catalogue. */}
                <input type="checkbox" checked={form.status === "available" ? true : ((form.listed as boolean) ?? true)} disabled={form.status === "available"} onChange={(e) => update("listed", e.target.checked)} className="rounded border-gray-300" />
                Listed (visible on Browse Accounts)
                {form.status === "available" && <span className="text-xs text-gray-500">— always on while Available</span>}
              </label>
              {/* Verified moved here from the inventory row: it changes the price tier
                  (+$10/mo) and what renters are promised, so it shouldn't be a one-click
                  toggle in a long list. */}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(form.linkedinVerified as boolean) || false} onChange={(e) => update("linkedinVerified", e.target.checked)} className="rounded border-gray-300" />
                LinkedIn verified (blue check) — adds $10/mo
              </label>
            </div>
            <Input id="gologinShareLink" label="GoLogin Share Profile Link" value={(form.gologinShareLink as string) || ""} onChange={(e) => update("gologinShareLink", e.target.value)} placeholder="https://app.gologin.com/..." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Pricing</h3></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="monthlyPrice" label="Rental Price ($/mo)" type="text" inputMode="numeric" value={(form.monthlyPrice as number) || ""} onChange={(e) => update("monthlyPrice", e.target.value)} placeholder="What the customer pays" />
              <Input id="ambassadorPayment" label="Ambassador Payment ($/mo)" type="text" inputMode="numeric" value={(form.ambassadorPayment as number) || ""} onChange={(e) => update("ambassadorPayment", e.target.value)} placeholder="What the owner receives" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Images</h3></CardHeader>
          <CardContent className="space-y-4">
            <ImageUpload label="Profile Photo" value={(form.profilePhotoUrl as string) || ""} onChange={(url) => update("profilePhotoUrl", url)} />
            <ImageUpload label="Profile Screenshot" value={(form.profileScreenshotUrl as string) || ""} onChange={(url) => update("profileScreenshotUrl", url)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Proxy</h3></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="proxyHost" label="Host" value={(form.proxyHost as string) || ""} onChange={(e) => update("proxyHost", e.target.value)} />
              <Input id="proxyPort" label="Port" placeholder="e.g. 12877" value={(form.proxyPort as string | number) || ""} onChange={(e) => update("proxyPort", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="proxyUsername" label="Username" value={(form.proxyUsername as string) || ""} onChange={(e) => update("proxyUsername", e.target.value)} />
              <Input id="proxyPassword" label="Password" type="password" value={(form.proxyPassword as string) || ""} onChange={(e) => update("proxyPassword", e.target.value)} />
            </div>
            <Input id="proxyLocation" label="Location" placeholder="e.g. US · New York" value={(form.proxyLocation as string) || ""} onChange={(e) => update("proxyLocation", e.target.value)} />
            <ProxyTestButton
              host={(form.proxyHost as string) || ""}
              port={(form.proxyPort as string | number) || ""}
              username={(form.proxyUsername as string) || ""}
              password={(form.proxyPassword as string) || ""}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-semibold text-gray-900">
              Login Credentials{" "}
              <span className="text-xs font-normal text-gray-500">— admin only, never shown to renters</span>
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="loginEmail" label="Login Email — we sign in with this" value={(form.loginEmail as string) || ""} onChange={(e) => update("loginEmail", e.target.value)} placeholder="our klabber.co / ortus.solutions address" />
              <Input id="personalEmail" label="Personal Email — their own" value={(form.personalEmail as string) || ""} onChange={(e) => update("personalEmail", e.target.value)} placeholder="the ambassador's own gmail, etc." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="workEmail" label="Work / Recovery Email" value={(form.workEmail as string) || ""} onChange={(e) => update("workEmail", e.target.value)} placeholder="secondary / recovery address" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="accountPassword" label="Account Password" value={(form.accountPassword as string) || ""} onChange={(e) => update("accountPassword", e.target.value)} placeholder="LinkedIn password" />
              <Input id="twoFactor" label="2FA Secret / Key" value={(form.twoFactor as string) || ""} onChange={(e) => update("twoFactor", e.target.value)} placeholder="TOTP seed (Base32)" />
            </div>
            {form.twoFactorResetNeeded ? (
              <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <span className="text-sm text-red-800">
                  🔑 The last renter had this code — account can&apos;t go back to Available until it&apos;s rotated above and this is cleared.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => update("twoFactorResetNeeded", false)}
                >
                  I&apos;ve rotated it — clear flag
                </Button>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={!!form.twoFactorResetNeeded}
                  onChange={(e) => update("twoFactorResetNeeded", e.target.checked)}
                />
                Flag 2FA as exposed / needing reset
              </label>
            )}
          </CardContent>
        </Card>


        {/* Rental history */}
        {rentals.length > 0 && (
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Rental History</h3></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {rentals.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{r.user.fullName}</span>
                      <span className="text-gray-500 ml-2">{r.user.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "active" ? "success" : "default"}>{r.status}</Badge>
                      <span className="text-gray-400">{formatDate(r.startDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-4">
          <Button type="submit" loading={saving}>Save Changes</Button>
          <Button type="button" variant="outline" onClick={() => (onClose ? onClose() : router.back())}>Cancel</Button>
          {saved && <span className="text-sm font-medium text-green-600">Changes saved successfully.</span>}
          {error && <span className="text-sm font-medium text-red-600">{error}</span>}
          <div className="ml-auto">
            <Button
              type="button"
              variant="outline"
              loading={deleting}
              onClick={async () => {
                if (!confirm("Are you sure you want to delete this profile? This cannot be undone.")) return;
                setDeleting(true);
                try {
                  const res = await fetch(`/api/admin/accounts/${accountId}`, { method: "DELETE" });
                  if (res.ok) {
                    if (onDeleted) onDeleted();
                    else router.push("/admin/inventory-v2");
                  } else {
                    const data = await res.json();
                    setError(data.error || "Failed to delete");
                  }
                } catch {
                  setError("Something went wrong");
                } finally {
                  setDeleting(false);
                }
              }}
              className="!text-red-600 !border-red-200 hover:!bg-red-50"
            >
              Delete Profile
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
