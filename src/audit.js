// Org-wide permission audit. Every section is independent: if one query fails, that section
// reports the error and the rest still run.
//
// Each section: { id, title, description, columns, rows: string[][], status: "ok" | "error", error? }

const POWER_PERMS = [
  ["PermissionsModifyAllData", "Modify All Data"],
  ["PermissionsViewAllData", "View All Data"],
  ["PermissionsManageUsers", "Manage Users"],
  ["PermissionsAuthorApex", "Author Apex"],
  ["PermissionsCustomizeApplication", "Customize Application"],
];

const day = (d) => (d ? String(d).slice(0, 10) : "");

async function section(meta, fn) {
  try { return { ...meta, status: "ok", rows: await fn() }; }
  catch (e) { return { ...meta, status: "error", error: e.message || String(e), rows: [] }; }
}

// Permission sets (including profiles' and groups' aggregates) and active assignment counts.
// Shared by several sections.
export async function loadPermSetContext(client) {
  const [permSets, groups, counts, components] = await Promise.all([
    client.query(
      "SELECT Id, Name, Label, IsOwnedByProfile, IsCustom, Profile.Name, Profile.UserLicense.Name, " +
      "NamespacePrefix, PermissionSetGroupId, CreatedDate, LastModifiedDate FROM PermissionSet"),
    client.query("SELECT Id, MasterLabel FROM PermissionSetGroup"),
    client.query(
      "SELECT PermissionSetId, COUNT(Id) n FROM PermissionSetAssignment " +
      "WHERE Assignee.IsActive = true GROUP BY PermissionSetId"),
    client.query("SELECT PermissionSetId FROM PermissionSetGroupComponent"),
  ]);
  const groupLabel = new Map(groups.map((g) => [g.Id, g.MasterLabel]));
  const activeCount = new Map(counts.map((c) => [c.PermissionSetId, c.n ?? c.expr0 ?? 0]));
  const inGroup = new Set(components.map((c) => c.PermissionSetId));
  const byId = new Map(permSets.map((p) => [p.Id, p]));
  const label = (p) => {
    if (!p) return "?";
    if (p.IsOwnedByProfile) return `Profile: ${p.Profile?.Name ?? p.Label}`;
    if (p.PermissionSetGroupId) return `Group: ${groupLabel.get(p.PermissionSetGroupId) ?? p.Label}`;
    return `Permission set: ${p.Label}`;
  };
  return { permSets, byId, activeCount, inGroup, label };
}

export async function runAudit(client) {
  /** @type {{ok: boolean, v?: any, e?: any}} */
  const ctxResult = await loadPermSetContext(client).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  const needCtx = (fn) => async () => {
    if (!ctxResult.ok) throw new Error(`Couldn't load permission sets: ${ctxResult.e.message}`);
    return fn(ctxResult.v);
  };

  return Promise.all([
    section({
      id: "power-users",
      title: "Users with powerful system permissions",
      description: "Active users with Modify All Data, View All Data, Manage Users, Author Apex or Customize Application, and where each one comes from.",
      columns: ["User", "Username", "Profile", "Permissions", "Granted by"],
    }, async () => {
      const cond = POWER_PERMS.map(([f]) => `PermissionSet.${f} = true`).join(" OR ");
      const rows = await client.query(
        `SELECT AssigneeId, Assignee.Name, Assignee.Username, Assignee.Profile.Name, ` +
        `PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Profile.Name, PermissionSetGroup.MasterLabel, ` +
        `${POWER_PERMS.map(([f]) => `PermissionSet.${f}`).join(", ")} ` +
        `FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND (${cond})`);
      const users = new Map();
      for (const r of rows) {
        const u = users.get(r.AssigneeId) ?? { r, perms: new Set(), from: new Set() };
        POWER_PERMS.forEach(([f, name]) => { if (r.PermissionSet?.[f]) u.perms.add(name); });
        u.from.add(r.PermissionSet?.IsOwnedByProfile ? `Profile: ${r.PermissionSet.Profile?.Name}`
          : r.PermissionSetGroup ? `Group: ${r.PermissionSetGroup.MasterLabel}` : `Permission set: ${r.PermissionSet?.Label}`);
        users.set(r.AssigneeId, u);
      }
      return [...users.values()]
        .sort((a, b) => b.perms.size - a.perms.size || a.r.Assignee.Name.localeCompare(b.r.Assignee.Name))
        .map((u) => [u.r.Assignee.Name, u.r.Assignee.Username, u.r.Assignee.Profile?.Name ?? "", [...u.perms].join(", "), [...u.from].join("; ")]);
    }),

    section({
      id: "modify-all-objects",
      title: "Modify All / View All on objects",
      description: "Profiles and permission sets that bypass sharing on specific objects, and how many active users have them.",
      columns: ["Granted by", "Modify All", "View All only", "Active users"],
    }, needCtx(async (ctx) => {
      const rows = await client.query(
        "SELECT ParentId, SobjectType, PermissionsModifyAllRecords, PermissionsViewAllRecords FROM ObjectPermissions " +
        "WHERE PermissionsModifyAllRecords = true OR PermissionsViewAllRecords = true");
      const by = new Map();
      for (const r of rows) {
        const e = by.get(r.ParentId) ?? { modify: [], view: [] };
        (r.PermissionsModifyAllRecords ? e.modify : e.view).push(r.SobjectType);
        by.set(r.ParentId, e);
      }
      return [...by.entries()]
        .map(([id, e]) => [ctx.label(ctx.byId.get(id)), e.modify.sort().join(", "), e.view.sort().join(", "), String(ctx.activeCount.get(id) ?? 0)])
        .sort((a, b) => Number(b[3]) - Number(a[3]));
    })),

    section({
      id: "unassigned-permsets",
      title: "Permission sets nobody uses",
      description: "Custom permission sets with no active users assigned and not included in any permission set group. Candidates for cleanup.",
      columns: ["Permission set", "API name", "Created", "Last modified"],
    }, needCtx(async (ctx) => ctx.permSets
      .filter((p) => !p.IsOwnedByProfile && !p.PermissionSetGroupId && !p.NamespacePrefix && p.IsCustom !== false)
      .filter((p) => !ctx.activeCount.get(p.Id) && !ctx.inGroup.has(p.Id))
      .sort((a, b) => a.Label.localeCompare(b.Label))
      .map((p) => [p.Label, p.Name, day(p.CreatedDate), day(p.LastModifiedDate)]))),

    section({
      id: "unused-profiles",
      title: "Profiles with no active users",
      description: "Standard profiles can't be deleted; custom ones can.",
      columns: ["Profile", "License", "Custom"],
    }, needCtx(async (ctx) => ctx.permSets
      .filter((p) => p.IsOwnedByProfile && !ctx.activeCount.get(p.Id))
      .sort((a, b) => Number(b.IsCustom) - Number(a.IsCustom) || (a.Profile?.Name ?? "").localeCompare(b.Profile?.Name ?? ""))
      .map((p) => [p.Profile?.Name ?? p.Label, p.Profile?.UserLicense?.Name ?? "", p.IsCustom ? "Yes" : "No"]))),

    section({
      id: "duplicate-permsets",
      title: "Possible duplicate permission sets",
      description: "Custom permission sets with exactly the same object permissions. Field and system permissions aren't compared, so review before merging.",
      columns: ["Permission sets", "Objects"],
    }, needCtx(async (ctx) => {
      const candidates = new Set(ctx.permSets
        .filter((p) => !p.IsOwnedByProfile && !p.PermissionSetGroupId && !p.NamespacePrefix)
        .map((p) => p.Id));
      const rows = await client.query(
        "SELECT ParentId, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, " +
        "PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE Parent.IsOwnedByProfile = false");
      return duplicateGroups(rows.filter((r) => candidates.has(r.ParentId)))
        .map((ids) => [ids.map((id) => ctx.byId.get(id)?.Label ?? id).join(", "), String(rows.filter((r) => r.ParentId === ids[0]).length)]);
    })),

    section({
      id: "expiring",
      title: "Assignments expiring in the next 30 days",
      description: "Temporary access that's about to end.",
      columns: ["User", "Username", "Assigned", "Expires"],
    }, async () => (await client.query(
      "SELECT Assignee.Name, Assignee.Username, PermissionSet.Label, PermissionSetGroup.MasterLabel, ExpirationDate " +
      "FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND ExpirationDate = NEXT_N_DAYS:30 ORDER BY ExpirationDate"))
      .map((r) => [r.Assignee.Name, r.Assignee.Username, r.PermissionSetGroup?.MasterLabel ?? r.PermissionSet?.Label ?? "", day(r.ExpirationDate)])),

    section({
      id: "dormant-users",
      title: "Active users who haven't logged in for 90+ days",
      description: "Internal users holding a license without using it. Includes users who never logged in.",
      columns: ["User", "Username", "Profile", "Last login", "Created"],
    }, async () => (await client.query(
      "SELECT Name, Username, Profile.Name, LastLoginDate, CreatedDate FROM User " +
      "WHERE IsActive = true AND UserType = 'Standard' AND (LastLoginDate < LAST_N_DAYS:90 OR LastLoginDate = null) " +
      "ORDER BY LastLoginDate NULLS FIRST LIMIT 2000"))
      .map((u) => [u.Name, u.Username, u.Profile?.Name ?? "", day(u.LastLoginDate) || "Never", day(u.CreatedDate)])),
  ]);
}

// Groups of permission set Ids whose object permissions are identical (at least one object).
export function duplicateGroups(objectPermRows) {
  const FLAGS = ["PermissionsRead", "PermissionsCreate", "PermissionsEdit", "PermissionsDelete", "PermissionsViewAllRecords", "PermissionsModifyAllRecords"];
  const perPs = new Map();
  for (const r of objectPermRows) {
    if (!perPs.has(r.ParentId)) perPs.set(r.ParentId, []);
    perPs.get(r.ParentId).push(`${r.SobjectType}:${FLAGS.map((f) => (r[f] ? 1 : 0)).join("")}`);
  }
  const byPrint = new Map();
  for (const [id, entries] of perPs) {
    const print = entries.sort().join("|");
    if (!byPrint.has(print)) byPrint.set(print, []);
    byPrint.get(print).push(id);
  }
  return [...byPrint.values()].filter((ids) => ids.length > 1);
}
