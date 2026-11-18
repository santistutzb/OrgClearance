// Mock chrome API + realistic data for screenshots.
window.__sent = [];
const ana = { id: "005A", name: "Ana Ruiz", username: "ana.ruiz@acme.com", isActive: true, profileName: "Sales User", roleName: "Sales Rep West" };
const bob = { id: "005B", name: "Bruno Pérez", username: "bruno.perez@acme.com", isActive: true, profileName: "Sales User", roleName: "Sales Manager" };
const R = {
  resolveObject: "Account",
  recordContext: { sobject: "Account", label: "Account", title: "Acme Retail Group", recordId: "001000000000001AAA" },
  listFields: [{ name: "Industry", label: "Industry" }, { name: "AnnualRevenue", label: "Annual Revenue" }],
  searchUsers: [ana, bob, { id: "005C", name: "Ana Torres", username: "atorres@acme.com", isActive: false, profileName: "Support", roleName: null }],
  explain: (m) => m.params.userId === "005A" ? {
    user: ana, sobject: "Account", field: "AnnualRevenue",
    verdict: { status: "no", reasons: ["No profile or permission set grants read on field AnnualRevenue.", "Sharing doesn't give access to this record."] },
    object: { status: "yes", readBy: [{ kind: "profile", label: "Sales User" }], createBy: [{ label: "Sales User" }], editBy: [{ label: "Sales User" }], deleteBy: [], viewAllBy: [], modifyAllBy: [], muted: [] },
    fieldAccess: { status: "no", readBy: [], muted: [{ group: "Finance Bundle", components: ["Revenue Fields"], outdated: false }] },
    record: { status: "no", maxAccessLevel: "None", owd: { audience: "internal", label: "Private" }, reasons: [], notes: [] },
    screen: { status: "no", layout: { id: "00h1", name: "Account (Sales) Layout", url: "https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/PageLayouts/00h1/view" },
      recordType: { id: "0121", name: "Retail" }, onLayout: false, behavior: null,
      pages: [{ id: "0M01", name: "Account Record Page", url: "https://acme.lightning.force.com/visualEditor/appBuilder.app?id=0M01", usesDynamicForms: false, usesLayout: true, hasField: null, conditional: false }],
      notes: [] },
    sources: [{ kind: "profile", label: "Sales User" }, { kind: "permset", label: "Lightning Console" }, { kind: "group", label: "Finance Bundle", via: [] }], expired: [{ label: "Q3 Temp Access" }],
    suggestions: [
      { kind: "unmute", title: "Stop muting AnnualRevenue in Finance Bundle", detail: "Revenue Fields inside the group grants it, but the group's muting permission set removes it. Only change this if the mute isn't intentional.", url: "https://acme.lightning.force.com/lightning/setup/PermSetGroups/page?address=%2F0PG1" },
      { kind: "edit", title: "Or give read on AnnualRevenue in Lightning Console", detail: "They already have this permission set. Everyone else assigned to it gets the same access.", url: "https://acme.lightning.force.com/lightning/setup/PermSets/page?address=%2F0PS2" },
      { kind: "share", title: "Share this record with them", detail: "Use Sharing on the record. Quickest for one record; it doesn't cover similar records.", url: "https://acme.lightning.force.com/lightning/r/001000000000001AAA/view" },
      { kind: "rule", title: "For all similar records, add a sharing rule on Account", detail: "Share by owner or by criteria with a public group or role they belong to.", url: null }],
    suggestionNotes: [],
    fixGroups: [
      { key: "field", title: "Read on the AnnualRevenue field", items: [
        { kind: "unmute", title: "Stop muting AnnualRevenue in Finance Bundle", detail: "Revenue Fields inside the group grants it, but the group's muting permission set removes it. Only change this if the mute isn't intentional.", url: "https://acme.lightning.force.com/lightning/setup/PermSetGroups/page?address=%2F0PG1" },
        { kind: "edit", title: "Or give read on AnnualRevenue in Lightning Console", detail: "They already have this permission set. Everyone else assigned to it gets the same access.", url: "https://acme.lightning.force.com/lightning/setup/PermSets/page?address=%2F0PS2" }] },
      { key: "screen", title: "Showing the field on their page", items: [
        { kind: "layout", title: "Add AnnualRevenue to the Account (Sales) Layout page layout", detail: "It's the layout their profile gets for this record type. Everyone using that layout will see the field.", url: "https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/PageLayouts/00h1/view" },
        { kind: "layout", title: "Or assign their profile a page layout that already has it", detail: "Use Page Layout Assignment on this object.", url: null }] },
      { key: "record", title: "Access to this record", items: [
        { kind: "share", title: "Share this record with them", detail: "Use Sharing on the record. Quickest for one record; it doesn't cover similar records.", url: "https://acme.lightning.force.com/lightning/r/001000000000001AAA/view" },
        { kind: "rule", title: "For all similar records, add a sharing rule on Account", detail: "Share by owner or by criteria with a public group or role they belong to.", url: null }] }],
    ticket: "Access check: Ana Ruiz (ana.ruiz@acme.com) on the AnnualRevenue field on Account 001000000000001AAA\nResult: Can't see it",
  } : {
    user: bob, sobject: "Account", field: "AnnualRevenue", verdict: { status: "yes", reasons: [] },
    object: { status: "yes", readBy: [{ kind: "profile", label: "Sales User" }], createBy: [], editBy: [], deleteBy: [], viewAllBy: [], modifyAllBy: [] },
    fieldAccess: { status: "yes", readBy: [{ kind: "permset", label: "Revenue Fields" }] },
    record: { status: "yes", maxAccessLevel: "Read", owd: { audience: "internal", label: "Private" }, reasons: [{ text: "Role Sales Manager is above the owner's role (Sales Rep East)" }, { text: "Sharing rule (Read, via group West Sales)" }], notes: [] },
    screen: { status: "yes", layout: { id: "00h2", name: "Account (Managers) Layout", url: "https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/PageLayouts/00h2/view" },
      recordType: { id: "0121", name: "Retail" }, onLayout: true, behavior: "Readonly",
      pages: [{ id: "0M02", name: "Manager Record Page", url: "https://acme.lightning.force.com/visualEditor/appBuilder.app?id=0M02", usesDynamicForms: true, usesLayout: false, hasField: true, conditional: false }],
      notes: ["It's read-only on their layout, even if field-level security allows editing."] },
    sources: [{ kind: "profile", label: "Sales User" }, { kind: "permset", label: "Revenue Fields" }], expired: [],
  },
  fieldMatrix: { user: ana, sobject: "Account", status: "ok", object: { status: "yes" }, fields: [
    { name: "AnnualRevenue", label: "Annual Revenue", access: "none", readBy: [], editBy: [], muted: true },
    { name: "Industry", label: "Industry", access: "edit", readBy: ["Sales User"], editBy: ["Sales User"] },
    { name: "Name", label: "Account Name", access: "always", readBy: [], editBy: [] },
    { name: "Rating", label: "Rating", access: "read", readBy: ["Sales User"], editBy: [] },
    { name: "Region__c", label: "Region", access: "read", readBy: ["Lightning Console"], editBy: [] }] },
  compare: () => ({
    a: { user: ana, object: { status: "yes" }, fieldAccess: { status: "no" }, record: { status: "no" } },
    b: { user: bob, object: { status: "yes" }, fieldAccess: { status: "yes" }, record: { status: "yes" } },
    differences: [
      { check: "Field", a: "no", b: "yes", explanation: "Bruno Pérez gets it from Revenue Fields, which Ana Ruiz doesn't have." },
      { check: "Record", a: "no", b: "yes", explanation: "Bruno Pérez: Role Sales Manager is above the owner's role (Sales Rep East)." }],
    onlyA: [{ kind: "permset", label: "Lightning Console" }], onlyB: [{ kind: "permset", label: "Revenue Fields" }], common: [{ kind: "profile", label: "Sales User" }],
  }),
  whoCanSee: (m) => ({ sobject: "Account", field: m.params.field || null, recordId: "001000000000001AAA", total: 3,
    record: m.params.checkRecord ? { status: "checked", checked: 4, withAccess: 3, failed: 0 } : { status: "skipped" },
    users: [
      { id: "005B", name: "Bruno Pérez", username: "bruno.perez@acme.com", profileName: "Sales User", userType: "Standard", objectVia: ["Profile: Sales User"], fieldVia: ["Permission set: Revenue Fields"], recordAccess: m.params.checkRecord ? "Read" : undefined },
      { id: "005C", name: "Carla Owens", username: "carla@acme.com", profileName: "Support", userType: "Standard", objectVia: ["Profile: Support"], fieldVia: ["Group: Finance Bundle"], recordAccess: m.params.checkRecord ? "Edit" : undefined },
      { id: "005D", name: "Dario Admin", username: "dario@acme.com", profileName: "Minimum Access", userType: "Standard", objectVia: ["Permission set: Admin Tools (View All Data)"], fieldVia: ["Permission set: Revenue Fields"], recordAccess: m.params.checkRecord ? "All" : undefined }],
    notes: [] }),
  timeline: { events: [
    { at: "2026-11-16T14:20:00Z", who: "Bruno Pérez", kind: "field", text: "Rating: Warm → Hot" },
    { at: "2026-11-12T10:05:00Z", who: "Ana Ruiz", kind: "activity", text: "Call: Pricing follow-up [Completed]" },
    { at: "2026-11-02T09:00:00Z", who: "Ana Ruiz", kind: "field", text: "Industry: (empty) → Retail" },
    { at: "2026-10-30T16:45:00Z", who: "Integration User", kind: "created", text: "Record created" }], notes: ["Changes are only recorded for fields with history tracking turned on."] },
  scanLogs: { scanned: 20, failed: 0, matches: [{ at: "2026-11-16T14:20:00Z", user: "Bruno Pérez", operation: "/aura", status: "Success", flows: ["Account: Set Region"], triggers: ["AccountTrigger on Account trigger event BeforeUpdate"], validations: ["Revenue_Positive"], failures: [], errors: [] }] },
};
const store = { "recent:acme.my.salesforce.com": [ana, bob] };
window.chrome = {
  runtime: {
    lastError: null, id: "x", getURL: (p) => new URL("../orgclearance/" + p, location.href).href,
    onMessage: { addListener() {} }, openOptionsPage() {},
    sendMessage: (m, cb) => { window.__sent.push(m); const r = R[m.type]; setTimeout(() => cb({ ok: true, data: typeof r === "function" ? r(m) : r, meta: { calls: 9, cached: 2, orgUsage: "api-usage=1840/15000" } }), 60); },
  },
  storage: { local: { get: async (k) => (k in store ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o) } },
};
