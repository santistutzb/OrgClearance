// Object documentation: data dictionary + automations + order-of-execution diagram.
// Collection talks to Salesforce; rendering (Markdown, HTML, Mermaid) is pure and testable.

const NAME_RE = /^[A-Za-z0-9_]+$/;

async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// Try a query that asks for link-only fields; if the org doesn't support them, retry without.
async function attemptWithFallback(primary, fallback) {
  const first = await attempt(primary);
  return first.ok ? first : attempt(fallback);
}

// Links into Salesforce Setup, built from the org's API host (My Domain).
// acme.my.salesforce.com -> https://acme.lightning.force.com (also sandboxes and Developer Edition).
export function setupLinks(apiHost, sobject) {
  const host = /\.my\.salesforce\.com$/i.test(apiHost) ? apiHost.replace(/\.my\.salesforce\.com$/i, ".lightning.force.com") : apiHost;
  const base = `https://${host}`;
  const obj = `${base}/lightning/setup/ObjectManager/${encodeURIComponent(sobject)}`;
  const id = (v) => encodeURIComponent(v);
  return {
    object: `${obj}/Details/view`,
    fields: `${obj}/FieldsAndRelationships/view`,
    field: (idOrName) => `${obj}/FieldsAndRelationships/${id(idOrName)}/view`,
    recordType: (rtId) => `${obj}/RecordTypes/${id(rtId)}/view`,
    validationRule: (vrId) => `${obj}/ValidationRules/${id(vrId)}/view`,
    trigger: (trId) => `${obj}/ApexTriggers/${id(trId)}/view`,
    flow: (versionId) => `${base}/builder_platform_interaction/flowBuilder.app?flowId=${id(versionId)}`,
    flows: `${base}/lightning/setup/Flows/home`,
    workflowRule: (wfId) => `${base}/lightning/setup/WorkflowRules/page?address=${id(`/${wfId}`)}`,
  };
}

export function fieldType(f) {
  const t = f.type;
  if (f.calculated && f.calculatedFormula) return `Formula (${t})`;
  if (f.autoNumber) return "Auto Number";
  if (t === "reference") return `${f.relationshipOrder != null ? "Master-Detail" : "Lookup"}(${(f.referenceTo || []).join(", ")})`;
  if (t === "string") return `Text(${f.length})`;
  if (t === "textarea") return f.extraTypeInfo === "richtextarea" ? `Rich Text(${f.length})` : f.length > 255 ? `Long Text(${f.length})` : `Text Area(${f.length})`;
  if (["double", "currency", "percent"].includes(t)) return `${t[0].toUpperCase()}${t.slice(1)}(${f.precision - f.scale}, ${f.scale})`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export async function collectObjectDoc(client, sobject) {
  if (!NAME_RE.test(sobject || "")) throw new Error("Invalid object");
  const desc = await client.describe(sobject);
  const notes = [];
  const links = setupLinks(client.host || "", sobject);

  const fields = desc.fields.map((f) => ({
    name: f.name, label: f.label, type: fieldType(f),
    required: !f.nillable && f.createable && !f.defaultedOnCreate,
    unique: !!f.unique, externalId: !!f.externalId, custom: !!f.custom,
    help: f.inlineHelpText || "",
    formula: f.calculatedFormula || "",
    picklist: (f.picklistValues || []).filter((p) => p.active).map((p) => p.value),
  })).sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name));

  const recordTypes = (desc.recordTypeInfos || [])
    .filter((r) => !r.master)
    .map((r) => ({ name: r.name, developerName: r.developerName, active: r.active, isDefault: r.defaultRecordTypeMapping,
      url: r.recordTypeId ? links.recordType(r.recordTypeId) : null }));

  // EntityDefinition.DurableId: the API name for standard objects, the 01I... Id for custom ones.
  const ent = await attempt(() => client.query(`SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${sobject}'`));
  const durableId = ent.ok && ent.value[0]?.DurableId ? ent.value[0].DurableId : sobject;
  const tableIds = [...new Set([sobject, durableId])].map((x) => `'${x}'`).join(",");

  const FLOW_FIELDS = "ApiName, Label, TriggerType, RecordTriggerType, TriggerObjectOrEventId, TriggerObjectOrEventLabel, Description";
  const FLOW_WHERE = "FROM FlowDefinitionView WHERE IsActive = true AND TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete')";
  const [trig, flows, vrs, wfr, cfs] = await Promise.all([
    attempt(() => client.query(
      "SELECT Id, Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, " +
      `UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger WHERE TableEnumOrId IN (${tableIds})`)),
    attemptWithFallback(
      () => client.query(`SELECT ${FLOW_FIELDS}, ActiveVersionId ${FLOW_WHERE}`),
      () => client.query(`SELECT ${FLOW_FIELDS} ${FLOW_WHERE}`)),
    attempt(() => client.toolingQuery(
      `SELECT Id, ValidationName, Active, ErrorMessage, Description FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${sobject}'`)),
    attempt(() => client.toolingQuery(`SELECT Id, Name FROM WorkflowRule WHERE TableEnumOrId IN (${tableIds})`)),
    // Custom field Ids, only used to build links to each field's Setup page.
    attempt(() => client.toolingQuery(`SELECT Id, DeveloperName, NamespacePrefix FROM CustomField WHERE TableEnumOrId IN (${tableIds})`)),
  ]);

  const customFieldId = new Map(cfs.ok
    ? cfs.value.map((c) => [`${c.NamespacePrefix ? `${c.NamespacePrefix}__` : ""}${c.DeveloperName}__c`.toLowerCase(), c.Id])
    : []);
  for (const f of fields) {
    const cfId = customFieldId.get(f.name.toLowerCase());
    f.url = f.custom ? (cfId ? links.field(cfId) : links.fields) : links.field(f.name);
  }

  const EVENTS = [["BeforeInsert", "before insert"], ["BeforeUpdate", "before update"], ["BeforeDelete", "before delete"],
    ["AfterInsert", "after insert"], ["AfterUpdate", "after update"], ["AfterDelete", "after delete"], ["AfterUndelete", "after undelete"]];
  const triggers = trig.ok ? trig.value.map((t) => ({
    name: t.Name, active: t.Status === "Active",
    events: EVENTS.filter(([k]) => t[`Usage${k}`]).map(([, v]) => v),
    url: t.Id ? links.trigger(t.Id) : null,
  })) : [];
  if (!trig.ok) notes.push(`Couldn't read Apex triggers: ${trig.error}`);

  const flowList = flows.ok ? flows.value
    .filter((f) => [sobject, durableId].includes(f.TriggerObjectOrEventId) || f.TriggerObjectOrEventLabel === desc.label)
    .map((f) => ({
      name: f.ApiName, label: f.Label, description: f.Description || "",
      timing: { RecordBeforeSave: "before save", RecordAfterSave: "after save", RecordBeforeDelete: "before delete" }[f.TriggerType],
      on: { Create: "create", Update: "update", CreateAndUpdate: "create or update", Delete: "delete" }[f.RecordTriggerType] ?? f.RecordTriggerType ?? "",
      url: f.ActiveVersionId ? links.flow(f.ActiveVersionId) : links.flows,
    })) : [];
  if (!flows.ok) notes.push(`Couldn't read record-triggered flows: ${flows.error}`);

  const validationRules = vrs.ok ? vrs.value.map((v) => ({ name: v.ValidationName, active: v.Active, message: v.ErrorMessage, description: v.Description || "",
    url: v.Id ? links.validationRule(v.Id) : null })) : [];
  if (!vrs.ok) notes.push(`Couldn't read validation rules: ${vrs.error}`);

  const workflowRules = wfr.ok ? wfr.value.map((w) => ({ name: w.Name, url: w.Id ? links.workflowRule(w.Id) : null })) : [];
  if (!wfr.ok) notes.push(`Couldn't read workflow rules: ${wfr.error}`);

  return {
    sobject, label: desc.label, labelPlural: desc.labelPlural, custom: desc.custom, keyPrefix: desc.keyPrefix, url: links.object,
    generatedAt: new Date().toISOString(),
    fields, recordTypes, triggers, flows: flowList, validationRules, workflowRules, notes,
  };
}

// ---------- rendering ----------

const mmd = (s) => String(s).replace(/"/g, "'").replace(/[<>]/g, "");
const isUrl = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);

// Simplified save order of execution, showing only steps this object actually has.
// With { links: true }, each node opens its Setup page (used in the HTML file; Markdown viewers ignore clicks).
export function toMermaid(doc, { links = false } = {}) {
  const steps = [];
  const add = (title, items) => { if (items.length) steps.push({ title, items }); };
  const flowsAt = (t) => doc.flows.filter((f) => f.timing === t).map((f) => ({ text: `Flow: ${f.label} (${f.on})`, url: f.url }));
  const trigAt = (prefix) => doc.triggers.filter((t) => t.active && t.events.some((e) => e.startsWith(prefix) && !e.includes("delete") && !e.includes("undelete")))
    .map((t) => ({ text: `Trigger: ${t.name}`, url: t.url }));

  add("1. Before-save flows", flowsAt("before save"));
  add("2. Before triggers", trigAt("before"));
  add("3. Validation rules", doc.validationRules.filter((v) => v.active).map((v) => ({ text: v.name, url: v.url })));
  add("4. After triggers", trigAt("after"));
  add("5. Workflow rules", doc.workflowRules.map((w) => ({ text: w.name, url: w.url })));
  add("6. After-save flows", flowsAt("after save"));

  const lines = ["flowchart TD", `  save(["Save ${mmd(doc.label)}"])`];
  const clicks = [];
  let prev = "save";
  steps.forEach((s, i) => {
    const id = `s${i}`;
    lines.push(`  subgraph ${id} ["${mmd(s.title)}"]`);
    s.items.forEach((it, j) => {
      lines.push(`    ${id}_${j}["${mmd(it.text)}"]`);
      if (links && isUrl(it.url)) clicks.push(`  click ${id}_${j} href "${it.url}" _blank`);
    });
    lines.push("  end");
    lines.push(`  ${prev} --> ${id}`);
    prev = id;
  });
  lines.push(`  ${prev} --> commit(["Commit"])`);
  return [...lines, ...clicks].join("\n");
}

// A table cell that may carry a link: { text, url }.
const cell = (text, url) => ({ text, url });
const mdText = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const mdCell = (c) => {
  if (c && typeof c === "object") {
    const t = mdText(c.text).replace(/([[\]])/g, "\\$1");
    return isUrl(c.url) ? `[${t}](${c.url.replace(/\)/g, "%29")})` : t;
  }
  return mdText(c);
};
const mdTable = (cols, rows) => rows.length
  ? [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n")
  : "_None._";
const yes = (b) => (b ? "Yes" : "");

// Rows shared by Markdown and HTML.
const rowsFor = {
  triggers: (d) => d.triggers.map((t) => [cell(t.name, t.url), yes(t.active), t.events.join(", ")]),
  flows: (d) => d.flows.map((f) => [cell(f.label, f.url), f.name, f.timing, f.on, f.description]),
  validationRules: (d) => d.validationRules.map((v) => [cell(v.name, v.url), yes(v.active), v.message]),
  workflowRules: (d) => d.workflowRules.map((w) => [cell(w.name, w.url)]),
  recordTypes: (d) => d.recordTypes.map((r) => [cell(r.name, r.url), r.developerName, yes(r.active), yes(r.isDefault)]),
  fields: (d) => d.fields.map((f) => [cell(f.label, f.url), f.name, f.type, yes(f.required), yes(f.unique), yes(f.externalId), f.help, f.formula || f.picklist.join(", ")]),
};
const COLS = {
  triggers: ["Trigger", "Active", "Events"],
  flows: ["Flow", "API name", "Runs", "On", "Description"],
  validationRules: ["Rule", "Active", "Error message"],
  workflowRules: ["Rule"],
  recordTypes: ["Record type", "API name", "Active", "Default"],
  fields: ["Label", "API name", "Type", "Required", "Unique", "External ID", "Help text", "Values / formula"],
};

export function toMarkdown(doc) {
  const t = (k) => mdTable(COLS[k], rowsFor[k](doc));
  return [
    `# ${doc.label} (\`${doc.sobject}\`)`,
    "",
    `${doc.custom ? "Custom" : "Standard"} object · Key prefix ${doc.keyPrefix ?? "—"} · ${doc.fields.length} fields · Generated ${doc.generatedAt.slice(0, 10)} by OrgClearance`,
    ...(isUrl(doc.url) ? ["", `[Open in Object Manager](${doc.url})`] : []),
    "",
    "Names link to their page in Salesforce Setup (you need to be logged into the org).",
    "",
    "## Automation (save order)",
    "",
    "```mermaid",
    toMermaid(doc),
    "```",
    "",
    "### Apex triggers", t("triggers"), "",
    "### Record-triggered flows", t("flows"), "",
    "### Validation rules", t("validationRules"), "",
    "### Workflow rules (legacy)", t("workflowRules"), "",
    "## Record types", t("recordTypes"), "",
    "## Fields", t("fields"),
    ...(doc.notes.length ? ["", "## Notes", ...doc.notes.map((n) => `- ${n}`)] : []),
    "",
  ].join("\n");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const htmlCell = (c) => (c && typeof c === "object")
  ? (isUrl(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text))
  : esc(c);
const htmlTable = (cols, rows) => rows.length
  ? `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((c) => `<td>${htmlCell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : "<p class=muted>None.</p>";

// Self-contained page. The diagram renders with Mermaid from a CDN when online, and falls back to its source text.
// Diagram nodes and names link to Salesforce Setup.
export function toHtml(doc) {
  const t = (k) => htmlTable(COLS[k], rowsFor[k](doc));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.label)} · Object documentation</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#181818;max-width:1100px;margin:32px auto;padding:0 20px}
h1{margin-bottom:4px}h2{margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:4px}
.muted{color:#666}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #e2e2e2;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f6f7f9}
a{color:#0b5cab}code{font-family:ui-monospace,monospace}pre.mermaid{background:#fafafa;padding:12px;border-radius:6px}
</style></head><body>
<h1>${esc(doc.label)} <code>${esc(doc.sobject)}</code></h1>
<p class=muted>${doc.custom ? "Custom" : "Standard"} object · Key prefix ${esc(doc.keyPrefix ?? "—")} · ${doc.fields.length} fields · Generated ${esc(doc.generatedAt.slice(0, 10))} by OrgClearance${
  isUrl(doc.url) ? ` · <a href="${esc(doc.url)}" target="_blank" rel="noopener">Open in Object Manager</a>` : ""}</p>
<p class=muted>Names and diagram boxes link to their page in Salesforce Setup (you need to be logged into the org).</p>
<h2>Automation (save order)</h2>
<pre class="mermaid">${esc(toMermaid(doc, { links: true }))}</pre>
<h3>Apex triggers</h3>${t("triggers")}
<h3>Record-triggered flows</h3>${t("flows")}
<h3>Validation rules</h3>${t("validationRules")}
<h3>Workflow rules (legacy)</h3>${t("workflowRules")}
<h2>Record types</h2>${t("recordTypes")}
<h2>Fields</h2>${t("fields")}
${doc.notes.length ? `<h2>Notes</h2><ul>${doc.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<script type="module">try{const m=await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");m.default.initialize({startOnLoad:false,securityLevel:"loose"});await m.default.run();}catch(e){}</script>
</body></html>`;
}
