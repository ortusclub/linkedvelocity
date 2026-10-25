type Operation = { method: string; path: string };
export function isReadOnlyOperation(op: Operation) {
  return op.method === "GET" && op.path !== "/api/rentals/{id}/renew" && op.path !== "/api/wallet/deposit-address";
}
const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const bodies: Record<string, { properties: Record<string, unknown>; required?: string[] }> = {
  patch_profile: { properties: { fullName: string, contactNumber: string } },
  patch_profile_payment: { properties: Object.fromEntries(["paymentMethod", "bankName", "bankAccountName", "bankAccountNumber", "bankRoutingNumber", "bankSortCode", "usdcWalletAddress", "usdcNetwork", "paypalEmail", "wiseEmail"].map(key => [key, string])) },
  post_vetting: { properties: { action: { type: "string", enum: ["start"] }, agreed: boolean, company: string, website: string, role: string, useCase: string, tools: string } },
  post_rentals_checkout_usdc: { properties: { accountIds: { type: "array", items: string, minItems: 1 }, autoRenew: boolean, discountCode: string }, required: ["accountIds"] },
  post_rentals_checkout: { properties: { accountIds: { type: "array", items: string, minItems: 1 } }, required: ["accountIds"] },
  patch_rentals_id_auto_renew: { properties: { autoRenew: boolean }, required: ["autoRenew"] },
  post_rentals_id_replace: { properties: { newAccountId: string }, required: ["newAccountId"] },
  post_wallet_withdraw: { properties: { address: { type: "string", description: "Recipient's Base EVM wallet address" }, amount: { type: "string", description: "USDC amount as a decimal string" } }, required: ["address", "amount"] },
  post_wallet_auto_recharge: { properties: { enabled: boolean, threshold: number, amount: number }, required: ["enabled"] },
  post_wallet_card_setup: { properties: { enable: boolean, threshold: number, amount: number } },
  post_wallet_card_topup_checkout: { properties: { amount: { type: "number", minimum: 10, maximum: 10000 }, successPath: string, cancelPath: string }, required: ["amount"] },
  post_discounts_validate: { properties: { code: string }, required: ["code"] },
};
export function agentBodySchema(name: string) {
  return { type: "object", additionalProperties: false, properties: {}, ...bodies[name] };
}
