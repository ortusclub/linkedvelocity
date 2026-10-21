import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.resolve(testDir, "..", file), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, mocks);
    return requireModule(name);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function withTestKey(fn) {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  return Promise.resolve().then(fn).finally(() => {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  });
}

test("encryption round trips and legacy plaintext remains readable", () => withTestKey(() => {
  const { encryptSecret, decryptSecret } = load("src/lib/crypto-creds.ts");
  const stored = encryptSecret("sample-password");
  assert.match(stored, /^v1:/);
  assert.notEqual(stored, "sample-password");
  assert.equal(decryptSecret(stored), "sample-password");
  assert.equal(decryptSecret("legacy-password"), "legacy-password");
  assert.equal(encryptSecret(null), null);
  assert.equal(encryptSecret(""), "");
}));

test("admin account PATCH encrypts updated credentials and returns readable values", () => withTestKey(async () => {
  let stored;
  const prisma = { linkedInAccount: { update: async ({ data }) => {
    stored = { ...data };
    return { ...data, id: "account", loginEmail: null, gologinProfileId: null };
  } } };
  const route = load("src/app/api/admin/accounts/[id]/route.ts", {
    "next/server": { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } },
    "@/lib/prisma": { prisma },
    "@/lib/auth": { requireAdmin: async () => {} },
    "@/lib/persist-image": { persistImageUrl: async (url) => url },
    "@/lib/onboarding": { markOwnerOnboardedIfReady: async () => {} },
    "@/lib/provision-account": { provisionAccount: async () => {} },
    "@/services/gologin": {},
  });
  const request = new Request("https://example.test/api/admin/accounts/account", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountPassword: "new-password", twoFactor: "new-2fa" }),
  });
  const response = await route.PATCH(request, { params: Promise.resolve({ id: "account" }) });
  assert.equal(response.status, 200);
  assert.match(stored.accountPassword, /^v1:/);
  assert.match(stored.twoFactor, /^v1:/);
  assert.equal(response.data.account.accountPassword, "new-password");
  assert.equal(response.data.account.twoFactor, "new-2fa");
}));

test("self-service confirmation and phone handoff encrypt every supplied credential", () => withTestKey(async () => {
  const writes = [];
  const tx = {
    selfServiceOnboarding: {
      updateMany: async () => ({ count: 1 }),
      findFirst: async () => ({ state: "confirmed", applicationId: "app", accountId: "acc", confirmedAt: new Date() }),
      update: async () => {},
    },
    linkedInAccount: {
      findUniqueOrThrow: async () => ({ status: "under_construction", gologinProfileId: "profile", gologinShareLink: "https://example.test/share", restrictedAt: null, notes: "" }),
      update: async ({ data }) => { writes.push(data); },
    },
    ambassadorApplication: { update: async () => {} },
  };
  const prisma = {
    $transaction: async (fn) => fn(tx),
    selfServiceOnboarding: { findFirst: async () => ({ state: "ready", accountId: "acc", applicationId: "app", account: { notes: "" }, application: { adminNotes: "" } }) },
  };
  const service = load("src/lib/self-service-onboarding.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/onboarding-email": { requireEmailSetup: async () => {} },
    "@/lib/referral-currency": {},
    "@/lib/referrals": {},
    "@/lib/payment-schedule": {},
    "@/services/gologin": {},
    "@/lib/self-service-input": {},
    "@/lib/countries": {},
    "@/services/proxy-cheap": { PURCHASE_PROXY_COUNTRIES: [] },
    "@/lib/onboarding-proxy-pool": {},
    "@/lib/phone-verification": {},
  });
  await service.confirmOnboarding("session", "referrer", { password: "pc-password", twoFactorKey: "pc-2fa" });
  await service.handoffOnboarding("session", "referrer", { password: "phone-password", twoFactorKey: "phone-2fa" });
  const { decryptSecret } = load("src/lib/crypto-creds.ts");
  assert.equal(writes.length, 2);
  for (const [i, values] of writes.entries()) {
    assert.match(values.accountPassword, /^v1:/);
    assert.match(values.twoFactor, /^v1:/);
    assert.equal(decryptSecret(values.accountPassword), i ? "phone-password" : "pc-password");
    assert.equal(decryptSecret(values.twoFactor), i ? "phone-2fa" : "pc-2fa");
  }
}));

test("admin inventory still returns readable credentials from encrypted rows", () => withTestKey(async () => {
  const { encryptSecret } = load("src/lib/crypto-creds.ts");
  const prisma = {
    linkedInAccount: { findMany: async () => [{
      id: "account", notes: null, accountPassword: encryptSecret("stored-password"), twoFactor: encryptSecret("stored-2fa"),
    }] },
  };
  const route = load("src/app/api/admin/accounts/route.ts", {
    "next/server": { NextResponse: { json: (data) => ({ data }) } },
    "@/lib/prisma": { prisma },
    "@/lib/auth": { requireAdmin: async () => {} },
    "@/services/gologin": {},
    "@/lib/persist-image": {},
    "@/lib/onboarding": {},
  });
  const response = await route.GET({ nextUrl: new URL("https://example.test/api/admin/accounts") });
  assert.equal(response.data.accounts[0].accountPassword, "stored-password");
  assert.equal(response.data.accounts[0].twoFactor, "stored-2fa");
}));

test("account owner view returns readable credentials from encrypted rows", () => withTestKey(async () => {
  const { encryptSecret } = load("src/lib/crypto-creds.ts");
  const account = {
    id: "account", linkedinName: "Example", status: "available", linkedinUrl: null,
    monthlyPrice: 0, ambassadorPayment: 0, loginEmail: null, personalEmail: null,
    accountPassword: encryptSecret("owner-password"), twoFactor: encryptSecret("owner-2fa"),
    workEmail: null, restrictedAt: null, notes: "Owner: owner@example.test", createdAt: new Date(),
  };
  const prisma = {
    linkedInAccount: { findMany: async ({ where }) => where.notes ? [account] : [] },
    ambassadorApplication: { findMany: async () => [] },
    user: { findMany: async () => [] },
  };
  const owners = load("src/lib/owners.ts", { "@/lib/prisma": { prisma } });
  const result = await owners.getOwners();
  assert.equal(result[0].accounts[0].accountPassword, "owner-password");
  assert.equal(result[0].accounts[0].twoFactor, "owner-2fa");
}));
