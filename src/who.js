// @ts-check
// "Who can see this?" The reverse of Explain: every active user who can read an object, a field,
// and optionally one record.
//
// Object and field: exact. Find the profiles, permission sets and permission set groups that grant
// read (group aggregates already have muting applied), then who has them assigned. View All Data also
// gives read on every object. Expired assignments and inactive users are left out.
//
// Record: Salesforce only checks record access one user per query (UserRecordAccess), so that part is
// optional and capped. Above the cap we say so instead of returning a partial list as if it were complete.

import { queryIn } from "./api.js";

const NAME_RE = /^[A-Za-z0-9_]+$/;
const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
export const RECORD_CHECK_LIMIT = 100;

async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

const sourceLabel = (a) => a.PermissionSet?.IsOwnedByProfile ? `Profile: ${a.PermissionSet.Profile?.Name ?? "?"}`
  : a.PermissionSetGroup?.MasterLabel ? `Group: ${a.PermissionSetGroup.MasterLabel}` : `Permission set: ${a.PermissionSet?.Label ?? "?"}`;

/**
 * @param {any} client
 * @param {{sobject: string, field?: string|null, recordId?: string|null, checkRecord?: boolean, limit?: number, now?: number}} p
 */
export async function whoCanSee(client, { sobject, field = null, recordId = null, checkRecord = false, limit = RECORD_CHECK_LIMIT, now = Date.now() }) {
  if (!NAME_RE.test(sobject || "")) throw new Error("Invalid object");
  if (field && !NAME_RE.test(field)) throw new Error("Invalid field");
  if (recordId && !ID_RE.test(recordId)) throw new Error("Invalid record");
  const notes = [];

  // Field-level security applies only to "permissionable" fields.
  let fieldName = null;
  let fls = false;
  if (field) {
    const desc = await client.describe(sobject);
    const meta = desc.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
    if (!meta) throw new Error(`Field ${field} doesn't exist on ${sobject} (or you can't see it).`);
    fieldName = meta.name;
    fls = meta.permissionable !== false;
    if (!fls) notes.push(`${fieldName} isn't controlled by field-level security: everyone who can read ${sobject} can read it.`);
  }

  // 1. Permission sources that grant what's needed.
  const [objRows, vadRows, fieldRows] = await Promise.all([
    client.query(`SELECT ParentId FROM ObjectPermissions WHERE SobjectType = '${sobject}' AND PermissionsRead = true`),
    attempt(() => client.query("SELECT Id FROM PermissionSet WHERE PermissionsViewAllData = true")),
    fls ? client.query(`SELECT ParentId FROM FieldPermissions WHERE SobjectType = '${sobject}' AND Field = '${sobject}.${fieldName}' AND PermissionsRead = true`) : Promise.resolve([]),
  ]);
  const objectGrant = new Set(objRows.map((r) => r.ParentId));
  const viewAllData = new Set(vadRows.ok ? vadRows.value.map((r) => r.Id) : []);
  if (!vadRows.ok) notes.push(`Couldn't check View All Data: ${vadRows.error}`);
  const fieldGrant = new Set(fieldRows.map((r) => r.ParentId));

  // 2. Who has those sources assigned.
  const sourceIds = [...new Set([...objectGrant, ...viewAllData, ...fieldGrant])];
  const assignments = sourceIds.length ? await queryIn((q) => client.query(q),
    (list) => "SELECT AssigneeId, Assignee.Name, Assignee.Username, Assignee.UserType, Assignee.Profile.Name, ExpirationDate, " +
      "PermissionSetId, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Profile.Name, PermissionSetGroup.MasterLabel " +
      `FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSetId IN (${list})`, sourceIds) : [];

  const users = new Map();
  for (const a of assignments) {
    if (a.ExpirationDate && Date.parse(a.ExpirationDate) <= now) continue;
    const u = users.get(a.AssigneeId) ?? {
      id: a.AssigneeId, name: a.Assignee?.Name ?? a.AssigneeId, username: a.Assignee?.Username ?? "",
      profileName: a.Assignee?.Profile?.Name ?? null, userType: a.Assignee?.UserType ?? null, objectVia: [], fieldVia: [],
    };
    const label = sourceLabel(a);
    if (objectGrant.has(a.PermissionSetId)) u.objectVia.push(label);
    else if (viewAllData.has(a.PermissionSetId)) u.objectVia.push(`${label} (View All Data)`);
    if (fieldGrant.has(a.PermissionSetId)) u.fieldVia.push(label);
    users.set(a.AssigneeId, u);
  }

  let list = [...users.values()]
    .filter((u) => u.objectVia.length && (!fls || u.fieldVia.length))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 3. Optional: verify access to one record, one user at a time.
  let record = { status: "skipped" };
  if (recordId && checkRecord) {
    if (list.length > limit) {
      record = { status: "too-many", candidates: list.length, limit };
      notes.push(`${list.length} people can read ${sobject}${fls ? ` and ${fieldName}` : ""}. Checking this record one person at a time is capped at ${limit}, so record access wasn't checked.`);
    } else {
      let failed = 0;
      for (const u of list) {
        const ura = await attempt(() => client.query(
          `SELECT RecordId, HasReadAccess, MaxAccessLevel FROM UserRecordAccess WHERE UserId = '${u.id}' AND RecordId = '${recordId}'`));
        if (ura.ok && ura.value[0]) { u.recordAccess = ura.value[0].HasReadAccess ? ura.value[0].MaxAccessLevel : "None"; }
        else { u.recordAccess = null; failed++; }
      }
      const before = list.length;
      list = list.filter((u) => u.recordAccess !== "None");
      record = { status: "checked", checked: before, withAccess: list.filter((u) => u.recordAccess).length, failed };
      if (failed) notes.push(`Record access couldn't be verified for ${failed} ${failed === 1 ? "person" : "people"}; they're still listed.`);
    }
  }

  return { sobject, field: fieldName, recordId, total: list.length, users: list, record, notes };
}
