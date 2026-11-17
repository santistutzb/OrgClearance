// @ts-check
// "What can this user do in the whole org?": system permissions, object access on every object,
// groups, queues and role, each with the profile / permission set / group that grants it.

import { getUser, loadSources, userGroups, permRows, whoGrants, attempt } from "./access.js";
import { queryIn } from "./api.js";

const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

// Shown first: permissions auditors ask about.
export const SENSITIVE = new Set([
  "PermissionsModifyAllData", "PermissionsViewAllData", "PermissionsManageUsers", "PermissionsAuthorApex",
  "PermissionsCustomizeApplication", "PermissionsManageProfilesPermissionsets", "PermissionsAssignPermissionSets",
  "PermissionsManageSharing", "PermissionsManageRoles", "PermissionsResetPasswords", "PermissionsExportReport",
  "PermissionsManageDataIntegrations", "PermissionsApiEnabled", "PermissionsViewSetup", "PermissionsModifyMetadata",
  "PermissionsManageInternalUsers", "PermissionsBulkApiHardDelete", "PermissionsTransferAnyEntity",
]);

const FLAGS = [
  ["read", "PermissionsRead"], ["create", "PermissionsCreate"], ["edit", "PermissionsEdit"],
  ["delete", "PermissionsDelete"], ["viewAll", "PermissionsViewAllRecords"], ["modifyAll", "PermissionsModifyAllRecords"],
];

/** @param {any} client @param {{userId: string}} p */
export async function userOverview(client, { userId }) {
  if (!ID_RE.test(userId || "")) throw new Error("Invalid user");
  const user = await getUser(client, userId);
  const src = await loadSources(client, userId);
  const ids = src.active.map((s) => s.id);
  const label = new Map(src.active.map((s) => [s.id, s.label]));
  const notes = [];

  // System permissions: every boolean Permissions* field on PermissionSet, queried in batches
  // so the SOQL stays under URL limits.
  let systemPerms = [];
  const desc = await attempt(() => client.describe("PermissionSet"));
  if (desc.ok && ids.length) {
    const fields = desc.value.fields.filter((f) => f.type === "boolean" && /^Permissions/.test(f.name));
    const byPs = new Map();
    for (let i = 0; i < fields.length; i += 80) {
      const batch = fields.slice(i, i + 80);
      const rows = await attempt(() => queryIn((q) => client.query(q),
        (list) => `SELECT Id, ${batch.map((f) => f.name).join(", ")} FROM PermissionSet WHERE Id IN (${list})`, ids));
      if (!rows.ok) { notes.push(`Some system permissions couldn't be read: ${rows.error}`); continue; }
      for (const r of rows.value) byPs.set(r.Id, { ...(byPs.get(r.Id) ?? {}), ...r });
    }
    systemPerms = fields
      .map((f) => ({ name: f.name, label: f.label, sensitive: SENSITIVE.has(f.name),
        by: ids.filter((id) => byPs.get(id)?.[f.name]).map((id) => label.get(id)) }))
      .filter((p) => p.by.length)
      .sort((a, b) => Number(b.sensitive) - Number(a.sensitive) || a.label.localeCompare(b.label));
  } else if (!desc.ok) {
    notes.push(`Couldn't read system permissions: ${desc.error}`);
  }

  // Object access across every object.
  let objects = [];
  const op = await permRows(client, src,
    "SELECT ParentId, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, " +
    "PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE PermissionsRead = true");
  if (op.ok) {
    const bySobject = new Map();
    for (const r of op.value) {
      if (!bySobject.has(r.SobjectType)) bySobject.set(r.SobjectType, []);
      bySobject.get(r.SobjectType).push(r);
    }
    objects = [...bySobject.entries()].map(([sobject, rows]) => {
      const o = { sobject, by: whoGrants(src, rows, "PermissionsRead").by.map((s) => s.label) };
      for (const [k, f] of FLAGS) o[k] = whoGrants(src, rows, f).by.length > 0;
      return o;
    }).filter((o) => o.read).sort((a, b) => a.sobject.localeCompare(b.sobject));
  } else {
    notes.push(`Couldn't read object permissions: ${op.error}`);
  }

  // Groups, queues and role.
  let groups = [];
  const g = await attempt(() => userGroups(client, user));
  if (g.ok && g.value.groupIds.size) {
    const rows = await attempt(() => queryIn((q) => client.query(q),
      (list) => `SELECT Id, Name, DeveloperName, Type FROM Group WHERE Id IN (${list}) AND Type IN ('Regular', 'Queue')`, [...g.value.groupIds]));
    if (rows.ok) groups = rows.value.map((r) => ({ name: r.Name || r.DeveloperName, type: r.Type === "Queue" ? "Queue" : "Public group" }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    else notes.push(`Couldn't read group names: ${rows.error}`);
  } else if (!g.ok) {
    notes.push(`Couldn't read groups: ${g.error}`);
  }

  return { user, sources: src.active, expired: src.expired, systemPerms, objects, groups, notes };
}
