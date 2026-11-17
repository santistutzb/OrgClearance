// @ts-check
// "How do I fix it?": read-only suggestions for the smallest change that would give access.
// Nothing here writes to Salesforce. Suggestions are ordered from "restore what was intended"
// (expired, muted) to "reuse what exists" to "broad changes", which come with a warning.

import { queryIn } from "./api.js";
import { attempt } from "./access.js";

/** acme.my.salesforce.com -> https://acme.lightning.force.com */
export function lightningBase(apiHost) {
  const host = /\.my\.salesforce\.com$/i.test(apiHost || "") ? apiHost.replace(/\.my\.salesforce\.com$/i, ".lightning.force.com") : apiHost;
  return host ? `https://${host}` : "";
}

export function setupUrl(apiHost, kind, id) {
  const base = lightningBase(apiHost);
  if (!base) return null;
  const addr = (path) => `${base}/lightning/setup/${path}?address=${encodeURIComponent(`/${id}`)}`;
  switch (kind) {
    case "permset": return addr("PermSets/page");
    case "group": return `${base}/lightning/setup/PermSetGroups/page?address=${encodeURIComponent(`/${id}`)}`;
    case "user": return `${base}/lightning/setup/ManageUsers/page?address=${encodeURIComponent(`/${id}?noredirect=1`)}`;
    case "sharing": return `${base}/lightning/setup/SecuritySharing/home`;
    case "record": return `${base}/lightning/r/${encodeURIComponent(id)}/view`;
    default: return null;
  }
}

const plural = (n, word) => `${n} active user${n === 1 ? "" : "s"}`.replace("user", word ?? "user");

/**
 * Permission sets (not profiles, not group aggregates, not managed) that already grant read,
 * with how many active users have them. Smallest audience first is not "least privilege",
 * so we rank by how often it's used: a widely used set is usually the intended one.
 */
async function grantingPermSets(client, soql) {
  const rows = await client.query(soql);
  const sets = new Map();
  for (const r of rows) {
    const p = r.Parent;
    if (!p || p.IsOwnedByProfile || p.PermissionSetGroupId || p.NamespacePrefix) continue;
    sets.set(r.ParentId, { id: r.ParentId, label: p.Label || p.Name, users: 0 });
  }
  if (!sets.size) return [];
  const counts = await attempt(() => queryIn((q) => client.query(q),
    (list) => `SELECT PermissionSetId, COUNT(Id) n FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSetId IN (${list}) GROUP BY PermissionSetId`,
    [...sets.keys()]));
  if (counts.ok) for (const c of counts.value) { const s = sets.get(c.PermissionSetId); if (s) s.users = c.n ?? c.expr0 ?? 0; }
  return [...sets.values()].sort((a, b) => b.users - a.users || a.label.localeCompare(b.label));
}

/**
 * @param {any} client
 * @param {{result: any, src: any}} p  result from explainAccess (before suggestions), sources from loadSources
 * @returns {Promise<{suggestions: any[], notes: string[]}>}
 */
export async function suggestFixes(client, { result, src }) {
  const out = [];
  const notes = [];
  const r = result;
  const host = client.host || "";
  const user = r.user;
  const ownSets = src.active.filter((s) => s.kind === "permset");
  const add = (s) => out.push(s);

  if (!user.isActive) {
    add({ problem: "user", kind: "activate", title: `Reactivate ${user.name}`, detail: "Inactive users can't log in, whatever their permissions.", url: setupUrl(host, "user", user.id) });
  }

  // Expired assignments that would have granted what's missing: renewing restores intended access.
  const missingObject = r.object?.status === "no";
  const missingField = r.fieldAccess?.status === "no";
  if ((missingObject || missingField) && src.expired.length) {
    const ids = src.expired.map((s) => s.id);
    const checks = [];
    if (missingObject) checks.push(attempt(() => queryIn((q) => client.query(q),
      (list) => `SELECT ParentId FROM ObjectPermissions WHERE SobjectType = '${r.sobject}' AND PermissionsRead = true AND ParentId IN (${list})`, ids)));
    if (missingField) checks.push(attempt(() => queryIn((q) => client.query(q),
      (list) => `SELECT ParentId FROM FieldPermissions WHERE SobjectType = '${r.sobject}' AND Field = '${r.sobject}.${r.field}' AND PermissionsRead = true AND ParentId IN (${list})`, ids)));
    const results = await Promise.all(checks);
    const grantsObject = new Set(missingObject && results[0].ok ? results[0].value.map((x) => x.ParentId) : []);
    const fieldResult = results[missingObject ? 1 : 0];
    const grantsField = new Set(missingField && fieldResult?.ok ? fieldResult.value.map((x) => x.ParentId) : []);
    for (const s of src.expired.filter((x) => grantsObject.has(x.id) || grantsField.has(x.id))) {
      s.renews = grantsObject.has(s.id) ? "object" : "field";
      add({ problem: s.renews, kind: "renew", title: `Renew their ${s.label} assignment`, detail: `It expired${s.expiresAt ? ` on ${String(s.expiresAt).slice(0, 10)}` : ""} and would give them what's missing.`,
        url: setupUrl(host, s.kind === "group" ? "group" : "permset", s.kind === "group" ? s.groupId : s.id) });
    }
  }

  // Object read.
  if (missingObject) {
    const sets = await attempt(() => grantingPermSets(client,
      "SELECT ParentId, Parent.Label, Parent.Name, Parent.IsOwnedByProfile, Parent.PermissionSetGroupId, Parent.NamespacePrefix " +
      `FROM ObjectPermissions WHERE SobjectType = '${r.sobject}' AND PermissionsRead = true`));
    if (sets.ok) {
      for (const s of sets.value.slice(0, 2)) {
        add({ problem: "object", kind: "assign", title: `Assign the ${s.label} permission set`, detail: `It already gives read on ${r.sobject}. Used by ${plural(s.users)}. Check what else it grants before assigning.`, url: setupUrl(host, "permset", s.id) });
      }
    } else notes.push(`Couldn't look for permission sets that grant ${r.sobject}: ${sets.error}`);
    add(ownSets.length
      ? { problem: "object", kind: "edit", title: `Or add read on ${r.sobject} to ${ownSets[0].label}`, detail: "They already have this permission set. Everyone else assigned to it gets the same access.", url: setupUrl(host, "permset", ownSets[0].id) }
      : { problem: "object", kind: "edit", title: `Or create a permission set with read on ${r.sobject}`, detail: "They have no custom permission sets yet, only their profile.", url: null });
  }

  // Field read (only meaningful once they can read the object).
  if (missingField) {
    for (const m of r.fieldAccess.muted ?? []) {
      const group = src.active.find((s) => s.kind === "group" && s.label === m.group);
      add(m.outdated
        ? { problem: "field", kind: "unmute", title: `Recalculate the ${m.group} permission set group`, detail: `${m.components.join(", ")} inside it grants ${r.field}, but the group hasn't been recalculated.`, url: group ? setupUrl(host, "group", group.groupId) : null }
        : { problem: "field", kind: "unmute", title: `Stop muting ${r.field} in ${m.group}`, detail: `${m.components.join(", ")} inside the group grants it, but the group's muting permission set removes it. Only change this if the mute isn't intentional.`, url: group ? setupUrl(host, "group", group.groupId) : null });
    }
    const sets = await attempt(() => grantingPermSets(client,
      "SELECT ParentId, Parent.Label, Parent.Name, Parent.IsOwnedByProfile, Parent.PermissionSetGroupId, Parent.NamespacePrefix " +
      `FROM FieldPermissions WHERE SobjectType = '${r.sobject}' AND Field = '${r.sobject}.${r.field}' AND PermissionsRead = true`));
    if (sets.ok) {
      const mutedComponents = new Set((r.fieldAccess.muted ?? []).flatMap((m) => m.components));
      for (const s of sets.value.filter((x) => !mutedComponents.has(x.label)).slice(0, 2)) {
        add({ problem: "field", kind: "assign", title: `Assign the ${s.label} permission set`, detail: `It already gives read on ${r.field}. Used by ${plural(s.users)}. Check what else it grants before assigning.`, url: setupUrl(host, "permset", s.id) });
      }
    } else notes.push(`Couldn't look for permission sets that grant ${r.field}: ${sets.error}`);
    add(ownSets.length
      ? { problem: "field", kind: "edit", title: `Or give read on ${r.field} in ${ownSets[0].label}`, detail: "They already have this permission set. Everyone else assigned to it gets the same access.", url: setupUrl(host, "permset", ownSets[0].id) }
      : { problem: "field", kind: "edit", title: `Or create a permission set with read on ${r.field}`, detail: "They have no custom permission sets yet, only their profile.", url: null });
  }

  // Field not on their page.
  if (r.screen?.status === "no") {
    const sl = { layouts: lightningBase(host) ? `${lightningBase(host)}/lightning/setup/ObjectManager/${encodeURIComponent(r.sobject)}/PageLayouts/view` : null };
    if (r.screen.layout) {
      add({ problem: "screen", kind: "layout", title: `Add ${r.field} to the ${r.screen.layout.name} page layout`, detail: "It's the layout their profile gets for this record type. Everyone using that layout will see the field.", url: r.screen.layout.url });
    }
    add({ problem: "screen", kind: "layout", title: "Or assign their profile a page layout that already has it", detail: "Use Page Layout Assignment on this object.", url: sl.layouts });
    for (const p of (r.screen.pages ?? []).filter((x) => x.usesDynamicForms && !x.hasField).slice(0, 2)) {
      add({ problem: "screen", kind: "page", title: `Also add it to the ${p.name} Lightning page`, detail: "This page uses Dynamic Forms, so it ignores the page layout's fields.", url: p.url });
    }
  }

  // Record sharing.
  if (r.record?.status === "no") {
    add({ problem: "record", kind: "share", title: "Share this record with them", detail: "Use Sharing on the record. Quickest for one record; it doesn't cover similar records.",
      url: r.recordId ? setupUrl(host, "record", r.recordId) : null });
    if (!user.roleId) {
      add({ problem: "record", kind: "role", title: "Give them a role", detail: "They have no role, so role hierarchy and role-based sharing rules can't reach them.", url: setupUrl(host, "user", user.id) });
    }
    add({ problem: "record", kind: "rule", title: `For all similar records, add a sharing rule on ${r.sobject}`, detail: "Share by owner or by criteria with a public group or role they belong to.", url: setupUrl(host, "sharing") });
    if (r.record.owd?.model === "ControlledByParent") {
      notes.push("This record inherits access from its parent record: fixing access to the parent fixes this one.");
    }
  }

  const ORDER = ["user", "object", "field", "screen", "record"];
  out.sort((a, b) => ORDER.indexOf(a.problem) - ORDER.indexOf(b.problem));
  for (const p of ORDER) {
    const first = out.find((x) => x.problem === p);
    if (first) first.title = first.title.replace(/^Or (.)/, (_, c) => c.toUpperCase());
  }
  return { suggestions: out, notes };
}
