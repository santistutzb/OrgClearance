// @ts-check
// "Is the field actually on their screen?" Permissions can allow a field that the record page never shows.
//
// What decides it:
//  1. Page layout: picked by the user's profile + the record's record type (Tooling ProfileLayout).
//     The field has to be on that layout (Tooling Layout.Metadata).
//  2. Lightning record pages with Dynamic Forms: fields placed on the page itself replace the layout's
//     field list, and each field can have visibility rules (Tooling FlexiPage.Metadata).
//
// Which Lightning page a user gets depends on app, record type and profile assignments that we don't
// resolve. When Dynamic Forms pages disagree with the layout, the answer is "unknown" with the pages listed.

import { lightningBase } from "./suggest.js";

const NAME_RE = /^[A-Za-z0-9_]+$/;
const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const MASTER_RT = "012000000000000AAA";
const MAX_PAGES = 8;
const DETAIL_COMPONENTS = new Set(["force:detailPanel", "force:recordDetail", "record_flexipage:recordDetail"]);

async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

export function screenLinks(apiHost, sobject) {
  const base = lightningBase(apiHost);
  const obj = `${base}/lightning/setup/ObjectManager/${encodeURIComponent(sobject)}`;
  return {
    layout: (id) => (base ? `${obj}/PageLayouts/${encodeURIComponent(id)}/view` : null),
    layouts: base ? `${obj}/PageLayouts/view` : null,
    page: (id) => (base ? `${base}/visualEditor/appBuilder.app?id=${encodeURIComponent(id)}` : null),
    pages: base ? `${obj}/LightningPages/view` : null,
  };
}

/** Every field item in a Layout metadata document, with its behavior (Edit / Readonly / Required). */
export function layoutFields(metadata) {
  const out = new Map();
  for (const section of metadata?.layoutSections ?? []) {
    for (const col of section.layoutColumns ?? []) {
      for (const item of col.layoutItems ?? []) {
        if (item?.field) out.set(String(item.field).toLowerCase(), item.behavior ?? "Edit");
      }
    }
  }
  return out;
}

/** What a FlexiPage does with fields: Dynamic Forms field instances, visibility rules, and whether it shows the layout. */
export function pageFields(metadata) {
  const fields = new Map();
  let usesLayout = false;
  for (const region of metadata?.flexiPageRegions ?? []) {
    for (const item of region.itemInstances ?? []) {
      const fi = item.fieldInstance;
      if (fi?.fieldItem) {
        const name = String(fi.fieldItem).replace(/^Record\./i, "").toLowerCase();
        const props = Object.fromEntries((fi.fieldInstanceProperties ?? []).map((p) => [p.name, p.value]));
        fields.set(name, { behavior: props.uiBehavior ?? "none", conditional: !!fi.visibilityRule?.criteria?.length });
      }
      if (DETAIL_COMPONENTS.has(item.componentInstance?.componentName)) usesLayout = true;
    }
  }
  return { fields, usesDynamicForms: fields.size > 0, usesLayout };
}

/**
 * @param {any} client  needs query, toolingQuery, describe and host
 * @param {{user: any, sobject: string, recordId?: string|null, field: string}} p
 */
export async function screenCheck(client, { user, sobject, recordId, field }) {
  if (!NAME_RE.test(sobject || "") || !NAME_RE.test(field || "")) throw new Error("Invalid object or field");
  if (!user?.profileId || !ID_RE.test(user.profileId)) {
    return { status: "unknown", error: "Couldn't read the user's profile." };
  }
  const links = screenLinks(client.host || "", sobject);
  const result = { status: "unknown", recordType: null, layout: null, onLayout: null, behavior: null, pages: [], notes: [] };

  // Field names to look for: the field itself and, for parts of an address or name, the compound field.
  const desc = await attempt(() => client.describe(sobject));
  const meta = desc.ok ? desc.value.fields.find((f) => f.name.toLowerCase() === field.toLowerCase()) : null;
  const names = [field.toLowerCase(), meta?.compoundFieldName?.toLowerCase()].filter(Boolean);
  const hasRecordTypes = desc.ok && (desc.value.recordTypeInfos ?? []).filter((r) => !r.master).length > 0;

  // 1. Record type of this record.
  let recordTypeId = null;
  if (hasRecordTypes && recordId && ID_RE.test(recordId)) {
    const rec = await attempt(() => client.query(`SELECT RecordTypeId, RecordType.Name FROM ${sobject} WHERE Id = '${recordId}'`));
    if (rec.ok && rec.value[0]?.RecordTypeId) {
      recordTypeId = rec.value[0].RecordTypeId;
      result.recordType = { id: recordTypeId, name: rec.value[0].RecordType?.Name ?? recordTypeId };
    } else if (!rec.ok) {
      result.notes.push(`Couldn't read this record's record type: ${rec.error}`);
    }
  }

  // 2. Page layout for profile + record type.
  const ent = await attempt(() => client.query(`SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${sobject}'`));
  const durableId = ent.ok && ent.value[0]?.DurableId ? ent.value[0].DurableId : sobject;
  const tableIds = [...new Set([sobject, durableId])].map((x) => `'${x}'`).join(",");
  const assign = await attempt(() => client.toolingQuery(
    `SELECT LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE ProfileId = '${user.profileId}' AND TableEnumOrId IN (${tableIds})`));
  if (!assign.ok) {
    result.error = `Couldn't read page layout assignments: ${assign.error}`;
  } else {
    const isMaster = (id) => !id || id === MASTER_RT;
    const row = assign.value.find((a) => (recordTypeId ? a.RecordTypeId === recordTypeId : isMaster(a.RecordTypeId)))
      ?? assign.value.find((a) => isMaster(a.RecordTypeId))
      ?? (assign.value.length === 1 ? assign.value[0] : null);
    if (!row) {
      result.error = "No page layout is assigned to their profile for this record type.";
    } else {
      result.layout = { id: row.LayoutId, name: row.Layout?.Name ?? row.LayoutId, url: links.layout(row.LayoutId) };
      const lm = await attempt(() => client.toolingQuery(`SELECT Metadata FROM Layout WHERE Id = '${row.LayoutId}'`));
      if (lm.ok && lm.value[0]?.Metadata) {
        const fields = layoutFields(lm.value[0].Metadata);
        const hit = names.find((n) => fields.has(n));
        result.onLayout = !!hit;
        result.behavior = hit ? fields.get(hit) : null;
      } else {
        result.error = `Couldn't read the ${result.layout.name} layout: ${lm.ok ? "no metadata returned" : lm.error}`;
      }
    }
  }

  // 3. Lightning record pages for this object.
  const pages = await attempt(() => client.toolingQuery(
    `SELECT Id, DeveloperName, MasterLabel FROM FlexiPage WHERE Type = 'RecordPage' AND EntityDefinitionId IN (${tableIds})`));
  if (pages.ok) {
    for (const p of pages.value.slice(0, MAX_PAGES)) {
      const pm = await attempt(() => client.toolingQuery(`SELECT Metadata FROM FlexiPage WHERE Id = '${p.Id}'`));
      if (!pm.ok || !pm.value[0]?.Metadata) { result.notes.push(`Couldn't read the ${p.MasterLabel} page.`); continue; }
      const info = pageFields(pm.value[0].Metadata);
      const hit = names.find((n) => info.fields.has(n));
      result.pages.push({
        id: p.Id, name: p.MasterLabel || p.DeveloperName, url: links.page(p.Id),
        usesDynamicForms: info.usesDynamicForms, usesLayout: info.usesLayout,
        hasField: info.usesDynamicForms ? !!hit : null,
        conditional: hit ? info.fields.get(hit).conditional : false,
        behavior: hit ? info.fields.get(hit).behavior : null,
      });
    }
    if (pages.value.length > MAX_PAGES) result.notes.push(`Only the first ${MAX_PAGES} of ${pages.value.length} Lightning pages were checked.`);
  } else {
    result.notes.push(`Couldn't list Lightning record pages: ${pages.error}`);
  }

  // 4. Decide.
  const dynamic = result.pages.filter((p) => p.usesDynamicForms);
  const conditional = dynamic.filter((p) => p.hasField && p.conditional);
  if (result.onLayout === null) {
    result.status = "unknown";
  } else if (!dynamic.length) {
    result.status = result.onLayout ? "yes" : "no";
  } else {
    const agree = dynamic.every((p) => p.hasField === result.onLayout) && !conditional.length;
    result.status = agree ? (result.onLayout ? "yes" : "no") : "unknown";
    if (!agree) result.notes.push("Some Lightning pages use Dynamic Forms and don't match the page layout. Which one they see depends on app, record type and profile assignments.");
  }
  if (conditional.length) result.notes.push(`On ${conditional.map((p) => p.name).join(", ")} the field only shows when its visibility rule is met.`);
  if (result.status === "yes" && /readonly/i.test(result.behavior ?? "")) result.notes.push("It's read-only on their layout, even if field-level security allows editing.");
  return result;
}
