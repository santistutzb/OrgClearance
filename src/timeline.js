// Record timeline: "what happened here and who did it".
// Salesforce has no per-record log of which flows ran, so this combines what does exist:
// field history (tracked fields only), activities, emails, and recent debug logs that mention the record.

const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const NAME_RE = /^[A-Za-z0-9_]+$/;

async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

export function historyInfo(sobject) {
  if (sobject.endsWith("__c")) return { table: sobject.replace(/__c$/, "__History"), parent: "ParentId" };
  if (sobject === "Opportunity") return { table: "OpportunityFieldHistory", parent: "OpportunityId" };
  return { table: `${sobject}History`, parent: `${sobject}Id` };
}

import "../i18n.js";

const I18N = globalThis.OrgClearanceI18n;
const t = (k, v) => I18N.t(k, v);

const SPECIAL_FIELDS = { created: "Record created", locked: "Record locked", unlocked: "Record unlocked", ownerAccepted: "Owner accepted", ownerAssignment: "Owner assigned" };
const short = (v) => {
  if (v === null || v === undefined || v === "") return "(empty)";
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};

export async function buildTimeline(client, { sobject, recordId }) {
  if (!NAME_RE.test(sobject || "")) throw new Error(t("Invalid {what}", { what: t("object") }));
  if (!ID_RE.test(recordId || "")) throw new Error(t("Invalid {what}", { what: t("record") }));
  const events = [];
  const notes = [];
  const push = (at, who, kind, text) => { if (at) events.push({ at, who: who ?? "", kind, text }); };

  const desc = await attempt(() => client.describe(sobject));
  const labelOf = new Map(desc.ok ? desc.value.fields.map((f) => [f.name.toLowerCase(), f.label]) : []);

  const rec = await attempt(() => client.query(
    `SELECT CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name FROM ${sobject} WHERE Id = '${recordId}'`));
  if (rec.ok && rec.value[0]) {
    const r = rec.value[0];
    push(r.CreatedDate, r.CreatedBy?.Name, "created", t("Record created"));
    if (r.LastModifiedDate !== r.CreatedDate) push(r.LastModifiedDate, r.LastModifiedBy?.Name, "modified", t("Last modified (any field, tracked or not)"));
  } else {
    notes.push(t("Couldn't read created/modified info: {error}", { error: rec.ok ? t("record not found") : rec.error }));
  }

  const { table, parent } = historyInfo(sobject);
  const hist = await attempt(() => client.query(
    `SELECT Field, DataType, OldValue, NewValue, CreatedDate, CreatedBy.Name FROM ${table} ` +
    `WHERE ${parent} = '${recordId}' ORDER BY CreatedDate DESC LIMIT 500`));
  if (hist.ok) {
    let tracked = 0;
    for (const h of hist.value) {
      if (h.DataType === "EntityId") continue; // lookups come twice: as Ids and as names; keep names
      if (h.Field === "created") continue; // already shown from CreatedDate
      tracked++;
      const label = SPECIAL_FIELDS[h.Field] ? t(SPECIAL_FIELDS[h.Field]) : labelOf.get(String(h.Field).toLowerCase()) ?? h.Field;
      push(h.CreatedDate, h.CreatedBy?.Name, "field",
        SPECIAL_FIELDS[h.Field] ? label : `${label}: ${short(h.OldValue)} → ${short(h.NewValue)}`);
    }
    if (!tracked) notes.push(t("No field history. Changes are only recorded for fields with history tracking turned on."));
  } else {
    notes.push(t("No field history available ({table}): {error}. History tracking may be off for this object.", { table, error: hist.error }));
  }

  const [tasks, evts, emails] = await Promise.all([
    attempt(() => client.query(
      `SELECT Subject, Status, TaskSubtype, CreatedDate, CreatedBy.Name FROM Task WHERE WhatId = '${recordId}' OR WhoId = '${recordId}' ORDER BY CreatedDate DESC LIMIT 200`)),
    attempt(() => client.query(
      `SELECT Subject, StartDateTime, CreatedDate, CreatedBy.Name FROM Event WHERE WhatId = '${recordId}' OR WhoId = '${recordId}' ORDER BY CreatedDate DESC LIMIT 200`)),
    attempt(() => client.query(
      `SELECT Subject, FromAddress, Incoming, MessageDate, CreatedBy.Name FROM EmailMessage WHERE RelatedToId = '${recordId}' ORDER BY MessageDate DESC LIMIT 200`)),
  ]);
  if (tasks.ok) tasks.value.forEach((k) => push(k.CreatedDate, k.CreatedBy?.Name, "activity", `${t(k.TaskSubtype === "Call" ? "Call" : "Task")}: ${k.Subject ?? t("(no subject)")}${k.Status ? ` [${k.Status}]` : ""}`));
  if (evts.ok) evts.value.forEach((e) => push(e.CreatedDate, e.CreatedBy?.Name, "activity", `${t("Event")}: ${e.Subject ?? t("(no subject)")}`));
  if (emails.ok) emails.value.forEach((m) => push(m.MessageDate, m.Incoming ? m.FromAddress : m.CreatedBy?.Name, "email", `${t(m.Incoming ? "Email received" : "Email sent")}: ${m.Subject ?? t("(no subject)")}`));
  if (!emails.ok && !/not supported|No such column|sObject type 'EmailMessage'/i.test(emails.error)) notes.push(t("Couldn't read emails: {error}", { error: emails.error }));

  events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return { sobject, recordId, events, notes };
}

// ---------- debug logs ----------

// Pull automation names out of a debug log body, keeping only logs that mention the record.
export function parseLog(body, recordId) {
  const id15 = recordId.slice(0, 15);
  const result = { mentionsRecord: body.includes(id15), flows: [], triggers: [], validations: [], failures: [], errors: [] };
  if (!result.mentionsRecord) return result;
  const add = (list, v) => { if (v && !list.includes(v)) list.push(v); };
  for (const line of body.split(/\r?\n/)) {
    const parts = line.split("|");
    const ev = parts[1];
    if (ev === "FLOW_START_INTERVIEW_BEGIN") add(result.flows, parts[parts.length - 1].trim());
    else if (ev === "CODE_UNIT_STARTED") {
      const unit = parts.find((p) => / trigger event /.test(p));
      if (unit) add(result.triggers, unit.trim());
    } else if (ev === "VALIDATION_RULE") add(result.validations, parts[parts.length - 1].trim());
    else if (ev === "VALIDATION_FAIL") add(result.failures, "A validation rule failed");
    else if (ev === "FLOW_ELEMENT_ERROR" || ev === "FATAL_ERROR" || ev === "EXCEPTION_THROWN") add(result.errors, parts.slice(2).join("|").trim().slice(0, 200));
  }
  return result;
}

export async function scanLogs(client, { recordId, limit = 20 }) {
  if (!ID_RE.test(recordId || "")) throw new Error(t("Invalid {what}", { what: t("record") }));
  const n = Math.max(1, Math.min(50, Number(limit) || 20));
  const logs = await client.query(
    "SELECT Id, StartTime, LogUser.Name, Operation, Status, LogLength FROM ApexLog " +
    `WHERE LogLength < 5000000 ORDER BY StartTime DESC LIMIT ${n}`);
  const matches = [];
  const failed = [];
  for (const log of logs) {
    const body = await attempt(() => client.logBody(log.Id));
    if (!body.ok) { failed.push(log.Id); continue; }
    const p = parseLog(body.value, recordId);
    if (p.mentionsRecord) {
      matches.push({ id: log.Id, at: log.StartTime, user: log.LogUser?.Name ?? "", operation: log.Operation, status: log.Status, ...p });
    }
  }
  return { scanned: logs.length, failed: failed.length, matches };
}
