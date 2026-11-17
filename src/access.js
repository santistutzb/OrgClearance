// @ts-check
// "Why can (or can't) this user see this?" logic.
// Takes a `client` with query() and describe(), so it can be tested without Chrome or Salesforce.
//
// Golden rule: if a piece of data couldn't be fetched, the status is "unknown". Never guess.

import { queryIn } from "./api.js";
// Circular with suggest.js (it uses attempt from here); safe because both only call each other at runtime.
import { suggestFixes } from "./suggest.js";
import { screenCheck } from "./screen.js";

const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const NAME_RE = /^[A-Za-z0-9_]+$/;

function assertId(v, what) { if (!ID_RE.test(v || "")) throw new Error(`Invalid ${what}`); return v; }
function assertName(v, what) { if (!NAME_RE.test(v || "")) throw new Error(`Invalid ${what}`); return v; }
// Query with an IN (...) list, split into chunks for large orgs.
const qIn = (client, build, ids) => queryIn((q) => client.query(q), build, ids);
export const escapeSoql = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const USER_FIELDS = "Id, Name, Username, IsActive, UserType, UserRoleId, UserRole.Name, ProfileId, Profile.Name";
const mapUser = (u) => ({
  id: u.Id, name: u.Name, username: u.Username, isActive: u.IsActive,
  userType: u.UserType ?? null, roleId: u.UserRoleId ?? null,
  roleName: u.UserRole?.Name ?? null, profileName: u.Profile?.Name ?? null, profileId: u.ProfileId ?? null,
});

export async function searchUsers(client, term) {
  const t = escapeSoql(term.trim()).replace(/[%_]/g, "\\$&");
  if (t.length < 2) return [];
  const rows = await client.query(
    `SELECT ${USER_FIELDS} FROM User ` +
    `WHERE Name LIKE '%${t}%' OR Username LIKE '%${t}%' OR Email LIKE '%${t}%' ` +
    `ORDER BY IsActive DESC, Name LIMIT 10`
  );
  return rows.map(mapUser);
}

export async function getUser(client, userId) {
  const rows = await client.query(`SELECT ${USER_FIELDS} FROM User WHERE Id = '${assertId(userId, "user")}'`);
  if (!rows.length) throw new Error("User not found");
  return mapUser(rows[0]);
}

// ---------------------------------------------------------------------------
// Permission sources: profile, permission sets, permission set groups
// ---------------------------------------------------------------------------

// For a group assignment, PermissionSetId points to the group's aggregate permission set,
// whose permissions already have muting applied. That aggregate is the source of truth.
export async function loadSources(client, userId, now = Date.now()) {
  const rows = await client.query(
    `SELECT PermissionSetId, PermissionSet.Label, PermissionSet.IsOwnedByProfile, ` +
    `PermissionSet.Profile.Name, PermissionSetGroupId, PermissionSetGroup.MasterLabel, ` +
    `PermissionSetGroup.Status, ExpirationDate ` +
    `FROM PermissionSetAssignment WHERE AssigneeId = '${userId}'`
  );
  const active = [];
  const expired = [];
  for (const r of rows) {
    /** @type {any} */
    let s;
    if (r.PermissionSet?.IsOwnedByProfile) {
      s = { id: r.PermissionSetId, kind: "profile", label: r.PermissionSet.Profile?.Name ?? "Profile" };
    } else if (r.PermissionSetGroupId) {
      s = {
        id: r.PermissionSetId, kind: "group", label: r.PermissionSetGroup?.MasterLabel ?? "Permission set group",
        groupId: r.PermissionSetGroupId, groupStatus: r.PermissionSetGroup?.Status ?? null,
      };
    } else {
      s = { id: r.PermissionSetId, kind: "permset", label: r.PermissionSet?.Label ?? "Permission set" };
    }
    if (r.ExpirationDate) s.expiresAt = r.ExpirationDate;
    (r.ExpirationDate && Date.parse(r.ExpirationDate) <= now ? expired : active).push(s);
  }

  // Components of each group, so we can say which permission set inside it grants something.
  // Muting permission sets (Id prefix 0QM) are left out: their effect shows up in the aggregate.
  const groupIds = active.filter((s) => s.kind === "group").map((s) => s.groupId);
  let components = [];
  let componentsError = null;
  if (groupIds.length) {
    const res = await attempt(() => qIn(client, (list) =>
      `SELECT PermissionSetGroupId, PermissionSetId, PermissionSet.Label FROM PermissionSetGroupComponent ` +
      `WHERE PermissionSetGroupId IN (${list})`, groupIds));
    if (res.ok) {
      components = res.value
        .filter((c) => c.PermissionSetId?.startsWith("0PS"))
        .map((c) => ({ id: c.PermissionSetId, groupId: c.PermissionSetGroupId, label: c.PermissionSet?.Label ?? "Permission set" }));
    } else {
      componentsError = res.error;
    }
  }
  return { active, expired, components, componentsError };
}

const ref = (s) => ({ kind: s.kind, label: s.label });

// Who grants `flag` given permission rows (ObjectPermissions / FieldPermissions).
// For groups, also reports components that grant it and groups where it is muted.
export function whoGrants(src, rows, flag) {
  const granted = new Set(rows.filter((r) => r[flag]).map((r) => r.ParentId));
  const by = [];
  const muted = [];
  for (const s of src.active) {
    if (s.kind !== "group") {
      if (granted.has(s.id)) by.push(ref(s));
      continue;
    }
    const via = src.components.filter((c) => c.groupId === s.groupId && granted.has(c.id)).map((c) => c.label);
    if (granted.has(s.id)) {
      by.push({ ...ref(s), via });
    } else if (via.length) {
      // A component grants it but the group's aggregate doesn't: muted, or the group needs recalculation.
      muted.push({ group: s.label, components: via, outdated: !!s.groupStatus && s.groupStatus !== "Updated" });
    }
  }
  return { by, muted };
}

export const sourceIds = (src) => [...src.active.map((s) => s.id), ...src.components.map((c) => c.id)];

export async function permRows(client, src, soqlPrefix) {
  const ids = sourceIds(src);
  if (!ids.length) return { ok: true, value: [] };
  return attempt(() => qIn(client, (list) => `${soqlPrefix} AND ParentId IN (${list})`, ids));
}

async function objectCheck(client, src, sobject) {
  const res = await permRows(client, src,
    `SELECT ParentId, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, ` +
    `PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${sobject}'`);
  if (!res.ok) return { status: "unknown", error: res.error };
  const read = whoGrants(src, res.value, "PermissionsRead");
  return {
    status: read.by.length ? "yes" : "no",
    readBy: read.by,
    muted: read.muted,
    createBy: whoGrants(src, res.value, "PermissionsCreate").by,
    editBy: whoGrants(src, res.value, "PermissionsEdit").by,
    deleteBy: whoGrants(src, res.value, "PermissionsDelete").by,
    viewAllBy: whoGrants(src, res.value, "PermissionsViewAllRecords").by,
    modifyAllBy: whoGrants(src, res.value, "PermissionsModifyAllRecords").by,
  };
}

async function fieldCheck(client, src, sobject, field) {
  const desc = await attempt(() => client.describe(sobject));
  if (!desc.ok) return { status: "unknown", error: desc.error };
  const meta = desc.value.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
  if (!meta) return { status: "unknown", error: `Field ${field} doesn't exist on ${sobject} (or you can't see it).` };
  if (meta.permissionable === false) {
    return { status: "na", note: "This field doesn't use field-level security: it's visible whenever the object is." };
  }
  const res = await permRows(client, src,
    `SELECT ParentId, PermissionsRead, PermissionsEdit FROM FieldPermissions ` +
    `WHERE SobjectType = '${sobject}' AND Field = '${sobject}.${meta.name}'`);
  if (!res.ok) return { status: "unknown", error: res.error };
  const read = whoGrants(src, res.value, "PermissionsRead");
  return { status: read.by.length ? "yes" : "no", readBy: read.by, muted: read.muted, editBy: whoGrants(src, res.value, "PermissionsEdit").by };
}

// ---------------------------------------------------------------------------
// Record access: why (not) — owner, org-wide default, shares, role hierarchy
// ---------------------------------------------------------------------------

const OWD_LABEL = {
  Private: "Private", Read: "Public Read Only", ReadWrite: "Public Read/Write",
  ReadWriteTransfer: "Public Read/Write/Transfer", FullAccess: "Public Full Access",
  ControlledByParent: "Controlled by Parent", ControlledByCampaign: "Controlled by Campaign",
  ControlledByLeadOrContact: "Controlled by Lead or Contact",
};
const PUBLIC_OWD = new Set(["Read", "ReadWrite", "ReadWriteTransfer", "FullAccess"]);

const ROW_CAUSE = {
  Owner: "Record owner (or member of the owning queue)",
  Manual: "Manual share",
  Rule: "Sharing rule",
  GuestRule: "Guest user sharing rule",
  Team: "Team member (account/opportunity/case team)",
  Territory: "Territory assignment",
  TerritoryRule: "Territory assignment rule",
  Territory2AssociationManual: "Territory (manual association)",
  ImplicitChild: "Implicit: access to a child record (contact, opportunity or case)",
  ImplicitParent: "Implicit: owns or shares a child of this account",
  ImplicitPerson: "Implicit: person account",
  RelatedPortalUser: "Related portal user",
};

export function shareInfo(sobject) {
  if (sobject.endsWith("__c")) return { table: sobject.replace(/__c$/, "__Share"), parent: "ParentId", level: "AccessLevel" };
  return { table: `${sobject}Share`, parent: `${sobject}Id`, level: `${sobject}AccessLevel` };
}

// Groups the user belongs to: role groups (own role and every role above it),
// plus public groups and queues, following nested groups a few levels up.
export async function userGroups(client, user) {
  const groupIds = new Set();
  let parentOf = new Map();
  if (user.roleId) {
    const roles = await client.query("SELECT Id, ParentRoleId FROM UserRole");
    parentOf = new Map(roles.map((r) => [r.Id, r.ParentRoleId]));
    const chain = ancestorsOf(user.roleId, parentOf, true);
    const roleGroups = await qIn(client, (list) => `SELECT Id, Type, RelatedId FROM Group WHERE RelatedId IN (${list})`, chain);
    for (const g of roleGroups) {
      if (g.Type === "Role" && g.RelatedId === user.roleId) groupIds.add(g.Id);
      if (g.Type === "RoleAndSubordinates" || (g.Type === "RoleAndSubordinatesInternal" && user.userType === "Standard")) groupIds.add(g.Id);
    }
  }
  let frontier = [user.id, ...groupIds];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const rows = await qIn(client, (list) => `SELECT GroupId FROM GroupMember WHERE UserOrGroupId IN (${list})`, frontier);
    frontier = [...new Set(rows.map((r) => r.GroupId))].filter((id) => !groupIds.has(id));
    frontier.forEach((id) => groupIds.add(id));
  }
  return { groupIds, parentOf };
}

function ancestorsOf(roleId, parentOf, includeSelf) {
  const out = [];
  let r = includeSelf ? roleId : parentOf.get(roleId);
  while (r && !out.includes(r)) { out.push(r); r = parentOf.get(r); }
  return out;
}

async function recordCheck(client, { user, src, sobject, recordId, objectInfo }) {
  const result = { reasons: [], notes: [] };

  // 1. Salesforce's own verdict. This is the answer; the rest explains it.
  const ura = await attempt(() => client.query(
    `SELECT RecordId, HasReadAccess, HasEditAccess, HasDeleteAccess, MaxAccessLevel FROM UserRecordAccess ` +
    `WHERE UserId = '${user.id}' AND RecordId = '${recordId}'`));
  if (ura.ok && ura.value.length) {
    const r = ura.value[0];
    Object.assign(result, { status: r.HasReadAccess ? "yes" : "no", hasEdit: r.HasEditAccess, hasDelete: r.HasDeleteAccess, maxAccessLevel: r.MaxAccessLevel });
  } else {
    Object.assign(result, { status: "unknown", error: ura.ok ? "Salesforce returned no access row for this record." : ura.error });
  }

  // 2. Permissions that bypass sharing.
  const ids = src.active.map((s) => s.id);
  if (ids.length) {
    const sys = await attempt(() => qIn(client, (list) =>
      `SELECT Id, PermissionsViewAllData, PermissionsModifyAllData FROM PermissionSet WHERE Id IN (${list})`, ids));
    if (sys.ok) {
      for (const p of sys.value) {
        const s = src.active.find((x) => x.id === p.Id);
        if (p.PermissionsModifyAllData) result.reasons.push({ type: "bypass", text: `Modify All Data from ${s.label}` });
        else if (p.PermissionsViewAllData) result.reasons.push({ type: "bypass", text: `View All Data from ${s.label}` });
      }
    } else {
      result.notes.push(`Couldn't check View/Modify All Data: ${sys.error}`);
    }
  }
  for (const s of objectInfo?.modifyAllBy ?? []) result.reasons.push({ type: "bypass", text: `Modify All on this object from ${s.label}` });
  for (const s of objectInfo?.viewAllBy ?? []) {
    if (!objectInfo.modifyAllBy?.some((m) => m.label === s.label)) result.reasons.push({ type: "bypass", text: `View All on this object from ${s.label}` });
  }

  // 3. Org-wide default.
  const owd = await attempt(() => client.query(
    `SELECT InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = '${sobject}'`));
  if (owd.ok && owd.value.length) {
    const model = user.userType === "Standard" ? owd.value[0].InternalSharingModel : owd.value[0].ExternalSharingModel;
    result.owd = { model, label: OWD_LABEL[model] ?? model, audience: user.userType === "Standard" ? "internal" : "external" };
    if (PUBLIC_OWD.has(model)) result.reasons.push({ type: "owd", text: `Org-wide default is ${result.owd.label}` });
    if (model === "ControlledByParent") result.notes.push("Access to this record is inherited from its master (parent) record. Check access to the parent.");
  } else {
    result.notes.push(`Couldn't read the org-wide default: ${owd.ok ? "no result" : owd.error}`);
  }

  // 4. Owner.
  let ownerId = null;
  const own = await attempt(() => client.query(`SELECT OwnerId FROM ${sobject} WHERE Id = '${recordId}'`));
  if (own.ok && own.value.length) {
    ownerId = own.value[0].OwnerId;
    result.ownerId = ownerId;
    if (ownerId === user.id) result.reasons.push({ type: "owner", text: "Owns the record" });
  }

  // 5. Groups (needed for shares) and role hierarchy.
  const groups = await attempt(() => userGroups(client, user));
  if (!groups.ok) result.notes.push(`Couldn't load the user's groups and roles: ${groups.error}`);

  if (groups.ok && ownerId?.startsWith("005") && ownerId !== user.id && user.roleId) {
    const ownerRow = await attempt(() => client.query(`SELECT UserRoleId, UserRole.Name FROM User WHERE Id = '${ownerId}'`));
    const ownerRole = ownerRow.ok ? ownerRow.value[0]?.UserRoleId : null;
    if (ownerRole && ancestorsOf(ownerRole, groups.value.parentOf, false).includes(user.roleId)) {
      const custom = sobject.endsWith("__c");
      result.reasons.push({
        type: "hierarchy",
        text: `Role ${user.roleName ?? ""} is above the owner's role (${ownerRow.value[0].UserRole?.Name ?? "?"})` +
          (custom ? ", if \"Grant Access Using Hierarchies\" is on for this object" : ""),
      });
    }
  }

  // 6. Share rows that reach the user directly or through a group.
  if (groups.ok) {
    const { table, parent, level } = shareInfo(sobject);
    const shares = await attempt(() => client.query(
      `SELECT UserOrGroupId, ${level}, RowCause FROM ${table} WHERE ${parent} = '${recordId}'`));
    if (shares.ok) {
      const reach = new Set([user.id, ...groups.value.groupIds]);
      const groupNames = await groupLabels(client, shares.value.map((s) => s.UserOrGroupId).filter((id) => id.startsWith("00G") && reach.has(id)));
      for (const s of shares.value) {
        if (!reach.has(s.UserOrGroupId)) continue;
        if (s.RowCause === "Owner" && s.UserOrGroupId === user.id) continue; // already counted
        const via = s.UserOrGroupId === user.id ? "directly" : `via group ${groupNames.get(s.UserOrGroupId) ?? s.UserOrGroupId}`;
        result.reasons.push({ type: "share", text: `${ROW_CAUSE[s.RowCause] ?? `Apex sharing reason "${s.RowCause}"`} (${s[level]}, ${via})` });
      }
    } else {
      result.notes.push(`Couldn't read ${table}: ${shares.error}`);
    }
  }

  if (result.status === "yes" && !result.reasons.length) {
    result.notes.push("Salesforce grants access, but none of the checked mechanisms explains it (it could be territories, implicit sharing or a portal role). Not traced yet.");
  }
  return result;
}

async function groupLabels(client, ids) {
  if (!ids.length) return new Map();
  const res = await attempt(() => qIn(client, (list) => `SELECT Id, Name, DeveloperName, Type FROM Group WHERE Id IN (${list})`, ids));
  if (!res.ok) return new Map();
  return new Map(res.value.map((g) => [g.Id, g.Name || `${g.Type} ${g.DeveloperName}`]));
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function explainAccess(client, { userId, sobject, recordId, field }) {
  assertId(userId, "user");
  assertName(sobject, "object");
  if (recordId) assertId(recordId, "record");
  if (field) assertName(field, "field");

  const user = await getUser(client, userId);
  const src = await loadSources(client, userId);
  const result = {
    user, sobject, recordId: recordId || null, field: field || null,
    sources: src.active, expired: src.expired, componentsError: src.componentsError,
  };

  result.object = await objectCheck(client, src, sobject);
  result.fieldAccess = field ? await fieldCheck(client, src, sobject, field) : { status: "skipped" };
  // Is the field on the page they get? Only asked about a specific field.
  if (field && result.fieldAccess.status !== "unknown") {
    const sc = await attempt(() => screenCheck(client, { user, sobject, recordId, field: field }));
    result.screen = sc.ok ? sc.value : { status: "unknown", error: sc.error };
  } else {
    result.screen = { status: "skipped" };
  }
  result.record = recordId
    ? await recordCheck(client, { user, src, sobject, recordId, objectInfo: result.object })
    : { status: "skipped" };

  result.verdict = buildVerdict(result);

  // Read-only suggestions for the smallest change that would give access.
  result.suggestions = [];
  if (result.verdict.status === "no") {
    const fix = await attempt(() => suggestFixes(client, { result, src }));
    if (fix.ok) { result.suggestions = fix.value.suggestions; result.suggestionNotes = fix.value.notes; }
    else result.suggestionNotes = [`Couldn't work out a fix: ${fix.error}`];
  }
  return result;
}

export function buildVerdict(r) {
  const reasons = [];
  if (!r.user.isActive) reasons.push("The user is inactive and can't log in.");

  const checks = [
    ["object", r.object, `No read permission on the ${r.sobject} object.`],
    ["field", r.fieldAccess, `No profile or permission set grants read on field ${r.field}.`],
    ["record", r.record, "Sharing doesn't give access to this record."],
  ].filter(([, c]) => c && c.status !== "skipped" && c.status !== "na");

  for (const [, c, msg] of checks) {
    if (c.status !== "no") continue;
    reasons.push(msg);
    for (const m of c.muted ?? []) {
      reasons.push(m.outdated
        ? `Permission set group "${m.group}" includes it (${m.components.join(", ")}) but the group is outdated: it needs recalculation.`
        : `Permission set group "${m.group}" includes it (${m.components.join(", ")}) but mutes it.`);
    }
  }
  const unknown = checks.filter(([, c]) => c.status === "unknown");

  // Not on their page: data access may be fine, but the record page won't show the field.
  if (r.screen?.status === "no") {
    const where = r.screen.layout ? ` (${r.screen.layout.name})` : "";
    reasons.push(reasons.length
      ? `It also isn't on their page layout${where}.`
      : `They have access to ${r.field}, but it isn't on their page layout${where}, so the record page doesn't show it.`);
  }

  if (reasons.length) {
    if (r.expired?.length) reasons.push(`Expired assignments, not counted: ${r.expired.map((s) => s.label).join(", ")}.`);
    return { status: "no", reasons };
  }
  if (unknown.length) {
    return { status: "unknown", reasons: unknown.map(([name, c]) => `Couldn't verify (${name}): ${c.error}`) };
  }
  return { status: "yes", reasons: [] };
}

// Compare two users on the same object/field/record and point at the sources behind the difference.
export async function compareUsers(client, { userIdA, userIdB, sobject, recordId, field }) {
  const [a, b] = await Promise.all([
    explainAccess(client, { userId: userIdA, sobject, recordId, field }),
    explainAccess(client, { userId: userIdB, sobject, recordId, field }),
  ]);
  const key = (s) => `${s.kind}:${s.label}`;
  const keysA = new Set(a.sources.map(key));
  const keysB = new Set(b.sources.map(key));
  const onlyA = a.sources.filter((s) => !keysB.has(key(s))).map(ref);
  const onlyB = b.sources.filter((s) => !keysA.has(key(s))).map(ref);
  const common = a.sources.filter((s) => keysB.has(key(s))).map(ref);

  const differences = [];
  const pairs = [["Object", a.object, b.object], ["Field", a.fieldAccess, b.fieldAccess], ["Record", a.record, b.record]];
  for (const [name, ca, cb] of pairs) {
    if (!ca || !cb || ca.status === "skipped" || ca.status === cb.status) continue;
    const [winner, loser, wc] = ca.status === "yes" ? [a, b, ca] : cb.status === "yes" ? [b, a, cb] : [null, null, null];
    let explanation = null;
    if (winner && name !== "Record") {
      const missing = new Set((winner === a ? onlyA : onlyB).map(key));
      const from = (wc.readBy ?? []).filter((s) => missing.has(key(s))).map((s) => s.label);
      if (from.length) explanation = `${winner.user.name} gets it from ${from.join(", ")}, which ${loser.user.name} doesn't have.`;
    }
    if (winner && name === "Record") {
      const texts = wc.reasons.map((x) => x.text);
      if (texts.length) explanation = `${winner.user.name}: ${texts.join("; ")}.`;
    }
    differences.push({ check: name, a: ca.status, b: cb.status, explanation });
  }
  return { a, b, onlyA, onlyB, common, differences };
}

// Every field on the object with this user's read/edit access and where it comes from.
export async function fieldMatrix(client, { userId, sobject }) {
  assertId(userId, "user");
  assertName(sobject, "object");
  const user = await getUser(client, userId);
  const src = await loadSources(client, userId);
  const object = await objectCheck(client, src, sobject);
  const desc = await client.describe(sobject);

  const res = await permRows(client, src,
    `SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${sobject}'`);
  if (!res.ok) return { user, sobject, object, status: "unknown", error: res.error, fields: [] };

  const byField = new Map();
  for (const r of res.value) {
    const name = r.Field.slice(sobject.length + 1).toLowerCase();
    if (!byField.has(name)) byField.set(name, []);
    byField.get(name).push(r);
  }
  const fields = desc.fields.map((f) => {
    if (f.permissionable === false) return { name: f.name, label: f.label, access: "always", readBy: [], editBy: [] };
    const rows = byField.get(f.name.toLowerCase()) ?? [];
    const read = whoGrants(src, rows, "PermissionsRead");
    const edit = whoGrants(src, rows, "PermissionsEdit");
    return {
      name: f.name, label: f.label,
      access: edit.by.length ? "edit" : read.by.length ? "read" : "none",
      readBy: read.by.map((s) => s.label), editBy: edit.by.map((s) => s.label),
      muted: read.muted.length > 0,
    };
  }).sort((x, y) => x.name.localeCompare(y.name));

  return { user, sobject, object, status: "ok", fields, expired: src.expired };
}

// If the URL doesn't include the object name, derive it from the record Id prefix.
export async function resolveObject(client, recordId) {
  assertId(recordId, "record");
  const global = await client.describeGlobal();
  const hit = global.sobjects.find((s) => s.keyPrefix === recordId.slice(0, 3));
  if (!hit) throw new Error("Couldn't identify this record's object.");
  return hit.name;
}
