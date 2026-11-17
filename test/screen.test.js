import test from "node:test";
import assert from "node:assert/strict";
import { screenCheck, layoutFields, pageFields } from "../src/screen.js";
import { explainAccess } from "../src/access.js";
import { formatTicket } from "../src/ticket.js";

const USER = { id: "005000000000001AAA", name: "Ana", profileId: "00e000000000001AAA" };
const REC = "001000000000001AAA";
const RT_EXPORT = "012000000000009AAA";
const LAYOUT_STD = "00h000000000001AAA", LAYOUT_EXPORT = "00h000000000002AAA";
const BASE = "https://acme.lightning.force.com";

const layout = (...items) => ({ layoutSections: [{ layoutColumns: [{ layoutItems: items.map(([field, behavior]) => ({ field, behavior })) }, { layoutItems: [{ emptySpace: true }] }] }] });
const dynamicPage = (fields, { rule = false, detail = false } = {}) => ({ flexiPageRegions: [{ itemInstances: [
  ...fields.map((f) => ({ fieldInstance: { fieldItem: `Record.${f}`, fieldInstanceProperties: [{ name: "uiBehavior", value: "none" }], ...(rule ? { visibilityRule: { criteria: [{ leftValue: "{!Record.Type}", operator: "EQUAL", rightValue: "Partner" }] } } : {}) } })),
  ...(detail ? [{ componentInstance: { componentName: "force:detailPanel" } }] : []),
] }] });

function fake({ recordTypes = false, recordTypeId = null, assignments, layouts, pages = [], pageMeta = {}, describeFields } = {}) {
  const t = {
    EntityDefinition: [{ DurableId: "Account" }],
    Account: [{ RecordTypeId: recordTypeId, RecordType: recordTypeId ? { Name: "Export" } : null }],
    ProfileLayout: assignments ?? [{ LayoutId: LAYOUT_STD, Layout: { Name: "Account Layout" }, RecordTypeId: "012000000000000AAA" }],
    FlexiPage: (q) => (q.includes("Metadata") ? [{ Metadata: pageMeta[q.match(/Id = '(\w+)'/)[1]] }] : pages),
    Layout: (q) => [{ Metadata: (layouts ?? { [LAYOUT_STD]: layout(["Name", "Required"], ["AnnualRevenue", "Edit"]) })[q.match(/Id = '(\w+)'/)[1]] }],
  };
  const run = async (q) => {
    const v = t[q.match(/FROM (\w+)/)[1]];
    if (v instanceof Error) throw v;
    return typeof v === "function" ? v(q) : v ?? [];
  };
  return {
    host: "acme.my.salesforce.com", query: run, toolingQuery: run,
    describe: async () => ({
      recordTypeInfos: recordTypes ? [{ master: true }, { master: false, recordTypeId: RT_EXPORT }] : [{ master: true }],
      fields: describeFields ?? [{ name: "AnnualRevenue" }, { name: "BillingCity", compoundFieldName: "BillingAddress" }, { name: "Name" }],
    }),
  };
}
const check = (c, field = "AnnualRevenue") => screenCheck(c, { user: USER, sobject: "Account", recordId: REC, field });

test("parsers: layout items and Dynamic Forms field instances", () => {
  const lf = layoutFields(layout(["Name", "Required"], ["Rating", "Readonly"]));
  assert.deepEqual([...lf.entries()], [["name", "Required"], ["rating", "Readonly"]]);
  const pf = pageFields(dynamicPage(["Industry"], { rule: true, detail: true }));
  assert.equal(pf.usesDynamicForms, true);
  assert.equal(pf.usesLayout, true);
  assert.deepEqual(pf.fields.get("industry"), { behavior: "none", conditional: true });
});

test("on the layout their profile gets: yes, with a link to the layout", async () => {
  const r = await check(fake());
  assert.equal(r.status, "yes");
  assert.equal(r.layout.name, "Account Layout");
  assert.equal(r.layout.url, `${BASE}/lightning/setup/ObjectManager/Account/PageLayouts/${LAYOUT_STD}/view`);
  assert.equal(r.behavior, "Edit");
});

test("record type picks the layout: the Export layout doesn't have the field", async () => {
  const r = await check(fake({
    recordTypes: true, recordTypeId: RT_EXPORT,
    assignments: [
      { LayoutId: LAYOUT_STD, Layout: { Name: "Account Layout" }, RecordTypeId: "012000000000000AAA" },
      { LayoutId: LAYOUT_EXPORT, Layout: { Name: "Export Layout" }, RecordTypeId: RT_EXPORT }],
    layouts: { [LAYOUT_STD]: layout(["AnnualRevenue", "Edit"]), [LAYOUT_EXPORT]: layout(["Name", "Required"]) },
  }));
  assert.equal(r.status, "no");
  assert.deepEqual([r.layout.name, r.recordType.name], ["Export Layout", "Export"]);
});

test("parts of an address count when the compound field is on the layout", async () => {
  const r = await check(fake({ layouts: { [LAYOUT_STD]: layout(["BillingAddress", "Edit"]) } }), "BillingCity");
  assert.equal(r.status, "yes");
});

test("Dynamic Forms page with a visibility rule: can't tell, and says why", async () => {
  const r = await check(fake({ pages: [{ Id: "0M0000000000001AAA", MasterLabel: "Account Record Page" }], pageMeta: { "0M0000000000001AAA": dynamicPage(["AnnualRevenue"], { rule: true }) } }));
  assert.equal(r.status, "unknown");
  assert.equal(r.pages[0].conditional, true);
  assert.equal(r.pages[0].url, `${BASE}/visualEditor/appBuilder.app?id=0M0000000000001AAA`);
  assert.ok(r.notes.some((n) => /visibility rule/.test(n)));
});

test("Dynamic Forms page without the field while the layout has it: can't tell", async () => {
  const r = await check(fake({ pages: [{ Id: "0M0000000000001AAA", MasterLabel: "Sales Page" }], pageMeta: { "0M0000000000001AAA": dynamicPage(["Name"]) } }));
  assert.equal(r.status, "unknown");
  assert.ok(r.notes.some((n) => /Dynamic Forms/.test(n)));
});

test("pages that only show the layout don't change the answer", async () => {
  const r = await check(fake({ pages: [{ Id: "0M0000000000001AAA", MasterLabel: "Classic Page" }], pageMeta: { "0M0000000000001AAA": dynamicPage([], { detail: true }) } }));
  assert.equal(r.status, "yes");
  assert.equal(r.pages[0].usesLayout, true);
});

test("read-only on the layout is flagged; failures are 'unknown', never a guess", async () => {
  const ro = await check(fake({ layouts: { [LAYOUT_STD]: layout(["AnnualRevenue", "Readonly"]) } }));
  assert.ok(ro.notes.some((n) => /read-only/.test(n)));
  const c = fake(); c.toolingQuery = async () => { throw new Error("INVALID_TYPE: sObject type 'ProfileLayout' is not supported"); };
  const r = await check(c);
  assert.equal(r.status, "unknown");
  assert.match(r.error, /ProfileLayout/);
  assert.equal((await screenCheck(c, { user: { ...USER, profileId: null }, sobject: "Account", field: "Name" })).status, "unknown");
  await assert.rejects(screenCheck(c, { user: USER, sobject: "Account'--", field: "Name" }), /Invalid/);
});

// ---------- end to end through Explain ----------

function orgWith(layoutItems) {
  const PROFILE = "0PS000000000001AAA";
  const t = {
    User: [{ Id: USER.id, Name: "Ana", Username: "ana@x", IsActive: true, UserType: "Standard", UserRoleId: null, ProfileId: USER.profileId, Profile: { Name: "Sales" } }],
    PermissionSetAssignment: [{ PermissionSetId: PROFILE, PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "Sales" } } }],
    ObjectPermissions: [{ ParentId: PROFILE, PermissionsRead: true }],
    FieldPermissions: (q) => (q.includes("ParentId IN") && q.includes("AnnualRevenue") ? [{ ParentId: PROFILE, PermissionsRead: true }] : []),
    UserRecordAccess: [{ RecordId: REC, HasReadAccess: true, MaxAccessLevel: "Read" }],
    EntityDefinition: [{ DurableId: "Account", InternalSharingModel: "Read" }],
    Account: [{ OwnerId: "005000000000009AAA" }],
    AccountShare: [], GroupMember: [], PermissionSet: [],
    ProfileLayout: [{ LayoutId: LAYOUT_STD, Layout: { Name: "Account Layout" }, RecordTypeId: null }],
    Layout: [{ Metadata: layout(...layoutItems) }],
    FlexiPage: [],
  };
  const run = async (q) => { const v = t[q.match(/FROM (\w+)/)[1]]; return typeof v === "function" ? v(q) : v ?? []; };
  return { host: "acme.my.salesforce.com", query: run, toolingQuery: run,
    describe: async () => ({ recordTypeInfos: [{ master: true }], fields: [{ name: "AnnualRevenue", permissionable: true }, { name: "Name", permissionable: false }] }) };
}

test("explain: has access but the field isn't on their layout -> can't see it, with the fix", async () => {
  const r = await explainAccess(orgWith([["Name", "Required"]]), { userId: USER.id, sobject: "Account", recordId: REC, field: "AnnualRevenue" });
  assert.equal(r.fieldAccess.status, "yes");
  assert.equal(r.screen.status, "no");
  assert.equal(r.verdict.status, "no");
  assert.match(r.verdict.reasons[0], /They have access to AnnualRevenue, but it isn't on their page layout \(Account Layout\)/);
  assert.equal(r.suggestions[0].problem, "screen");
  assert.equal(r.suggestions[0].title, "Add AnnualRevenue to the Account Layout page layout");
  assert.match(formatTicket(r), /- On their page: No \(layout: Account Layout\)/);
});

test("explain: on the layout -> yes, and no screen check without a field", async () => {
  const yes = await explainAccess(orgWith([["AnnualRevenue", "Edit"]]), { userId: USER.id, sobject: "Account", recordId: REC, field: "AnnualRevenue" });
  assert.equal(yes.verdict.status, "yes");
  assert.equal(yes.screen.status, "yes");
  const noField = await explainAccess(orgWith([]), { userId: USER.id, sobject: "Account", recordId: REC });
  assert.equal(noField.screen.status, "skipped");
});
