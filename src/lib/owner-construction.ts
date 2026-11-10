import { canonicalStatus } from "@/lib/inventory-stage";
import type { Owner } from "@/lib/owners";

export function constructionAccounts(owner: Owner) {
  return owner.accounts.filter(account => canonicalStatus({
    ...account,
    ownerApplicationId: owner.applicationId,
    ownerSetupPaidAt: owner.setupFeePaidAt,
    ownerOnboarded: owner.applicationStatus === "onboarded",
  }) === "Construction");
}
