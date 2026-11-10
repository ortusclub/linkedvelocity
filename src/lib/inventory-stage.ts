import { isCompanyEmail } from "@/lib/company";

export interface InventoryStageAccount {
  status: string; exitReason?: string | null; ownerApplicationId?: string | null;
  ownerSetupPaidAt?: unknown; ownerOnboarded?: boolean; restrictedAt?: unknown;
  twoFactorResetNeeded?: boolean; loginEmail?: string | null; accountPassword?: string | null;
}

export function canonicalStatus(a: InventoryStageAccount): string {
  if (a.status === "retired") return "Permanently restricted/Inaccessible";
  if (a.status === "removed") return "Removed";
  // Owner exits (status unavailable + an exit reason): the account is out of our hands —
  // returned to the owner or our access was cut. Group it as inaccessible, never Construction.
  if (a.status === "unavailable" && a.exitReason) return "Permanently restricted/Inaccessible";
  if (a.status !== "rented" && a.ownerApplicationId && !a.ownerSetupPaidAt) return "Initial";
  if (a.restrictedAt || a.status === "maintenance") return "Maintenance";
  if (a.status === "rented") return "Rented";
  if (a.ownerApplicationId && !a.ownerOnboarded) return "Construction";
  if (a.status === "construction_immature" || a.status === "under_construction") return a.ownerOnboarded ? "Construction" : "Initial";
  if (a.status === "available") return a.twoFactorResetNeeded ? "Maintenance" : "Available";
  if (a.status === "trial") return "Trial";
  if (!a.loginEmail || !isCompanyEmail(a.loginEmail) || !a.accountPassword) return "Initial";
  return a.ownerOnboarded ? "Construction" : "Initial";
}
