import test from "node:test";
import assert from "node:assert/strict";
import { runAudit, duplicateGroups } from "../src/audit.js";
import { collectObjectDoc, toMarkdown, toHtml, toMermaid, fieldType } from "../src/docs.js";
import { snapshot, diffSnapshots, toMarkdownReport, propDiff } from "../src/orgdiff.js";
import { buildTimeline, parseLog, scanLogs, historyInfo } from "../src/timeline.js";

// Fake client: tables keyed by FROM name; values are arrays, functions(soql) or Errors.
function fake(tables, { describe, logs = {}, host = "acme.my.salesforce.com" } = {}) {
  const run = async (soql) => {
    const name = soql.match(/FROM (\w+)/)[1];
    const v = tables[name];
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`sObject type '${name}' is not supported.`);
    return typeof v === "function" ? v(soql) : v;
  };
  return {
    host, query: run, toolingQuery: run,
    describe: async () => { if (describe instanceof Error) throw describe; return describe; },
    logBody: async (id) => { if (!(id in logs)) throw new Error("not found"); return logs[id]; },
  };
}

const DESC = {
  label: "Invoice", labelPlural: "Invoices", custom: true, keyPrefix: "a01",
  recordTypeInfos: [{ master: true, name: "Master" }, { master: false, name: "Export", developerName: "Export", active: true, defaultRecordTypeMapping: false }],
  fields: [
    { name: "Id", label: "Record ID", type: "id", nillable: false, createable: false },
    { name: "Amount__c", label: "Amount", type: "currency", precision: 18, scale: 2, nillable: true, createable: true, custom: true, inlineHelpText: "Total | incl. tax" },
    { name: "Status__c", label: "Status", type: "picklist", nillable: false, createable: true, defaultedOnCreate: false, custom: true,
      picklistValues: [{ value: "Draft", active: true }, { value: "Old", active: false }, { value: "Paid", active: true }] },
    { name: "Account__c", label: "Account", type: "reference", referenceTo: ["Account"], relationshipOrder: 0, nillable: false, createable: true, custom: true },
    { name: "Total__c", label: "Total", type: "double", precision: 18, scale: 0, calculated: true, calculatedFormula: "Amount__c * 2", custom: true, nillable: true },
  ],
};

// ---------------- audit ----------------

test("audit: every section runs; one failing query doesn't break the rest", async () => {
  const PS_PROF = "0PS0000000000P1AAA", PS_UNUSED = "0PS0000000000U1AAA", PS_A = "0PS0000000000A1AAA", PS_B = "0PS0000000000B1AAA", PS_PROF2 = "0PS0000000000P2AAA";
  const c = fake({
    PermissionSet: [
      { Id: PS_PROF, Label: "x", IsOwnedByProfile: true, IsCustom: false, Profile: { Name: "System Administrator", UserLicense: { Name: "Salesforce" } } },
      { Id: PS_PROF2, Label: "y", IsOwnedByProfile: true, IsCustom: true, Profile: { Name: "Old Sales", UserLicense: { Name: "Salesforce" } } },
      { Id: PS_UNUSED, Name: "Legacy_Access", Label: "Legacy Access", IsOwnedByProfile: false, IsCustom: true, CreatedDate: "2021-03-01T00:00:00.000+0000" },
      { Id: PS_A, Name: "A", Label: "Sales Extra", IsOwnedByProfile: false, IsCustom: true },
      { Id: PS_B, Name: "B", Label: "Sales Extra Copy", IsOwnedByProfile: false, IsCustom: true },
    ],
    PermissionSetGroup: [],
    PermissionSetGroupComponent: [],
    PermissionSetAssignment: (q) => {
      if (q.includes("GROUP BY")) return [{ PermissionSetId: PS_PROF, n: 3 }, { PermissionSetId: PS_A, n: 1 }, { PermissionSetId: PS_B, n: 2 }];
      if (q.includes("NEXT_N_DAYS")) throw new Error("No such column 'ExpirationDate'");
      return [
        { AssigneeId: "005A", Assignee: { Name: "Ana", Username: "ana@x", Profile: { Name: "System Administrator" } },
          PermissionSet: { IsOwnedByProfile: true, Profile: { Name: "System Administrator" }, PermissionsModifyAllData: true, PermissionsViewAllData: true } },
      ];
    },
    ObjectPermissions: (q) => q.includes("PermissionsModifyAllRecords = true OR")
      ? [{ ParentId: PS_PROF, SobjectType: "Account", PermissionsModifyAllRecords: true }]
      : [{ ParentId: PS_A, SobjectType: "Account", PermissionsRead: true }, { ParentId: PS_B, SobjectType: "Account", PermissionsRead: true }],
    User: [{ Name: "Bob", Username: "bob@x", Profile: { Name: "Std" }, LastLoginDate: null, CreatedDate: "2024-01-01T00:00:00Z" }],
  });
  const sections = Object.fromEntries((await runAudit(c)).map((s) => [s.id, s]));
  assert.deepEqual(sections["power-users"].rows[0].slice(0, 4), ["Ana", "ana@x", "System Administrator", "Modify All Data, View All Data"]);
  assert.deepEqual(sections["modify-all-objects"].rows, [["Profile: System Administrator", "Account", "", "3"]]);
  assert.deepEqual(sections["unassigned-permsets"].rows.map((r) => r[0]), ["Legacy Access"]);
  assert.deepEqual(sections["unused-profiles"].rows, [["Old Sales", "Salesforce", "Yes"]]);
  assert.deepEqual(sections["duplicate-permsets"].rows, [["Sales Extra, Sales Extra Copy", "1"]]);
  assert.equal(sections.expiring.status, "error");
  assert.deepEqual(sections["dormant-users"].rows, [["Bob", "bob@x", "Std", "Never", "2024-01-01"]]);
});

test("audit: duplicates need identical permissions on every object", () => {
  const r = (p, o, read, edit) => ({ ParentId: p, SobjectType: o, PermissionsRead: read, PermissionsEdit: edit });
  assert.deepEqual(duplicateGroups([r("A", "Account", true, false), r("B", "Account", true, false), r("B", "Case", true, false), r("C", "Account", true, true)]), []);
  assert.deepEqual(duplicateGroups([r("A", "Case", true, false), r("A", "Account", true, false), r("B", "Account", true, false), r("B", "Case", true, false)]), [["A", "B"]]);
});

// ---------------- docs ----------------

const docTables = {
  EntityDefinition: [{ DurableId: "01I000000000001" }],
  ApexTrigger: [{ Name: "InvoiceTrigger", Status: "Active", UsageBeforeUpdate: true, UsageAfterInsert: true }],
  FlowDefinitionView: [
    { ApiName: "Set_Status", Label: "Set Status", TriggerType: "RecordBeforeSave", RecordTriggerType: "CreateAndUpdate", TriggerObjectOrEventId: "01I000000000001" },
    { ApiName: "Notify", Label: "Notify \"Finance\"", TriggerType: "RecordAfterSave", RecordTriggerType: "Update", TriggerObjectOrEventLabel: "Invoice" },
    { ApiName: "Other", Label: "Other object", TriggerType: "RecordAfterSave", TriggerObjectOrEventId: "Account" },
  ],
  ValidationRule: [{ ValidationName: "Amount_Positive", Active: true, ErrorMessage: "Amount must be > 0" }],
  WorkflowRule: new Error("sObject type 'WorkflowRule' is not supported."),
};

test("docs: dictionary, automations, failures become notes", async () => {
  const doc = await collectObjectDoc(fake(docTables, { describe: DESC }), "Invoice__c");
  assert.deepEqual(doc.flows.map((f) => f.name), ["Set_Status", "Notify"]);
  assert.deepEqual(doc.triggers[0].events, ["before update", "after insert"]);
  const status = doc.fields.find((f) => f.name === "Status__c");
  assert.equal(status.required, true);
  assert.deepEqual(status.picklist, ["Draft", "Paid"]);
  assert.equal(doc.recordTypes.length, 1);
  assert.equal(doc.notes.length, 1);
  assert.match(doc.notes[0], /workflow rules/);
});

test("docs: field types", () => {
  assert.equal(fieldType(DESC.fields[1]), "Currency(16, 2)");
  assert.equal(fieldType(DESC.fields[3]), "Master-Detail(Account)");
  assert.equal(fieldType({ type: "reference", referenceTo: ["User", "Group"], relationshipOrder: null }), "Lookup(User, Group)");
  assert.equal(fieldType(DESC.fields[4]), "Formula (double)");
  assert.equal(fieldType({ type: "string", length: 80 }), "Text(80)");
});

test("docs: diagram follows save order and only shows steps that exist", async () => {
  const doc = await collectObjectDoc(fake(docTables, { describe: DESC }), "Invoice__c");
  const m = toMermaid(doc);
  const order = ["Before-save flows", "Before triggers", "Validation rules", "After triggers", "After-save flows"].map((t) => m.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), m);
  assert.ok(!m.includes("Workflow rules"));
  assert.ok(!m.includes('"Finance"'), "quotes inside labels must be neutralized");
});

test("docs: markdown escapes pipes, html escapes markup", async () => {
  const doc = await collectObjectDoc(fake(docTables, { describe: { ...DESC, label: "<b>Invoice</b>" } }), "Invoice__c");
  assert.ok(toMarkdown(doc).includes("Total \\| incl. tax"));
  const html = toHtml(doc);
  assert.ok(html.includes("&lt;b&gt;Invoice&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Invoice</b>"));
});

// ---------------- org diff ----------------

function orgTables(over = {}) {
  return {
    EntityDefinition: [{ DurableId: "01I000000000001" }],
    ValidationRule: [{ ValidationName: "Amount_Positive", Active: true, ErrorMessage: "Amount must be > 0" }],
    Layout: [{ Name: "Invoice Layout" }],
    FieldPermissions: [{ Parent: { IsOwnedByProfile: true, Profile: { Name: "Sales" } }, Field: "Invoice__c.Amount__c", PermissionsRead: true, PermissionsEdit: true }],
    ObjectPermissions: [
      { Parent: { Name: "Finance", IsOwnedByProfile: false }, SobjectType: "Invoice__c", PermissionsRead: true },
      { Parent: { Name: "X", PermissionSetGroupId: "0PG1" }, SobjectType: "Invoice__c", PermissionsRead: true },
    ],
    FlowDefinitionView: [{ ApiName: "Notify", Label: "Notify", ProcessType: "AutoLaunchedFlow", IsActive: true }],
    ApexClass: [{ Name: "InvoiceService", ApiVersion: 62, Status: "Active", BodyCrc: 111 }],
    ApexTrigger: [],
    ...over,
  };
}

test("org diff: added, removed and changed items per section", async () => {
  const prod = fake(orgTables(), { describe: DESC, host: "acme.my.salesforce.com" });
  const sandbox = fake(orgTables({
    ValidationRule: [{ ValidationName: "Amount_Positive", Active: false, ErrorMessage: "Amount must be > 0" }, { ValidationName: "New_Rule", Active: true, ErrorMessage: "x" }],
    FieldPermissions: [{ Parent: { IsOwnedByProfile: true, Profile: { Name: "Sales" } }, Field: "Invoice__c.Amount__c", PermissionsRead: true, PermissionsEdit: false }],
    ApexClass: [{ Name: "InvoiceService", ApiVersion: 62, Status: "Active", BodyCrc: 222 }],
    FlowDefinitionView: new Error("boom"),
  }), { describe: { ...DESC, fields: [...DESC.fields, { name: "Notes__c", label: "Notes", type: "textarea", length: 32768, custom: true, nillable: true }] }, host: "acme--uat.sandbox.my.salesforce.com" });

  const d = diffSnapshots(await snapshot(prod, "Invoice__c"), await snapshot(sandbox, "Invoice__c"));
  const s = Object.fromEntries(d.sections.map((x) => [x.key, x]));
  assert.deepEqual(s.fields.onlyB, ["Notes__c"]);
  assert.deepEqual(s.validationRules.onlyB, ["New_Rule"]);
  assert.deepEqual(s.validationRules.changed, [{ name: "Amount_Positive", details: ["active: yes → no"] }]);
  assert.deepEqual(s.fieldPerms.changed, [{ name: "Profile: Sales", details: ["Amount__c: Edit → Read"] }]);
  assert.deepEqual(s.apexClasses.changed, [{ name: "InvoiceService", details: ["code differs"] }]);
  assert.deepEqual([...s.objectPerms.onlyA, ...s.objectPerms.onlyB, ...s.objectPerms.changed], [], "group aggregates are ignored");
  assert.equal(s.flows.status, "error");
  assert.match(s.flows.error, /sandbox.*boom/);
  const md = toMarkdownReport(d);
  assert.match(md, /Only in acme--uat\.sandbox\.my\.salesforce\.com\*\* \(1\)\n- New_Rule/);
});

test("org diff: prop diff formatting", () => {
  assert.deepEqual(propDiff({ a: 1, b: true }, { a: 1, c: "x" }), ["b: yes → —", "c: — → x"]);
});

// ---------------- timeline ----------------

const REC = "a01000000000001AAA";

test("timeline: merges history, activities and emails newest first", async () => {
  const c = fake({
    Invoice__c: [{ CreatedDate: "2026-01-01T10:00:00.000+0000", CreatedBy: { Name: "Ana" }, LastModifiedDate: "2026-03-01T10:00:00.000+0000", LastModifiedBy: { Name: "Bob" } }],
    Invoice__History: [
      { Field: "Status__c", DataType: "Picklist", OldValue: "Draft", NewValue: "Paid", CreatedDate: "2026-02-01T10:00:00.000+0000", CreatedBy: { Name: "Bob" } },
      { Field: "Account__c", DataType: "EntityId", OldValue: "001A", NewValue: "001B", CreatedDate: "2026-02-02T10:00:00.000+0000", CreatedBy: { Name: "Bob" } },
      { Field: "Account__c", DataType: "Text", OldValue: "Acme", NewValue: "Globex", CreatedDate: "2026-02-02T10:00:00.000+0000", CreatedBy: { Name: "Bob" } },
      { Field: "created", CreatedDate: "2026-01-01T10:00:00.000+0000", CreatedBy: { Name: "Ana" } },
    ],
    Task: [{ Subject: "Call client", Status: "Completed", TaskSubtype: "Call", CreatedDate: "2026-02-15T10:00:00.000+0000", CreatedBy: { Name: "Ana" } }],
    Event: [],
  }, { describe: DESC });
  const t = await buildTimeline(c, { sobject: "Invoice__c", recordId: REC });
  assert.deepEqual(t.events.map((e) => e.text), [
    "Last modified (any field, tracked or not)",
    "Call: Call client [Completed]",
    "Account: Acme → Globex",
    "Status: Draft → Paid",
    "Record created",
  ]);
  assert.deepEqual(t.notes, [], "unsupported EmailMessage is silently skipped");
});

test("timeline: missing history table becomes a note", async () => {
  const c = fake({ Invoice__c: [], Task: [], Event: [], EmailMessage: [] }, { describe: DESC });
  const t = await buildTimeline(c, { sobject: "Invoice__c", recordId: REC });
  assert.ok(t.notes.some((n) => /History tracking may be off/.test(n)));
});

test("timeline: history table names", () => {
  assert.deepEqual(historyInfo("Opportunity"), { table: "OpportunityFieldHistory", parent: "OpportunityId" });
  assert.deepEqual(historyInfo("Account"), { table: "AccountHistory", parent: "AccountId" });
  assert.deepEqual(historyInfo("Invoice__c"), { table: "Invoice__History", parent: "ParentId" });
});

const LOG = [
  "62.0 APEX_CODE,FINEST",
  `10:00:00.0 (1)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000001|InvoiceTrigger on Invoice trigger event BeforeUpdate|__sfdc_trigger/InvoiceTrigger`,
  `10:00:00.0 (2)|VARIABLE_ASSIGNMENT|[5]|id|"${REC.slice(0, 15)}"`,
  "10:00:00.0 (3)|FLOW_START_INTERVIEW_BEGIN|3001x0000000001|Set Status",
  "10:00:00.0 (4)|VALIDATION_RULE|03d000000000001|Amount_Positive",
  "10:00:00.0 (5)|VALIDATION_FAIL",
  "10:00:00.0 (6)|FLOW_ELEMENT_ERROR|Something broke|Update_Record",
].join("\n");

test("debug logs: extracts automations only from logs that mention the record", () => {
  const p = parseLog(LOG, REC);
  assert.equal(p.mentionsRecord, true);
  assert.deepEqual(p.flows, ["Set Status"]);
  assert.deepEqual(p.triggers, ["InvoiceTrigger on Invoice trigger event BeforeUpdate"]);
  assert.deepEqual(p.validations, ["Amount_Positive"]);
  assert.equal(p.failures.length, 1);
  assert.equal(p.errors.length, 1);
  assert.equal(parseLog(LOG, "a01000000000999AAA").mentionsRecord, false);
});

test("debug logs: scan reports matches and unreadable logs", async () => {
  const c = fake({ ApexLog: [
    { Id: "07L1", StartTime: "2026-11-17T10:00:00.000+0000", LogUser: { Name: "Ana" }, Operation: "/aura", Status: "Success" },
    { Id: "07L2", StartTime: "2026-11-17T09:00:00.000+0000", LogUser: { Name: "Bob" }, Operation: "/aura", Status: "Success" },
    { Id: "07L3", StartTime: "2026-11-17T08:00:00.000+0000", LogUser: { Name: "Bob" }, Operation: "/aura", Status: "Success" },
  ] }, { logs: { "07L1": LOG, "07L2": "nothing here" } });
  const r = await scanLogs(c, { recordId: REC });
  assert.equal(r.scanned, 3);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.matches.map((m) => m.id), ["07L1"]);
});

test("inputs are validated before any query", async () => {
  const c = fake({});
  await assert.rejects(collectObjectDoc(c, "Account'--"), /Invalid object/);
  await assert.rejects(snapshot(c, "x y"), /Invalid object/);
  await assert.rejects(buildTimeline(c, { sobject: "Account", recordId: "' OR ''='" }), /Invalid record/);
  await assert.rejects(scanLogs(c, { recordId: "bad" }), /Invalid record/);
});

// ---------------- docs: Setup links ----------------

import { setupLinks } from "../src/docs.js";

test("docs links: Setup URLs for production, sandbox and Developer Edition hosts", () => {
  assert.equal(setupLinks("acme.my.salesforce.com", "Account").object, "https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/Details/view");
  assert.equal(setupLinks("acme--uat.sandbox.my.salesforce.com", "Invoice__c").field("00N000000000001"),
    "https://acme--uat.sandbox.lightning.force.com/lightning/setup/ObjectManager/Invoice__c/FieldsAndRelationships/00N000000000001/view");
  assert.equal(setupLinks("acme-dev-ed.develop.my.salesforce.com", "Account").flow("301000000000001"),
    "https://acme-dev-ed.develop.lightning.force.com/builder_platform_interaction/flowBuilder.app?flowId=301000000000001");
  assert.equal(setupLinks("acme.my.salesforce.com", "Account").workflowRule("01Q000000000001"),
    "https://acme.lightning.force.com/lightning/setup/WorkflowRules/page?address=%2F01Q000000000001");
});

const linkTables = {
  ...docTables,
  ApexTrigger: [{ Id: "01q000000000001", Name: "InvoiceTrigger", Status: "Active", UsageBeforeUpdate: true }],
  FlowDefinitionView: [{ ApiName: "Set_Status", Label: "Set Status", TriggerType: "RecordBeforeSave", RecordTriggerType: "Create", TriggerObjectOrEventId: "01I000000000001", ActiveVersionId: "301000000000001" }],
  ValidationRule: [{ Id: "03d000000000001", ValidationName: "Amount_Positive", Active: true, ErrorMessage: "x" }],
  WorkflowRule: [{ Id: "01Q000000000001", Name: "Old_Rule" }],
  CustomField: [{ Id: "00N000000000001", DeveloperName: "Amount", NamespacePrefix: null }],
};
const linkDesc = { ...DESC, recordTypeInfos: [{ master: false, name: "Export", developerName: "Export", active: true, recordTypeId: "012000000000001" }] };

test("docs links: every metadata item points to its Setup page", async () => {
  const doc = await collectObjectDoc(fake(linkTables, { describe: linkDesc, host: "acme.my.salesforce.com" }), "Invoice__c");
  const base = "https://acme.lightning.force.com";
  assert.equal(doc.flows[0].url, `${base}/builder_platform_interaction/flowBuilder.app?flowId=301000000000001`);
  assert.equal(doc.triggers[0].url, `${base}/lightning/setup/ObjectManager/Invoice__c/ApexTriggers/01q000000000001/view`);
  assert.equal(doc.validationRules[0].url, `${base}/lightning/setup/ObjectManager/Invoice__c/ValidationRules/03d000000000001/view`);
  assert.equal(doc.recordTypes[0].url, `${base}/lightning/setup/ObjectManager/Invoice__c/RecordTypes/012000000000001/view`);
  const byName = Object.fromEntries(doc.fields.map((f) => [f.name, f.url]));
  assert.equal(byName.Amount__c, `${base}/lightning/setup/ObjectManager/Invoice__c/FieldsAndRelationships/00N000000000001/view`);
  assert.equal(byName.Status__c, `${base}/lightning/setup/ObjectManager/Invoice__c/FieldsAndRelationships/view`, "custom field without Id falls back to the field list");
  assert.equal(byName.Id, `${base}/lightning/setup/ObjectManager/Invoice__c/FieldsAndRelationships/Id/view`);

  const md = toMarkdown(doc);
  assert.ok(md.includes(`| [Set Status](${base}/builder_platform_interaction/flowBuilder.app?flowId=301000000000001) |`));
  assert.ok(!toMermaid(doc).includes("click"), "Markdown diagram has no click lines");
  const html = toHtml(doc);
  assert.ok(html.includes(`<a href="${base}/lightning/setup/ObjectManager/Invoice__c/ValidationRules/03d000000000001/view" target="_blank" rel="noopener">Amount_Positive</a>`));
  assert.ok(html.includes(`click s0_0 href &quot;${base}/builder_platform_interaction/flowBuilder.app?flowId=301000000000001&quot; _blank`));
});

test("docs links: if the org doesn't support ActiveVersionId, flows still load and link to the Flows list", async () => {
  const tables = { ...linkTables, FlowDefinitionView: (q) => {
    if (q.includes("ActiveVersionId")) throw new Error("No such column 'ActiveVersionId' on entity 'FlowDefinitionView'");
    return [{ ApiName: "Set_Status", Label: "Set Status", TriggerType: "RecordBeforeSave", TriggerObjectOrEventId: "01I000000000001" }];
  } };
  const doc = await collectObjectDoc(fake(tables, { describe: linkDesc }), "Invoice__c");
  assert.equal(doc.flows.length, 1);
  assert.equal(doc.flows[0].url, "https://acme.lightning.force.com/lightning/setup/Flows/home");
  assert.ok(!doc.notes.some((n) => /flows/.test(n)));
});
