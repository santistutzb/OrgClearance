import test from "node:test";
import assert from "node:assert/strict";
import { explainAccess, compareUsers, fieldMatrix, escapeSoql, searchUsers, shareInfo } from "../src/access.js";

const ANA = "005000000000001AAA", BOB = "005000000000002AAA", OWNER = "005000000000009AAA";
const REC = "001000000000001AAA";
const PROFILE_PS = "0PS000000000001AAA", PS = "0PS000000000002AAA", GROUP_PS = "0PS000000000003AAA";
const COMP_PS = "0PS000000000004AAA", BOB_PROFILE_PS = "0PS000000000005AAA";
const PSG = "0PG000000000001AAA";
const ROLE_CEO = "00E000000000001AAA", ROLE_REP = "00E000000000002AAA";
const PUBLIC_GROUP = "00G000000000001AAA", ROLE_GROUP_CEO = "00G000000000002AAA";

const user = (id, name, roleId, profile) =>
  ({ Id: id, Name: name, Username: `${name}@x.com`, IsActive: true, UserType: "Standard", UserRoleId: roleId, UserRole: { Name: roleId === ROLE_CEO ? "CEO" : "Rep" }, Profile: { Name: profile } });

// Fake Salesforce: each table is an array or a function(soql) -> rows. An Error makes the query fail.
function mockClient(over = {}) {
  const t = {
    User: (q) => [user(ANA, "Ana", ROLE_REP, "Sales"), user(BOB, "Bob", ROLE_REP, "Support"), user(OWNER, "Olga", ROLE_REP, "Sales")]
      .filter((u) => q.includes(`'${u.Id}'`)),
    PermissionSetAssignment: (q) => q.includes(BOB) ? [
      { PermissionSetId: BOB_PROFILE_PS, PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "Support" } } },
    ] : [
      { PermissionSetId: PROFILE_PS, PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "Sales" } } },
      { PermissionSetId: PS, PermissionSet: { IsOwnedByProfile: false, Label: "Extra" } },
      { PermissionSetId: GROUP_PS, PermissionSetGroupId: PSG, PermissionSet: { IsOwnedByProfile: false }, PermissionSetGroup: { MasterLabel: "Group A", Status: "Updated" } },
    ],
    PermissionSetGroupComponent: [
      { PermissionSetGroupId: PSG, PermissionSetId: COMP_PS, PermissionSet: { Label: "Industry Access" } },
      { PermissionSetGroupId: PSG, PermissionSetId: "0QM000000000001AAA", PermissionSet: null },
    ],
    ObjectPermissions: [
      { ParentId: PROFILE_PS, PermissionsRead: true, PermissionsEdit: true },
      { ParentId: BOB_PROFILE_PS, PermissionsRead: true },
    ],
    FieldPermissions: [
      { ParentId: GROUP_PS, Field: "Account.Industry", PermissionsRead: true },
      { ParentId: COMP_PS, Field: "Account.Industry", PermissionsRead: true },
    ],
    UserRecordAccess: [{ RecordId: REC, HasReadAccess: true, HasEditAccess: false, MaxAccessLevel: "Read" }],
    PermissionSet: [],
    EntityDefinition: [{ InternalSharingModel: "Private", ExternalSharingModel: "Private" }],
    Account: [{ OwnerId: OWNER }],
    UserRole: [{ Id: ROLE_CEO, ParentRoleId: null }, { Id: ROLE_REP, ParentRoleId: ROLE_CEO }],
    Group: (q) => q.includes("RelatedId")
      ? [{ Id: ROLE_GROUP_CEO, Type: "RoleAndSubordinates", RelatedId: ROLE_CEO }]
      : [{ Id: PUBLIC_GROUP, Name: "West Sales", Type: "Regular" }],
    GroupMember: (q) => q.includes(ANA) ? [{ GroupId: PUBLIC_GROUP }] : [],
    AccountShare: [
      { UserOrGroupId: OWNER, AccountAccessLevel: "All", RowCause: "Owner" },
      { UserOrGroupId: PUBLIC_GROUP, AccountAccessLevel: "Read", RowCause: "Rule" },
    ],
    ...over,
  };
  return {
    queries: [],
    async query(soql) {
      this.queries.push(soql);
      const name = soql.match(/FROM (\w+)/)[1];
      const v = t[name];
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error(`no mock for ${name}`);
      return typeof v === "function" ? v(soql) : v;
    },
    async describe() {
      return { fields: [
        { name: "Industry", label: "Industry", permissionable: true },
        { name: "Rating", label: "Rating", permissionable: true },
        { name: "Name", label: "Account Name", permissionable: false },
      ] };
    },
  };
}
const params = { userId: ANA, sobject: "Account", recordId: REC, field: "Industry" };

test("yes: object via profile, field via group component, record via sharing rule", async () => {
  const r = await explainAccess(mockClient(), params);
  assert.equal(r.verdict.status, "yes");
  assert.deepEqual(r.object.readBy, [{ kind: "profile", label: "Sales" }]);
  assert.deepEqual(r.fieldAccess.readBy, [{ kind: "group", label: "Group A", via: ["Industry Access"] }]);
  assert.ok(r.record.reasons.some((x) => x.type === "share" && /Sharing rule/.test(x.text) && /West Sales/.test(x.text)));
  assert.equal(r.record.owd.label, "Private");
});

test("muting: a component grants the field but the group's aggregate doesn't", async () => {
  const r = await explainAccess(mockClient({ FieldPermissions: [{ ParentId: COMP_PS, Field: "Account.Industry", PermissionsRead: true }] }), params);
  assert.equal(r.verdict.status, "no");
  assert.ok(r.verdict.reasons.some((x) => /mutes it/.test(x)));
});

test("expired assignment is ignored", async () => {
  const c = mockClient({
    PermissionSetAssignment: [
      { PermissionSetId: PROFILE_PS, PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "Sales" } } },
      { PermissionSetId: GROUP_PS, PermissionSetGroupId: PSG, PermissionSet: { IsOwnedByProfile: false }, PermissionSetGroup: { MasterLabel: "Group A", Status: "Updated" }, ExpirationDate: "2020-01-01T00:00:00.000+0000" },
    ],
  });
  const r = await explainAccess(c, params);
  assert.equal(r.verdict.status, "no");
  assert.deepEqual(r.expired.map((s) => s.label), ["Group A"]);
  assert.ok(r.verdict.reasons.some((x) => /Expired/.test(x)));
});

test("record: owner", async () => {
  const r = await explainAccess(mockClient({ Account: [{ OwnerId: ANA }], AccountShare: [{ UserOrGroupId: ANA, AccountAccessLevel: "All", RowCause: "Owner" }] }), params);
  assert.deepEqual(r.record.reasons.map((x) => x.type), ["owner"]);
});

test("record: role above the owner", async () => {
  const c = mockClient({
    User: (q) => [user(ANA, "Ana", ROLE_CEO, "Sales"), user(OWNER, "Olga", ROLE_REP, "Sales")].filter((u) => q.includes(`'${u.Id}'`)),
    AccountShare: [],
  });
  const r = await explainAccess(c, params);
  assert.ok(r.record.reasons.some((x) => x.type === "hierarchy"));
});

test("record: public org-wide default", async () => {
  const r = await explainAccess(mockClient({ EntityDefinition: [{ InternalSharingModel: "Read" }], AccountShare: [] }), params);
  assert.ok(r.record.reasons.some((x) => x.type === "owd" && /Public Read Only/.test(x.text)));
});

test("record: access granted but untraced is flagged, not invented", async () => {
  const r = await explainAccess(mockClient({ AccountShare: [], GroupMember: [] }), params);
  assert.equal(r.record.reasons.length, 0);
  assert.ok(r.record.notes.some((n) => /Not traced/.test(n)));
});

test("record: share table failure becomes a note, verdict still from UserRecordAccess", async () => {
  const r = await explainAccess(mockClient({ AccountShare: new Error("No such column") }), params);
  assert.equal(r.record.status, "yes");
  assert.ok(r.record.notes.some((n) => /AccountShare/.test(n)));
});

test("can't tell: a query fails and nothing says no", async () => {
  const r = await explainAccess(mockClient({ FieldPermissions: new Error("no access") }), params);
  assert.equal(r.verdict.status, "unknown");
});

test("a proven no beats missing data", async () => {
  const r = await explainAccess(mockClient({ ObjectPermissions: [], FieldPermissions: new Error("x") }), params);
  assert.equal(r.verdict.status, "no");
});

test("non-permissionable field: FLS doesn't apply", async () => {
  const r = await explainAccess(mockClient(), { ...params, field: "Name" });
  assert.equal(r.fieldAccess.status, "na");
  assert.equal(r.verdict.status, "yes");
});

test("compare: explains which source makes the difference", async () => {
  const c = await compareUsers(mockClient(), { userIdA: ANA, userIdB: BOB, sobject: "Account", field: "Industry" });
  const field = c.differences.find((d) => d.check === "Field");
  assert.equal(field.a, "yes");
  assert.equal(field.b, "no");
  assert.match(field.explanation, /Ana gets it from Group A, which Bob doesn't have/);
  assert.deepEqual(c.onlyB, [{ kind: "profile", label: "Support" }]);
});

test("field matrix: access level and source per field", async () => {
  const m = await fieldMatrix(mockClient(), { userId: ANA, sobject: "Account" });
  const by = Object.fromEntries(m.fields.map((f) => [f.name, f]));
  assert.equal(by.Industry.access, "read");
  assert.deepEqual(by.Industry.readBy, ["Group A"]);
  assert.equal(by.Rating.access, "none");
  assert.equal(by.Name.access, "always");
});

test("share table naming", () => {
  assert.deepEqual(shareInfo("Account"), { table: "AccountShare", parent: "AccountId", level: "AccountAccessLevel" });
  assert.deepEqual(shareInfo("Invoice__c"), { table: "Invoice__Share", parent: "ParentId", level: "AccessLevel" });
});

test("rejects SOQL injection", async () => {
  await assert.rejects(explainAccess(mockClient(), { ...params, sobject: "Account' OR '1'='1" }));
  await assert.rejects(explainAccess(mockClient(), { ...params, userId: "x' OR Id != '" }));
  assert.equal(escapeSoql("O'Brien"), "O\\'Brien");
  const c = mockClient(); await searchUsers(c, "O'Br%");
  assert.ok(c.queries[0].includes("O\\'Br\\%"));
});
