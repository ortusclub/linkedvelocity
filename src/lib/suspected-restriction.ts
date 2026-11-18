// linkedinAccountHealth value set by the LV Agent (droplet "lv-agent", Sam 18 Nov 2026):
// a maturing account showed "Requires login" and, viewed from a HEALTHY logged-in LV
// account, LinkedIn said its profile is not available. It is not a confirmed restriction
// (restrictedAt stays empty — Construction accounts must never carry a restriction mark),
// but it takes the account off Profile Maturing: reconcile stops its plans, auto-start
// skips it and the outreach feed reports it as restricted. Setting health back to
// "active" in Inventory undoes it.
export const SUSPECTED_RESTRICTION = "suspected_restriction";
