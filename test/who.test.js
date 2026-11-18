import test from "node:test";
import assert from "node:assert/strict";
import { whoCanSee } from "../src/who.js";

const PROF_SALES = "0PS0000000000S1AAA", PROF_SUPPORT = "0PS0000000000S2AAA", PS_REVENUE = "0PS0000000000R1AAA", PS_ADMIN = "0PS0000000000A1AAA", GROUP_AGG = "0PS0000000000G1AAA";
const REC = "001000000000001AAA";

const assign = (userId, name, psId, src, extra = {}) => ({
  AssigneeId: userId, Assignee: { Name: name, Username: `${name.toLowerCase().replace(/ /g, ".")}@acme.com`, UserType: "Standard", Profile: { Name: extra.profile ?? "Sales User" } },
  PermissionSetId: psId, ...src, ExpirationDate: extra.expires ?? null,
});
const profile = (name) => ({ PermissionSet: { IsOwnedByProfile: true, Profile: { Name: name } } });
const permset = (label) => ({ PermissionSet: { IsOwnedByProfile: false, Label: label } });
const group = (label) => ({ PermissionSet: { IsOwnedByProfile: false }, PermissionSetGroup: { MasterLabel: label } });

function org(over = {}) {
  const t = {
    ObjectPermissions: [{ ParentId: PROF_SALES }, { ParentId: PROF_SUPPORT }],
    PermissionSet: [{ Id: PS_ADMIN }], // View All Data
    FieldPermissions: [{ ParentId: PS_REVENUE }, { ParentId: GROUP_AGG }],
    PermissionSetAssignment: [
      assign("005A", "Ana Ruiz", PROF_SALES, profile("Sales User")),
      assign("005A", "Ana Ruiz", PS_REVENUE, permset("Revenue Fields")),
      assign("005B", "Bruno Perez", PROF_SALES, profile("Sales User")),
      assign("005C", "Carla Owens", PROF_SUPPORT, profile("Support"), { profile: "Support" }),
      assign("005C", "Carla Owens", GROUP_AGG, group("Finance Bundle"), { profile: "Support" }),
      assign("005D", "Dario Admin", PS_ADMIN, permset("Admin Tools"), { profile: "Minimum Access" }),
      assign("005D", "Dario Admin", PS_REVENUE, permset("Revenue Fields"), { profile: "Minimum Access" }),
      assign("005E", "Eva Temp", PROF_SALES, profile("Sales User")),
      assign("005E", "Eva Temp", PS_REVENUE, permset("Revenue Fields"), { expires: "2020-01-01T00:00:00.000+0000" }),
    ],
    UserRecordAccess: (q) => [{ RecordId: REC, HasReadAccess: !q.includes("005C"), MaxAccessLevel: q.includes("005C") ? "None" : "Read" }],
    ...over,
  };
  const c = {
    queries: [],
    async query(q) { this.queries.push(q); const v = t[q.match(/FROM (\w+)/)[1]]; if (v instanceof Error) throw v; return typeof v === "function" ? v(q) : v ?? []; },
    describe: async () => ({ fields: [{ name: "AnnualRevenue", permissionable: true }, { name: "Name", permissionable: false }] }),
  };
  return c;
}

test("object: everyone who can read it, including View All Data, with where it comes from", async () => {
  const r = await whoCanSee(org(), { sobject: "Account" });
  assert.deepEqual(r.users.map((u) => u.name), ["Ana Ruiz", "Bruno Perez", "Carla Owens", "Dario Admin", "Eva Temp"]);
  assert.deepEqual(r.users.find((u) => u.name === "Dario Admin").objectVia, ["Permission set: Admin Tools (View All Data)"]);
  assert.deepEqual(r.users.find((u) => u.name === "Carla Owens").objectVia, ["Profile: Support"]);
});

test("field: needs object read and field read; expired assignments don't count; groups count", async () => {
  const r = await whoCanSee(org(), { sobject: "Account", field: "AnnualRevenue" });
  assert.deepEqual(r.users.map((u) => [u.name, u.fieldVia]), [
    ["Ana Ruiz", ["Permission set: Revenue Fields"]],
    ["Carla Owens", ["Group: Finance Bundle"]],
    ["Dario Admin", ["Permission set: Revenue Fields"]],
  ]);
  assert.equal(r.total, 3);
  assert.ok(!r.users.some((u) => u.name === "Eva Temp"), "expired assignment ignored");
});

test("field without field-level security: same as the object, with a note", async () => {
  const r = await whoCanSee(org(), { sobject: "Account", field: "Name" });
  assert.equal(r.total, 5);
  assert.ok(r.notes.some((n) => /isn't controlled by field-level security/.test(n)));
});

test("record: checks each person and drops those without access", async () => {
  const c = org();
  const r = await whoCanSee(c, { sobject: "Account", field: "AnnualRevenue", recordId: REC, checkRecord: true });
  assert.deepEqual(r.users.map((u) => [u.name, u.recordAccess]), [["Ana Ruiz", "Read"], ["Dario Admin", "Read"]]);
  assert.deepEqual(r.record, { status: "checked", checked: 3, withAccess: 2, failed: 0 });
  assert.equal(c.queries.filter((q) => q.includes("UserRecordAccess")).length, 3, "one query per person");
});

test("record: above the cap, nothing is checked and it says so", async () => {
  const c = org();
  const r = await whoCanSee(c, { sobject: "Account", recordId: REC, checkRecord: true, limit: 2 });
  assert.equal(r.record.status, "too-many");
  assert.equal(r.total, 5);
  assert.ok(r.notes.some((n) => /capped at 2/.test(n)));
  assert.ok(!c.queries.some((q) => q.includes("UserRecordAccess")));
});

test("record: a failed check keeps the person listed and is reported", async () => {
  const r = await whoCanSee(org({ UserRecordAccess: (q) => { if (q.includes("005A")) throw new Error("boom"); return [{ HasReadAccess: true, MaxAccessLevel: "Edit" }]; } }),
    { sobject: "Account", field: "AnnualRevenue", recordId: REC, checkRecord: true });
  assert.equal(r.users.find((u) => u.name === "Ana Ruiz").recordAccess, null);
  assert.equal(r.record.failed, 1);
  assert.ok(r.notes.some((n) => /couldn't be verified for 1 person/.test(n)));
});

test("inputs are validated before any query", async () => {
  const c = org();
  await assert.rejects(whoCanSee(c, { sobject: "Account'--" }), /Invalid object/);
  await assert.rejects(whoCanSee(c, { sobject: "Account", field: "x y" }), /Invalid field/);
  await assert.rejects(whoCanSee(c, { sobject: "Account", field: "Nope" }), /doesn't exist/);
  assert.equal(c.queries.length, 0);
});
