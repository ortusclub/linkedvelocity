export const agentOperations = [
  {
    "name": "get_accounts",
    "method": "GET",
    "path": "/api/accounts"
  },
  {
    "name": "get_accounts_id",
    "method": "GET",
    "path": "/api/accounts/{id}"
  },
  {
    "name": "get_profile",
    "method": "GET",
    "path": "/api/profile"
  },
  {
    "name": "patch_profile",
    "method": "PATCH",
    "path": "/api/profile"
  },
  {
    "name": "patch_profile_payment",
    "method": "PATCH",
    "path": "/api/profile/payment"
  },
  {
    "name": "get_vetting",
    "method": "GET",
    "path": "/api/vetting"
  },
  {
    "name": "post_vetting",
    "method": "POST",
    "path": "/api/vetting"
  },
  {
    "name": "get_rentals",
    "method": "GET",
    "path": "/api/rentals"
  },
  {
    "name": "post_rentals_checkout_usdc",
    "method": "POST",
    "path": "/api/rentals/checkout-usdc"
  },
  {
    "name": "post_rentals_checkout",
    "method": "POST",
    "path": "/api/rentals/checkout"
  },
  {
    "name": "post_rentals_id_access",
    "method": "POST",
    "path": "/api/rentals/{id}/access"
  },
  {
    "name": "get_rentals_id_signin_code",
    "method": "GET",
    "path": "/api/rentals/{id}/signin-code"
  },
  {
    "name": "patch_rentals_id_auto_renew",
    "method": "PATCH",
    "path": "/api/rentals/{id}/auto-renew"
  },
  {
    "name": "get_rentals_id_renew",
    "method": "GET",
    "path": "/api/rentals/{id}/renew"
  },
  {
    "name": "post_rentals_id_cancel",
    "method": "POST",
    "path": "/api/rentals/{id}/cancel"
  },
  {
    "name": "post_rentals_id_replace",
    "method": "POST",
    "path": "/api/rentals/{id}/replace"
  },
  {
    "name": "get_rentals_id_replacement_options",
    "method": "GET",
    "path": "/api/rentals/{id}/replacement-options"
  },
  {
    "name": "post_rentals_id_wait",
    "method": "POST",
    "path": "/api/rentals/{id}/wait"
  },
  {
    "name": "post_rentals_billing_portal",
    "method": "POST",
    "path": "/api/rentals/billing-portal"
  },
  {
    "name": "get_wallet_balance",
    "method": "GET",
    "path": "/api/wallet/balance"
  },
  {
    "name": "get_wallet_transactions",
    "method": "GET",
    "path": "/api/wallet/transactions"
  },
  {
    "name": "get_wallet_payments",
    "method": "GET",
    "path": "/api/wallet/payments"
  },
  {
    "name": "get_wallet_deposit_address",
    "method": "GET",
    "path": "/api/wallet/deposit-address"
  },
  {
    "name": "post_wallet_withdraw",
    "method": "POST",
    "path": "/api/wallet/withdraw"
  },
  {
    "name": "get_wallet_auto_recharge",
    "method": "GET",
    "path": "/api/wallet/auto-recharge"
  },
  {
    "name": "post_wallet_auto_recharge",
    "method": "POST",
    "path": "/api/wallet/auto-recharge"
  },
  {
    "name": "get_wallet_card",
    "method": "GET",
    "path": "/api/wallet/card"
  },
  {
    "name": "delete_wallet_card",
    "method": "DELETE",
    "path": "/api/wallet/card"
  },
  {
    "name": "post_wallet_card_setup",
    "method": "POST",
    "path": "/api/wallet/card-setup"
  },
  {
    "name": "post_wallet_card_topup_checkout",
    "method": "POST",
    "path": "/api/wallet/card-topup-checkout"
  },
  {
    "name": "post_discounts_validate",
    "method": "POST",
    "path": "/api/discounts/validate"
  }
] as const;
