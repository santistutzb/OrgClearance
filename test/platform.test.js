import test from "node:test";
import assert from "node:assert/strict";
import { createClient, queryIn, parseUsage, clearDescribeCache, ApiError } from "../src/api.js";
import { normalizeHost, base64url, codeChallenge, buildAuthorizeUrl, parseRedirect } from "../src/auth.js";
import { userOverview } from "../src/user.js";

// ---------------- fake chrome ----------------

function installChrome({ cookies = [], configs = {}, redirect, onAuthUrl } = {}) {
  const local = { orgConfigs: configs };
  const session = {};
  const area = (store) => ({
    get: async (k) => (k in store ? { [k]: store[k] } : {}),
    set: async (o) => Object.assign(store, o),
    remove: async (k) => { delete store[k]; },
  });
  globalThis.chrome = {
    storage: { local: area(local), session: area(session) },
    cookies: {
      get: async ({ url, name }) => cookies.find((c) => c.name === name && url === `https://${c.domain}`) ?? null,
      getAll: async ({ name, domain }) => cookies.filter((c) => c.name === name && c.domain.endsWith(domain)),
    },
    identity: {
      getRedirectURL: (p) => `https://extid.chromiumapp.org/${p}`,
      launchWebAuthFlow: async ({ url }) => { onAuthUrl?.(url); return redirect(url); },
    },
  };
  return { local, session };
}

const response = (status, body, headers = {}) => ({
  ok: status < 400, status,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body,
});

// ---------------- API client ----------------

test("api: counts calls, follows pagination, reads org usage header", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/query?")) return response(200, { done: false, nextRecordsUrl: "/services/data/v62.0/query/01g-2000", records: [{ Id: 1 }] }, { "Sforce-Limit-Info": "api-usage=10/15000" });
    return response(200, { done: true, records: [{ Id: 2 }] }, { "Sforce-Limit-Info": "api-usage=11/15000" });
  };
  const c = createClient({ host: "acme.my.salesforce.com", sid: "00D!x" }, { fetchImpl });
  assert.deepEqual(await c.query("SELECT Id FROM Account"), [{ Id: 1 }, { Id: 2 }]);
  assert.equal(c.usage.calls, 2);
  assert.deepEqual(parseUsage(c.usage.orgUsage), { used: 11, max: 15000 });
});

test("api: describe is cached for 10 minutes per org", async () => {
  clearDescribeCache();
  let n = 0;
  let t = 0;
  const fetchImpl = async () => { n++; return response(200, { fields: [] }); };
  const c1 = createClient({ host: "a.my.salesforce.com", sid: "x" }, { fetchImpl, now: () => t });
  await c1.describe("Account");
  const c2 = createClient({ host: "a.my.salesforce.com", sid: "x" }, { fetchImpl, now: () => t });
  await c2.describe("Account");
  assert.equal(n, 1);
  assert.equal(c2.usage.cached, 1);
  await createClient({ host: "b.my.salesforce.com", sid: "x" }, { fetchImpl, now: () => t }).describe("Account");
  assert.equal(n, 2, "other org is not served from cache");
  t = 11 * 60 * 1000;
  await c1.describe("Account");
  assert.equal(n, 3, "expired entry is refetched");
});

test("api: errors keep Salesforce's error code and status", async () => {
  const fetchImpl = async () => response(401, [{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }]);
  const c = createClient({ host: "a.my.salesforce.com", sid: "x" }, { fetchImpl });
  await assert.rejects(c.query("SELECT Id FROM User"), (e) => e instanceof ApiError && e.status === 401 && e.code === "INVALID_SESSION_ID");
});

test("queryIn: splits long Id lists and rejects bad Ids", async () => {
  const ids = Array.from({ length: 320 }, (_, i) => `005${String(i).padStart(12, "0")}`);
  const seen = [];
  const rows = await queryIn(async (q) => { seen.push((q.match(/'/g) || []).length / 2); return [q.length]; }, (l) => `SELECT Id FROM User WHERE Id IN (${l})`, [...ids, ids[0]]);
  assert.deepEqual(seen, [150, 150, 20]);
  assert.equal(rows.length, 3);
  await assert.rejects(queryIn(async () => [], (l) => l, ["005' OR Name != '"]), /Invalid Id/);
});

// ---------------- OAuth helpers ----------------

test("auth: normalizes whatever URL the user pastes", () => {
  assert.equal(normalizeHost("https://acme.lightning.force.com/lightning/page/home"), "acme.my.salesforce.com");
  assert.equal(normalizeHost("acme--uat.sandbox.my.salesforce-setup.com"), "acme--uat.sandbox.my.salesforce.com");
  assert.equal(normalizeHost(" https://ACME.my.salesforce.com/ "), "acme.my.salesforce.com");
  assert.throws(() => normalizeHost("https://evil.example.com"), /My Domain/);
  assert.throws(() => normalizeHost("salesforce.com.evil.io"), /My Domain/);
});

test("auth: PKCE challenge matches RFC 7636 test vector", async () => {
  assert.equal(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(base64url(new Uint8Array([251, 255])), "-_8");
});

test("auth: authorize URL and redirect parsing", () => {
  const url = new URL(buildAuthorizeUrl({ host: "acme.my.salesforce.com", clientId: "3MVG9abc", redirectUri: "https://x.chromiumapp.org/oauth2", challenge: "ch", state: "st" }));
  assert.equal(url.origin + url.pathname, "https://acme.my.salesforce.com/services/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), "api");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parseRedirect("https://x.chromiumapp.org/oauth2?code=abc&state=st", "st"), "abc");
  assert.throws(() => parseRedirect("https://x.chromiumapp.org/oauth2?code=abc&state=other", "st"), /state mismatch/);
  assert.throws(() => parseRedirect("https://x.chromiumapp.org/oauth2?error=access_denied&error_description=end-user+denied", "st"), /end-user denied/);
});

test("auth: full OAuth flow stores the token in session storage only, without a secret", async () => {
  const { session, local } = installChrome({
    configs: { "acme.my.salesforce.com": { mode: "oauth", clientId: "3MVG9clientid" } },
    redirect: (url) => `https://extid.chromiumapp.org/oauth2?code=CODE&state=${new URL(url).searchParams.get("state")}`,
  });
  let tokenBody;
  const fetchImpl = async (url, init) => {
    tokenBody = new URLSearchParams(init.body);
    return response(200, { access_token: "00Dxx!TOKEN", instance_url: "https://acme.my.salesforce.com" });
  };
  const { getOAuthSession } = await import("../src/auth.js");
  const s = await getOAuthSession("acme.my.salesforce.com", { fetchImpl });
  assert.deepEqual(s, { host: "acme.my.salesforce.com", sid: "00Dxx!TOKEN" });
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.ok(tokenBody.get("code_verifier").length >= 43);
  assert.equal(tokenBody.get("client_secret"), null);
  assert.deepEqual(session["token:acme.my.salesforce.com"], s);
  assert.ok(!JSON.stringify(local).includes("TOKEN"), "token is never persisted to local storage");
  // Second call uses the cached token: no new login.
  assert.deepEqual(await getOAuthSession("acme.my.salesforce.com", { fetchImpl: () => { throw new Error("should not fetch"); } }), s);
});

// ---------------- session resolution ----------------

test("resolve: tab uses its own org; workspace may only pick known orgs; OAuth overrides cookie", async () => {
  installChrome({
    cookies: [
      { name: "sid", domain: "acme.my.salesforce.com", value: "00DAAAAAAAAAAAA!cookie1" },
      { name: "sid", domain: "acme.lightning.force.com", value: "00DAAAAAAAAAAAA!lightning" },
      { name: "sid", domain: "corp.my.salesforce.com", value: "00DBBBBBBBBBBBB!cookie2" },
    ],
    configs: { "corp.my.salesforce.com": { mode: "oauth", clientId: "3MVG9corp" }, "other.my.salesforce.com": { mode: "oauth", clientId: "3MVG9o" } },
    redirect: () => { throw new Error("no login in this test"); },
  });
  globalThis.chrome.storage.session.set({ "token:corp.my.salesforce.com": { host: "corp.my.salesforce.com", sid: "00DBBBBBBBBBBBB!oauth" } });
  const { resolveSession, listKnownOrgs } = await import("../src/resolve.js");

  const fromTab = await resolveSession({ pageHost: "acme.lightning.force.com" });
  assert.deepEqual([fromTab.host, fromTab.sid, fromTab.auth], ["acme.my.salesforce.com", "00DAAAAAAAAAAAA!cookie1", "cookie"]);

  const corp = await resolveSession({ orgHost: "corp.my.salesforce.com" });
  assert.deepEqual([corp.sid, corp.auth], ["00DBBBBBBBBBBBB!oauth", "oauth"]);

  await assert.rejects(resolveSession({ orgHost: "stranger.my.salesforce.com" }), /not logged into/);
  await assert.rejects(resolveSession({}), /No org selected/);

  const known = await listKnownOrgs();
  assert.deepEqual(known.map((o) => [o.host, o.auth]), [
    ["acme.my.salesforce.com", "cookie"], ["corp.my.salesforce.com", "oauth"], ["other.my.salesforce.com", "oauth"],
  ]);
  assert.ok(!JSON.stringify(known).includes("!"), "no session ids in the org list");
});

// ---------------- user overview ----------------

test("user overview: system permissions, object access and groups with their sources", async () => {
  const USER = "005000000000001AAA", PROFILE = "0PS000000000001AAA", PS = "0PS000000000002AAA";
  const tables = {
    User: [{ Id: USER, Name: "Ana", Username: "ana@x", IsActive: true, UserType: "Standard", UserRoleId: null, Profile: { Name: "Sales" } }],
    PermissionSetAssignment: [
      { PermissionSetId: PROFILE, PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "Sales" } } },
      { PermissionSetId: PS, PermissionSet: { IsOwnedByProfile: false, Label: "Data Export" } },
    ],
    PermissionSet: [
      { Id: PROFILE, PermissionsApiEnabled: true, PermissionsExportReport: false, PermissionsEditTask: true },
      { Id: PS, PermissionsApiEnabled: false, PermissionsExportReport: true, PermissionsEditTask: false },
    ],
    ObjectPermissions: [
      { ParentId: PROFILE, SobjectType: "Account", PermissionsRead: true, PermissionsEdit: true },
      { ParentId: PS, SobjectType: "Account", PermissionsRead: true, PermissionsModifyAllRecords: true },
      { ParentId: PS, SobjectType: "Case", PermissionsRead: true },
    ],
    GroupMember: (q) => (q.includes(USER) ? [{ GroupId: "00G000000000001AAA" }, { GroupId: "00G000000000002AAA" }] : []),
    Group: [{ Id: "00G000000000001AAA", Name: "Support Queue", Type: "Queue" }, { Id: "00G000000000002AAA", Name: "West", Type: "Regular" }],
  };
  const client = {
    query: async (q) => { const t = tables[q.match(/FROM (\w+)/)[1]]; return typeof t === "function" ? t(q) : t; },
    describe: async () => ({ fields: [
      { name: "PermissionsApiEnabled", label: "API Enabled", type: "boolean" },
      { name: "PermissionsExportReport", label: "Export Reports", type: "boolean" },
      { name: "PermissionsEditTask", label: "Edit Tasks", type: "boolean" },
      { name: "Label", label: "Label", type: "string" },
    ] }),
  };
  const o = await userOverview(client, { userId: USER });
  assert.deepEqual(o.systemPerms.map((p) => [p.label, p.sensitive, p.by]), [
    ["API Enabled", true, ["Sales"]], ["Export Reports", true, ["Data Export"]], ["Edit Tasks", false, ["Sales"]],
  ]);
  const account = o.objects.find((x) => x.sobject === "Account");
  assert.deepEqual([account.read, account.edit, account.modifyAll, account.delete], [true, true, true, false]);
  assert.deepEqual(account.by, ["Sales", "Data Export"]);
  assert.deepEqual(o.groups, [{ name: "West", type: "Public group" }, { name: "Support Queue", type: "Queue" }]);
  await assert.rejects(userOverview(client, { userId: "x' OR '1'='1" }), /Invalid user/);
});
