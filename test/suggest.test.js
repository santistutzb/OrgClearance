import test from "node:test";
import assert from "node:assert/strict";
import { suggestFixes, setupUrl, lightningBase } from "../src/suggest.js";
import { formatTicket } from "../src/ticket.js";

const HOST = "acme.my.salesforce.com";
const USER = { id: "005000000000001AAA", name: "Ana Ruiz", username: "ana@acme.com", isActive: true, roleId: "00E000000000001AAA" };
const OWN_PS = { id: "0PS000000000002AAA", kind: "permset", label: "Lightning Console" };
const PROFILE = { id: "0PS000000000001AAA", kind: "profile", label: "Sales User" };
const REVENUE = "0PS000000000009AAA";

function client(tables) {
  return {
    host: HOST,
    queries: [],
    async query(q) {
      this.queries.push(q);
      const t = tables[q.match(/FROM (\w+)/)[1]];
      if (t instanceof Error) throw t;
      return typeof t === "function" ? t(q) : (t ?? []);
    },
  };
}
const fieldRow = (id, label, extra = {}) => ({ ParentId: id, Parent: { Label: label, Name: label.replace(/ /g, "_"), IsOwnedByProfile: false, ...extra } });
const base = (over = {}) => ({
  user: USER, sobject: "Account", recordId: "001000000000001AAA", field: "AnnualRevenue",
  object: { status: "yes" }, fieldAccess: { status: "no", readBy: [], muted: [] }, record: { status: "yes" },
  ...over,
});
const src = (over = {}) => ({ active: [PROFILE, OWN_PS], expired: [], components: [], ...over });

test("missing field: assign a permission set that already grants it, or add it to one they have", async () => {
  const c = client({
    FieldPermissions: [fieldRow(REVENUE, "Revenue Fields"), fieldRow("0PS000000000008AAA", "Profile thing", { IsOwnedByProfile: true }), fieldRow("0PS000000000007AAA", "Group agg", { PermissionSetGroupId: "0PG1" })],
    PermissionSetAssignment: [{ PermissionSetId: REVENUE, n: 5 }],
  });
  const { suggestions } = await suggestFixes(c, { result: base(), src: src() });
  assert.deepEqual(suggestions.map((s) => [s.kind, s.title]), [
    ["assign", "Assign the Revenue Fields permission set"],
    ["edit", "Or give read on AnnualRevenue in Lightning Console"],
  ]);
  assert.match(suggestions[0].detail, /Used by 5 active users/);
  assert.equal(suggestions[0].url, "https://acme.lightning.force.com/lightning/setup/PermSets/page?address=%2F0PS000000000009AAA");
  assert.ok(c.queries.some((q) => q.includes("Field = 'Account.AnnualRevenue'")));
});

test("muted in a group: say so first, and don't suggest assigning the muted component again", async () => {
  const GROUP = { id: "0PS000000000005AAA", kind: "group", label: "Finance Bundle", groupId: "0PG000000000001AAA" };
  const c = client({ FieldPermissions: [fieldRow(REVENUE, "Revenue Fields")] });
  const result = base({ fieldAccess: { status: "no", readBy: [], muted: [{ group: "Finance Bundle", components: ["Revenue Fields"], outdated: false }] } });
  const { suggestions } = await suggestFixes(c, { result, src: src({ active: [PROFILE, OWN_PS, GROUP] }) });
  assert.equal(suggestions[0].kind, "unmute");
  assert.match(suggestions[0].title, /Stop muting AnnualRevenue in Finance Bundle/);
  assert.match(suggestions[0].url, /PermSetGroups\/page\?address=%2F0PG000000000001AAA/);
  assert.ok(!suggestions.some((s) => s.kind === "assign" && /Revenue Fields/.test(s.title)));
});

test("outdated group: suggest recalculating it", async () => {
  const result = base({ fieldAccess: { status: "no", readBy: [], muted: [{ group: "Finance Bundle", components: ["Revenue Fields"], outdated: true }] } });
  const { suggestions } = await suggestFixes(client({}), { result, src: src() });
  assert.match(suggestions[0].title, /Recalculate the Finance Bundle permission set group/);
});

test("expired assignment that would grant it: renewing comes first", async () => {
  const OLD = { id: "0PS000000000004AAA", kind: "permset", label: "Q3 Temp Access", expiresAt: "2026-09-30T00:00:00.000+0000" };
  const c = client({ FieldPermissions: (q) => (q.includes("ParentId IN") ? [{ ParentId: OLD.id }] : []) });
  const { suggestions } = await suggestFixes(c, { result: base(), src: src({ expired: [OLD] }) });
  assert.equal(suggestions[0].kind, "renew");
  assert.equal(suggestions[0].title, "Renew their Q3 Temp Access assignment");
  assert.match(suggestions[0].detail, /expired on 2026-09-30/);
});

test("missing object: object suggestions; no custom permission sets means 'create one'", async () => {
  const c = client({ ObjectPermissions: [fieldRow(REVENUE, "Account Read")], PermissionSetAssignment: [{ PermissionSetId: REVENUE, n: 1 }] });
  const result = base({ object: { status: "no" }, fieldAccess: { status: "skipped" } });
  const { suggestions } = await suggestFixes(c, { result, src: src({ active: [PROFILE] }) });
  assert.deepEqual(suggestions.map((s) => s.title), ["Assign the Account Read permission set", "Or create a permission set with read on Account"]);
  assert.match(suggestions[0].detail, /Used by 1 active user\./);
});

test("record not shared: share it, give a role if they have none, or add a sharing rule", async () => {
  const result = base({ fieldAccess: { status: "skipped" }, record: { status: "no", owd: { model: "Private", label: "Private" } }, user: { ...USER, roleId: null } });
  const { suggestions } = await suggestFixes(client({}), { result, src: src() });
  assert.deepEqual(suggestions.map((s) => s.kind), ["share", "role", "rule"]);
  assert.equal(suggestions[0].url, "https://acme.lightning.force.com/lightning/r/001000000000001AAA/view");
  assert.equal(suggestions[2].url, "https://acme.lightning.force.com/lightning/setup/SecuritySharing/home");
});

test("inactive user: reactivating is suggested; query failures become notes, not errors", async () => {
  const c = client({ FieldPermissions: new Error("INSUFFICIENT_ACCESS") });
  const { suggestions, notes } = await suggestFixes(c, { result: base({ user: { ...USER, isActive: false } }), src: src() });
  assert.equal(suggestions[0].kind, "activate");
  assert.match(suggestions[0].url, /ManageUsers\/page\?address=%2F005000000000001AAA%3Fnoredirect%3D1/);
  assert.ok(notes.some((n) => /INSUFFICIENT_ACCESS/.test(n)));
});

test("links: sandbox and Developer Edition hosts map to their Lightning domain", () => {
  assert.equal(lightningBase("acme--uat.sandbox.my.salesforce.com"), "https://acme--uat.sandbox.lightning.force.com");
  assert.equal(setupUrl("acme-dev-ed.develop.my.salesforce.com", "permset", "0PS1"), "https://acme-dev-ed.develop.lightning.force.com/lightning/setup/PermSets/page?address=%2F0PS1");
  assert.equal(setupUrl("", "permset", "x"), null);
});

test("ticket text: result, reasons, details and suggested fix in plain text", () => {
  const r = base({
    user: { ...USER, name: "Ana Ruiz", username: "ana@acme.com" },
    verdict: { status: "no", reasons: ["No profile or permission set grants read on field AnnualRevenue."] },
    object: { status: "yes", readBy: [{ label: "Sales User" }] },
    fieldAccess: { status: "no", readBy: [] },
    record: { status: "yes", reasons: [{ text: "Org-wide default is Public Read/Write" }] },
    suggestions: [{ title: "Assign the Revenue Fields permission set", detail: "It already gives read on AnnualRevenue." }, { title: "Or give read on AnnualRevenue in Lightning Console", detail: "Shared." }],
  });
  assert.equal(formatTicket(r, { date: new Date("2026-11-17T12:00:00Z") }), [
    "Access check: Ana Ruiz (ana@acme.com) on the AnnualRevenue field on Account 001000000000001AAA",
    "Result: Can't see it",
    "",
    "Why:",
    "- No profile or permission set grants read on field AnnualRevenue.",
    "",
    "Details:",
    "- Object Account: Yes (read from Sales User)",
    "- Field AnnualRevenue: No (field-level security)",
    "- Record: Yes (Org-wide default is Public Read/Write)",
    "",
    "Suggested fix (pick one):",
    "- Assign the Revenue Fields permission set. It already gives read on AnnualRevenue.",
    "- Give read on AnnualRevenue in Lightning Console. Shared.",
    "",
    "Checked with OrgClearance on 2026-11-17.",
  ].join("\n"));
});

test("two problems at once: suggestions are grouped and each group starts without 'Or'", async () => {
  const c = client({ FieldPermissions: [] });
  const result = base({ record: { status: "no", owd: { model: "Private", label: "Private" } } });
  const { suggestions } = await suggestFixes(c, { result, src: src() });
  assert.deepEqual(suggestions.map((s) => s.problem), ["field", "record", "record"]);
  assert.equal(suggestions[0].title, "Give read on AnnualRevenue in Lightning Console");
  const { problemGroups } = await import("../src/ticket.js");
  const r = { ...result, user: USER, verdict: { status: "no", reasons: [] }, suggestions };
  assert.deepEqual(problemGroups(r).map((g) => [g.title, g.items.length]), [["Read on the AnnualRevenue field", 1], ["Access to this record", 2]]);
  const text = formatTicket(r, { date: new Date("2026-11-17T12:00:00Z") });
  assert.match(text, /Suggested fix \(each part needs one of its options\):\nRead on the AnnualRevenue field:\n- Give read on AnnualRevenue in Lightning Console\./);
  assert.match(text, /Access to this record:\n- Share this record with them\./);
});
