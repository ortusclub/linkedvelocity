"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeveloperKeys } from "../developer/keys";
import { CardTopUp } from "../dashboard/card-topup";

interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  contactNumber: string | null;
  role: string;
  stripeCustomerId: string | null;
  createdAt: string;
}

interface PaymentDetails {
  paymentMethod: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  bankSortCode: string | null;
  usdcWalletAddress: string | null;
  usdcNetwork: string | null;
  paypalEmail: string | null;
  wiseEmail: string | null;
}

type Section = "personal" | "wallet" | "developer";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("personal");

  // Personal info form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactMethod, setContactMethod] = useState<"whatsapp" | "telegram">("whatsapp");
  const [contactHandle, setContactHandle] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // Payment form
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankRoutingNumber, setBankRoutingNumber] = useState("");
  const [bankSortCode, setBankSortCode] = useState("");
  const [usdcWalletAddress, setUsdcWalletAddress] = useState("");
  const [usdcNetwork, setUsdcNetwork] = useState("ethereum");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [wiseEmail, setWiseEmail] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");

  // Billing state
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [showCryptoTopUp, setShowCryptoTopUp] = useState(false);
  const [showCardTopUp, setShowCardTopUp] = useState(false);
  // Previous credit top-ups (with a PDF receipt each).
  const [payments, setPayments] = useState<{ id: string; amount: string; method: string; reference: string; createdAt: string }[]>([]);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [currentPaymentMethod, setCurrentPaymentMethod] = useState("crypto_wallet");
  const [currentPaymentDetails, setCurrentPaymentDetails] = useState("");

  useEffect(() => {
    fetch("/api/wallet/payments")
      .then((r) => (r.ok ? r.json() : { payments: [] }))
      .then((d) => setPayments(d.payments || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/login"; return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        const u = data.user;
        setUser(u);
        const nameParts = (u.fullName || "").split(" ");
        setFirstName(nameParts[0] || "");
        setLastName(nameParts.slice(1).join(" ") || "");
        if (u.contactNumber) {
          if (u.contactNumber.startsWith("telegram:")) {
            setContactMethod("telegram");
            setContactHandle(u.contactNumber.replace("telegram:", ""));
          } else if (u.contactNumber.startsWith("whatsapp:")) {
            setContactMethod("whatsapp");
            setContactHandle(u.contactNumber.replace("whatsapp:", ""));
          } else {
            setContactHandle(u.contactNumber);
          }
        }

        // Set current payment method from application or user
        if (data.paymentDetails?.paymentMethod) {
          setCurrentPaymentMethod(data.paymentDetails.paymentMethod);
        }
        if (data.user?.paymentDetails) {
          setCurrentPaymentDetails(data.user.paymentDetails);
        }

        if (data.paymentDetails) {
          const p = data.paymentDetails;
          setPaymentDetails(p);
          setPaymentMethod(p.paymentMethod || "bank_transfer");
          setBankName(p.bankName || "");
          setBankAccountName(p.bankAccountName || "");
          setBankAccountNumber(p.bankAccountNumber || "");
          setBankRoutingNumber(p.bankRoutingNumber || "");
          setBankSortCode(p.bankSortCode || "");
          setUsdcWalletAddress(p.usdcWalletAddress || "");
          setUsdcNetwork(p.usdcNetwork || "ethereum");
          setPaypalEmail(p.paypalEmail || "");
          setWiseEmail(p.wiseEmail || "");
        }
        setLoading(false);
      })
      .catch(() => router.push("/login"));

    // Fetch wallet balance
    fetch("/api/wallet/balance").then(r => r.json()).then(data => {
      setUsdcBalance(data.balance || "0");
    }).catch(() => {});
  }, [router]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMessage("");

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: `${firstName.trim()} ${lastName.trim()}`, contactNumber: contactHandle ? `${contactMethod}:${contactHandle}` : "" }),
    });

    if (res.ok) {
      const data = await res.json();
      setUser((prev) => prev ? { ...prev, ...data.user } : prev);
      setProfileMessage("Profile updated successfully.");
    } else {
      setProfileMessage("Failed to update profile.");
    }
    setSavingProfile(false);
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPayment(true);
    setPaymentMessage("");

    const res = await fetch("/api/profile/payment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentMethod, bankName, bankAccountName, bankAccountNumber,
        bankRoutingNumber, bankSortCode, usdcWalletAddress, usdcNetwork,
        paypalEmail, wiseEmail,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setPaymentDetails(data.paymentDetails);
      setPaymentMessage("Payment details updated successfully.");
    } else {
      const data = await res.json();
      setPaymentMessage(data.error || "Failed to update payment details.");
    }
    setSavingPayment(false);
  };

  const handleBillingPortal = async () => {
    const res = await fetch("/api/rentals/billing-portal", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  const getInitials = (name: string) => {
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8]">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="h-24 animate-pulse rounded-2xl bg-gray-200 mb-6" />
          <div className="h-64 animate-pulse rounded-2xl bg-gray-200" />
        </div>
      </div>
    );
  }

  const sidebarItems: { key: Section; label: string; icon: string }[] = [
    { key: "personal", label: "Personal Info", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    { key: "developer", label: "Developer mode", icon: "M10 6L4 12l6 6m4-12l6 6-6 6" },
    { key: "wallet", label: "Wallet", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">

        {/* Profile Header */}
        <div className="mb-10">
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-6 inline-block">
            &larr; Back to Dashboard
          </Link>
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 rounded-full bg-[#1D1B16] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xl font-semibold tracking-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                {user ? getInitials(user.fullName) : ""}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1D1B16] tracking-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                {user?.fullName}
              </h1>
              <p className="text-sm text-gray-400 mt-0.5">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-8 bg-white rounded-xl border border-gray-200 p-1">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === item.key
                  ? "bg-[#1D1B16] text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </div>

        {activeSection === "developer" && <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
          <header><h2 className="text-lg font-semibold text-[#1D1B16]">Developer mode</h2><p className="text-sm text-gray-500 mt-2">Give your agent API access to your accounts, share links, orders and wallet.</p></header>
          <DeveloperKeys />
          <p className="text-sm text-gray-600">Connect your agent to this website’s <code>/api/mcp</code> endpoint with <code>Authorization: Bearer YOUR_KEY</code>. Your agent acts with your account permissions and can spend wallet funds.</p>
          <Link href="/developer" className="inline-flex rounded-lg bg-[#1D1B16] px-4 py-2.5 text-sm font-medium text-white">Connection instructions and API reference</Link>
        </div>}

        {/* Personal Info Section */}
        {activeSection === "personal" && (<>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-[#1D1B16]">Personal Information</h2>
              <p className="text-sm text-gray-400 mt-1">Update your name and contact details.</p>
            </div>
            <div className="px-6 py-6">
              <form onSubmit={handleSaveProfile} className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="firstName"
                    label="First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                  <Input
                    id="lastName"
                    label="Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Email Address</label>
                  <p className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-400 text-sm">
                    {user?.email}
                  </p>
                  <p className="text-xs text-gray-400">Email cannot be changed. Create a new account to use a different email.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp or Telegram</label>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setContactMethod("whatsapp")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${contactMethod === "whatsapp" ? "border-green-500 bg-green-50 text-green-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                    >
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactMethod("telegram")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${contactMethod === "telegram" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                    >
                      Telegram
                    </button>
                  </div>
                  <input
                    type="text"
                    value={contactHandle}
                    onChange={(e) => setContactHandle(e.target.value)}
                    placeholder={contactMethod === "whatsapp" ? "+44 7700 000000" : "@username"}
                    required
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Only used for communication about your rented or ambassador accounts — never for marketing or promotions.</p>
                </div>
                {profileMessage && (
                  <div className={`text-sm px-4 py-3 rounded-lg ${
                    profileMessage.includes("success")
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}>
                    {profileMessage}
                  </div>
                )}
                <div className="pt-2">
                  <Button type="submit" variant="primary" loading={savingProfile}>
                    Save Changes
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Previous payments — credit top-ups, each with a PDF receipt */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-6">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-[#1D1B16]" style={{ fontFamily: "'Montserrat', sans-serif" }}>Previous Payments</h2>
              <p className="text-sm text-gray-400 mt-0.5">Receipts for your credit top-ups.</p>
            </div>
            <div className="px-6 py-5">
              {payments.length === 0 ? (
                <p className="text-sm text-gray-400">No payments yet. Top-ups you make will appear here.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1D1B16]">${p.amount} <span className="font-normal text-gray-400">· {p.method}</span></p>
                        <p className="text-xs text-gray-400 mt-0.5">{new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                      <a href={`/api/wallet/receipt/${p.id}`} target="_blank" rel="noopener noreferrer" className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>
                        Receipt (PDF)
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* Wallet Section */}
        {activeSection === "wallet" && (
          <div className="space-y-5">
            {/* Balance Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Available Balance</p>
                    <p className="text-3xl font-bold text-[#1D1B16] mt-1" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                      ${parseFloat(usdcBalance).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Deposit */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-[#1D1B16]">Deposit</h2>
                <p className="text-sm text-gray-400 mt-1">Add funds to your wallet to pay for account rentals.</p>
              </div>
              <div className="px-6 py-5 space-y-3">
                {/* Crypto Transfer */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => {
                      setShowCryptoTopUp(!showCryptoTopUp);
                      setShowCardTopUp(false);
                      if (!depositAddress) {
                        fetch("/api/wallet/deposit-address").then(r => r.json()).then(data => {
                          if (data.address) setDepositAddress(data.address);
                        }).catch(() => {});
                      }
                    }}
                    className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12M15 9.5c0-1.38-1.34-2.5-3-2.5S9 8.12 9 9.5 10.34 12 12 12s3 1.12 3 2.5-1.34 2.5-3 2.5-3-1.12-3-2.5" />
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">Transfer USDC</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Send USDC from your crypto wallet on Base. No fees.</p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${showCryptoTopUp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {showCryptoTopUp && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Send USDC on Base to:</p>
                      {depositAddress ? (
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 break-all text-gray-700">{depositAddress}</code>
                          <button
                            onClick={() => { navigator.clipboard.writeText(depositAddress); setAddressCopied(true); setTimeout(() => setAddressCopied(false), 2000); }}
                            className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                          >
                            {addressCopied ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">Loading your deposit address...</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1.5">Unique to your account. Please allow up to one minute for deposits to be detected.</p>
                    </div>
                  )}
                </div>

                {/* Card Payment */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => {
                      setShowCardTopUp(!showCardTopUp);
                      setShowCryptoTopUp(false);
                    }}
                    className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">Pay with Card</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Credit or debit card via Stripe.</p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${showCardTopUp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {showCardTopUp && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                      <CardTopUp />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-[#1D1B16]">Withdraw</h2>
                <p className="text-sm text-gray-400 mt-1">Send USDC from your LinkedVelocity balance to an external wallet.</p>
              </div>
              <div className="px-6 py-5">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Wallet Address (Base)</label>
                    <input type="text" placeholder="0x..." value={withdrawAddress} onChange={(e) => setWithdrawAddress(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount (USDC)</label>
                    <input type="text" inputMode="numeric" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <button
                    onClick={async () => {
                      setWithdrawing(true); setWithdrawError(""); setWithdrawSuccess(false);
                      try {
                        const res = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: withdrawAddress, amount: withdrawAmount }) });
                        const data = await res.json();
                        if (!res.ok) { setWithdrawError(data.error || "Withdrawal failed"); return; }
                        setWithdrawSuccess(true);
                        setUsdcBalance((prev) => (parseFloat(prev) - parseFloat(withdrawAmount)).toString());
                        setWithdrawAddress(""); setWithdrawAmount("");
                      } catch { setWithdrawError("Something went wrong"); } finally { setWithdrawing(false); }
                    }}
                    disabled={withdrawing || !withdrawAddress || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > parseFloat(usdcBalance)}
                    className="w-full rounded-lg bg-[#1D1B16] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {withdrawing ? "Processing..." : "Withdraw USDC"}
                  </button>
                  {withdrawError && <p className="text-xs text-red-600">{withdrawError}</p>}
                  {withdrawSuccess && <p className="text-xs text-green-600">Withdrawal submitted successfully!</p>}
                </div>
              </div>
            </div>

            {/* Current Payment Method */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Your Current Payout Method</h3>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 flex-shrink-0">
                      {currentPaymentMethod === "crypto_wallet" || currentPaymentMethod === "usdc" ? (
                        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12M15 9.5c0-1.38-1.34-2.5-3-2.5S9 8.12 9 9.5 10.34 12 12 12s3 1.12 3 2.5-1.34 2.5-3 2.5-3-1.12-3-2.5" /><circle cx="12" cy="12" r="10" /></svg>
                      ) : (
                        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {currentPaymentMethod === "crypto_wallet" ? "Crypto Wallet (USDC)" :
                         currentPaymentMethod === "usdc" ? "USDC" :
                         currentPaymentMethod === "paypal" ? "PayPal" :
                         currentPaymentMethod === "wise" ? "Wise" :
                         currentPaymentMethod === "bank_transfer" ? "Bank Transfer" :
                         currentPaymentMethod}
                      </p>
                      {currentPaymentDetails && (
                        <p className="text-xs text-gray-500 mt-0.5">{currentPaymentDetails}</p>
                      )}
                      {!currentPaymentDetails && (
                        <p className="text-xs text-gray-400 mt-0.5">Paid in the first few days of each month</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Alternative payout */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Prefer a different payout method?</h3>
                <p className="text-sm text-gray-500 mb-4">
                  If you&#39;d like to receive ambassador payments via bank transfer, PayPal, or Wise instead of USDC, get in touch and we&#39;ll be happy to oblige.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a href="https://t.me/linkedvelocity_support_bot" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    Telegram
                  </a>
                  <a href="mailto:info@linkedvelocity.com" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    Email
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
