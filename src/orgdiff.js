// Compare metadata between two orgs (e.g. sandbox vs production) the user is logged into.
// snapshot() reads one org; diffSnapshots() and toMarkdownReport() are pure.

import { fieldType } from "./docs.js";

const NAME_RE = /^[A-Za-z0-9_]+$/;

async function collect(fn) {
  try { return { ok: true, items: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}
const toMap = (rows, key, props) => new Map(rows.map((r) => [key(r), props(r)]));

// Stable name for a permission owner across orgs (Ids differ, names don't).
function ownerKey(parent) {
  if (!parent || parent.PermissionSetGroupId || parent.NamespacePrefix) return null; // group aggregates are derived; managed packages skipped
  return parent.IsOwnedByProfile ? `Profile: ${parent.Profile?.Name}` : `Permission set: ${parent.Name}`;
}
const PARENT = "Parent.Name, Parent.IsOwnedByProfile, Parent.Profile.Name, Parent.PermissionSetGroupId, Parent.NamespacePrefix";

function groupPerms(rows, label, value) {
  const out = new Map();
  for (const r of rows) {
    const k = ownerKey(r.Parent);
    if (!k) continue;
    const v = value(r);
    if (!v) continue;
    if (!out.has(k)) out.set(k, {});
    out.get(k)[label(r)] = v;
  }
  return out;
}

const objFlags = (r) => [["Read", r.PermissionsRead], ["Create", r.PermissionsCreate], ["Edit", r.PermissionsEdit], ["Delete", r.PermissionsDelete],
  ["View All", r.PermissionsViewAllRecords], ["Modify All", r.PermissionsModifyAllRecords]].filter(([, on]) => on).map(([n]) => n).join(", ");

export async function snapshot(client, sobject) {
  if (!NAME_RE.test(sobject || "")) throw new Error("Invalid object");
  const desc = await collect(() => client.describe(sobject));
  const ent = await collect(() => client.query(`SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${sobject}'`));
  const durableId = ent.ok && ent.items[0]?.DurableId ? ent.items[0].DurableId : sobject;
  const tableIds = [...new Set([sobject, durableId])].map((x) => `'${x}'`).join(",");
  const fromDesc = (fn) => (desc.ok ? { ok: true, items: fn(desc.items) } : { ok: false, error: desc.error });

  const [validationRules, layouts, fieldPerms, objectPerms, flows, apexClasses, apexTriggers] = await Promise.all([
    collect(async () => toMap(
      await client.toolingQuery(`SELECT ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${sobject}'`),
      (r) => r.ValidationName, (r) => ({ active: r.Active, message: r.ErrorMessage }))),
    collect(async () => toMap(
      await client.toolingQuery(`SELECT Name FROM Layout WHERE TableEnumOrId IN (${tableIds})`),
      (r) => r.Name, () => ({}))),
    collect(async () => groupPerms(
      await client.query(`SELECT ${PARENT}, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${sobject}'`),
      (r) => r.Field.slice(sobject.length + 1), (r) => (r.PermissionsEdit ? "Edit" : r.PermissionsRead ? "Read" : ""))),
    collect(async () => groupPerms(
      await client.query(
        `SELECT ${PARENT}, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, ` +
        "PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions"),
      (r) => r.SobjectType, objFlags)),
    collect(async () => toMap(
      await client.query("SELECT ApiName, Label, ProcessType, IsActive FROM FlowDefinitionView WHERE NamespacePrefix = null"),
      (r) => r.ApiName, (r) => ({ label: r.Label, type: r.ProcessType, active: r.IsActive }))),
    collect(async () => toMap(
      await client.query("SELECT Name, ApiVersion, Status, BodyCrc FROM ApexClass WHERE NamespacePrefix = null"),
      (r) => r.Name, (r) => ({ apiVersion: r.ApiVersion, status: r.Status, code: r.BodyCrc }))),
    collect(async () => toMap(
      await client.query("SELECT Name, TableEnumOrId, ApiVersion, Status, BodyCrc FROM ApexTrigger WHERE NamespacePrefix = null"),
      (r) => r.Name, (r) => ({ apiVersion: r.ApiVersion, status: r.Status, code: r.BodyCrc }))),
  ]);

  return {
    host: client.host,
    sobject,
    collections: {
      fields: fromDesc((d) => toMap(d.fields, (f) => f.name, (f) => ({
        label: f.label, type: fieldType(f), required: !f.nillable && f.createable && !f.defaultedOnCreate,
        unique: !!f.unique, externalId: !!f.externalId, formula: f.calculatedFormula || "",
        values: (f.picklistValues || []).filter((p) => p.active).map((p) => p.value).join(", "),
        helpText: f.inlineHelpText || "",
      }))),
      recordTypes: fromDesc((d) => toMap((d.recordTypeInfos || []).filter((r) => !r.master), (r) => r.developerName, (r) => ({ label: r.name, active: r.active }))),
      validationRules, layouts, fieldPerms, objectPerms, flows, apexClasses, apexTriggers,
    },
  };
}

const SECTIONS = [
  ["fields", "Fields", "object"],
  ["recordTypes", "Record types", "object"],
  ["validationRules", "Validation rules", "object"],
  ["layouts", "Page layouts (names only; layout contents aren't compared)", "object"],
  ["fieldPerms", "Field permissions on this object", "object"],
  ["objectPerms", "Object permissions (all profiles and permission sets)", "org"],
  ["flows", "Flows (definition and active status; flow contents aren't compared)", "org"],
  ["apexClasses", "Apex classes", "org"],
  ["apexTriggers", "Apex triggers", "org"],
];

const fmt = (v) => (v === true ? "yes" : v === false ? "no" : v === undefined || v === "" ? "—" : String(v));

export function propDiff(a, b) {
  const out = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    out.push(k === "code" ? "code differs" : `${k}: ${fmt(a[k])} → ${fmt(b[k])}`);
  }
  return out;
}

export function diffSnapshots(a, b) {
  const sections = SECTIONS.map(([key, title, scope]) => {
    const ca = a.collections[key], cb = b.collections[key];
    if (!ca.ok || !cb.ok) return { key, title, scope, status: "error", error: [!ca.ok && `${a.host}: ${ca.error}`, !cb.ok && `${b.host}: ${cb.error}`].filter(Boolean).join(" · ") };
    const onlyA = [], onlyB = [], changed = [];
    for (const name of [...new Set([...ca.items.keys(), ...cb.items.keys()])].sort()) {
      if (!cb.items.has(name)) onlyA.push(name);
      else if (!ca.items.has(name)) onlyB.push(name);
      else {
        const details = propDiff(ca.items.get(name), cb.items.get(name));
        if (details.length) changed.push({ name, details });
      }
    }
    return { key, title, scope, status: "ok", onlyA, onlyB, changed, total: new Set([...ca.items.keys(), ...cb.items.keys()]).size };
  });
  return { a: a.host, b: b.host, sobject: a.sobject, comparedAt: new Date().toISOString(), sections };
}

export function toMarkdownReport(d) {
  const lines = [
    `# Org comparison: ${d.a} vs ${d.b}`, "",
    `Object: \`${d.sobject}\` · Compared ${d.comparedAt.slice(0, 16).replace("T", " ")} UTC by OrgClearance`, "",
    "Arrows read as: value in the first org → value in the second org.", "",
  ];
  for (const s of d.sections) {
    lines.push(`## ${s.title}`, "");
    if (s.status === "error") { lines.push(`_Couldn't compare: ${s.error}_`, ""); continue; }
    if (!s.onlyA.length && !s.onlyB.length && !s.changed.length) { lines.push(`_No differences (${s.total} compared)._`, ""); continue; }
    if (s.onlyA.length) lines.push(`**Only in ${d.a}** (${s.onlyA.length})`, ...s.onlyA.map((n) => `- ${n}`), "");
    if (s.onlyB.length) lines.push(`**Only in ${d.b}** (${s.onlyB.length})`, ...s.onlyB.map((n) => `- ${n}`), "");
    if (s.changed.length) lines.push(`**Different** (${s.changed.length})`, ...s.changed.map((c) => `- ${c.name}: ${c.details.join("; ")}`), "");
  }
  return lines.join("\n");
}
