// Regression tests for the security review: where credentials can go, what exported files can contain.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { isSalesforceHost } from "../src/hosts.js";
import { createClient } from "../src/api.js";
import { mmd, toHtml, MERMAID } from "../src/docs.js";

test("hosts: only Salesforce domains are accepted", () => {
  for (const ok of ["acme.my.salesforce.com", "acme--uat.sandbox.my.salesforce.com", "acme.lightning.force.com", "acme.my.salesforce-setup.com", "na1.salesforce.com"]) {
    assert.ok(isSalesforceHost(ok), ok);
  }
  for (const bad of ["evil.com", "salesforce.com.evil.io", "my.salesforce.com.attacker.net", "acme.my.salesforce.com.", "acme..salesforce.com",
    "-acme.salesforce.com", "acme.salesforce.com/evil", "acme.salesforce.com:443", "", null, 42, "a".repeat(250) + ".salesforce.com"]) {
    assert.ok(!isSalesforceHost(bad), String(bad));
  }
});

test("api: the client refuses to send a session id to any other host", () => {
  const fetchImpl = () => { throw new Error("must not fetch"); };
  assert.throws(() => createClient({ host: "evil.example.com", sid: "00D!secret" }, { fetchImpl }), /not a Salesforce domain/);
  assert.throws(() => createClient({ host: "acme.salesforce.com.evil.io", sid: "00D!secret" }, { fetchImpl }), /not a Salesforce domain/);
  assert.doesNotThrow(() => createClient({ host: "acme.my.salesforce.com", sid: "x" }, { fetchImpl }));
});

test("oauth: an instance URL outside Salesforce aborts the login and stores nothing", async () => {
  const session = {};
  const area = (store) => ({ get: async (k) => (k in store ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } });
  globalThis.chrome = {
    storage: { local: area({ orgConfigs: { "acme.my.salesforce.com": { mode: "oauth", clientId: "3MVG9clientid" } } }), session: area(session) },
    identity: {
      getRedirectURL: (p) => `https://ext.chromiumapp.org/${p}`,
      launchWebAuthFlow: async ({ url }) => `https://ext.chromiumapp.org/oauth2?code=C&state=${new URL(url).searchParams.get("state")}`,
    },
  };
  const { getOAuthSession } = await import("../src/auth.js");
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: "00D!TOKEN", instance_url: "https://evil.example.com" }) });
  await assert.rejects(getOAuthSession("acme.my.salesforce.com", { fetchImpl }), /unexpected instance URL/);
  assert.deepEqual(session, {}, "no token stored");
});

test("session: a non-Salesforce page never gets a session", async () => {
  globalThis.chrome = { cookies: { get: async () => ({ value: "00D!x" }), getAll: async () => [] } };
  const { getSession } = await import("../src/session.js");
  await assert.rejects(getSession("evil.example.com"), /Not a Salesforce page/);
});

test("csv: values that start like a formula are neutralized", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8"));
  const { toCsv } = dom.window.OrgClearanceUI;
  const csv = toCsv(["Name", "Note"], [["=HYPERLINK(\"http://x\",\"click\")", "+1"], ["@SUM(A1)", "-2"], ["Ana, Ruiz", "ok"]]);
  assert.equal(csv, [
    "Name,Note",
    "\"'=HYPERLINK(\"\"http://x\"\",\"\"click\"\")\",'+1",
    "'@SUM(A1),'-2",
    "\"Ana, Ruiz\",ok",
  ].join("\r\n"));
});

test("exported docs: diagram labels can't carry markup or entity codes", () => {
  assert.equal(mmd('Flow "A" <img src=x onerror=alert(1)> #60;script#62; `x` [y]{z}'), "Flow A img src x onerror alert(1) 60 script 62 x y z");
  assert.equal(mmd("Facturación: Año 2026 (v2) - IVA/Neto"), "Facturación: Año 2026 (v2) - IVA/Neto");
});

test("exported docs: Mermaid is pinned with SRI, runs in antiscript mode, no floating version", () => {
  const doc = { sobject: "Account", label: "Account", custom: false, keyPrefix: "001", generatedAt: "2026-11-18T00:00:00Z", url: null,
    fields: [], recordTypes: [], triggers: [], flows: [], validationRules: [], workflowRules: [], notes: [] };
  const html = toHtml(doc);
  assert.match(MERMAID.src, /mermaid@\d+\.\d+\.\d+\/dist\/mermaid\.min\.js$/);
  assert.match(MERMAID.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.ok(html.includes(`src="${MERMAID.src}" integrity="${MERMAID.integrity}" crossorigin="anonymous"`));
  assert.ok(html.includes('securityLevel:"antiscript"'));
  assert.ok(!/securityLevel:"loose"|mermaid@11\/|import\(/.test(html));
});

test("manifest: explicit CSP, network limited to Salesforce, no remote code", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src https:\/\/\*\.salesforce\.com https:\/\/\*\.force\.com https:\/\/\*\.salesforce-setup\.com;/);
  assert.deepEqual(m.permissions.sort(), ["cookies", "identity", "storage"]);
  assert.ok(!m.externally_connectable, "no web page can message the extension");
  assert.deepEqual(m.web_accessible_resources.map((w) => w.resources).flat(), ["fonts/*.woff2"]);
});
