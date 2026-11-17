// Extra responses for workspace + settings screenshots (loaded after mock.js).
(() => {
  const orig = window.chrome.runtime.sendMessage;
  const W = {
    listOrgs: [{ host: "acme.my.salesforce.com", auth: "cookie" }, { host: "acme--uat.sandbox.my.salesforce.com", auth: "cookie" }],
    listObjects: [{ name: "Account", label: "Account" }, { name: "Invoice__c", label: "Invoice" }],
    userOverview: { user: { name: "Ana Ruiz", username: "ana.ruiz@acme.com", isActive: true, profileName: "Sales User", roleName: "Sales Rep West", userType: "Standard" },
      sources: [{ kind: "profile", label: "Sales User" }, { kind: "permset", label: "Lightning Console" }, { kind: "group", label: "Finance Bundle", via: ["Revenue Fields"] }],
      expired: [{ label: "Q3 Temp Access" }], groups: [{ name: "West Sales", type: "Public group" }, { name: "Tier 2 Support", type: "Queue" }], notes: [],
      systemPerms: [
        { name: "PermissionsExportReport", label: "Export Reports", sensitive: true, by: ["Sales User"] },
        { name: "PermissionsApiEnabled", label: "API Enabled", sensitive: true, by: ["Sales User", "Lightning Console"] },
        { name: "PermissionsEditTask", label: "Edit Tasks", sensitive: false, by: ["Sales User"] }],
      objects: [
        { sobject: "Account", read: true, create: true, edit: true, delete: false, viewAll: false, modifyAll: false, by: ["Sales User"] },
        { sobject: "Contact", read: true, create: true, edit: true, delete: false, viewAll: false, modifyAll: false, by: ["Sales User"] },
        { sobject: "Invoice__c", read: true, create: false, edit: false, delete: false, viewAll: true, modifyAll: false, by: ["Finance Bundle"] },
        { sobject: "Opportunity", read: true, create: true, edit: true, delete: true, viewAll: false, modifyAll: false, by: ["Sales User"] }] },
    audit: [
      { id: "power-users", title: "Users with powerful system permissions", description: "Active users with Modify All Data, View All Data, Manage Users, Author Apex or Customize Application.", columns: ["User", "Username", "Profile", "Permissions", "Granted by"],
        rows: [["Marta Gómez", "marta@acme.com", "System Administrator", "Modify All Data, View All Data, Manage Users", "Profile: System Administrator"], ["Integration User", "int@acme.com", "Integration", "View All Data", "Permission set: ETL Access"]], status: "ok" },
      { id: "modify-all-objects", title: "Modify All / View All on objects", description: "Profiles and permission sets that bypass sharing on specific objects.", columns: ["Granted by"], rows: [], status: "ok" },
      { id: "unassigned-permsets", title: "Permission sets nobody uses", description: "No active users assigned and not in any group.", columns: ["Permission set", "API name", "Created", "Last modified"], rows: [["Legacy Access", "Legacy_Access", "2021-03-01", "2022-07-12"]], status: "ok" },
      { id: "expiring", title: "Assignments expiring in the next 30 days", description: "Temporary access that's about to end.", columns: ["User"], rows: [], status: "error", error: "No such column 'ExpirationDate' on entity 'PermissionSetAssignment'" },
      { id: "dormant-users", title: "Active users who haven't logged in for 90+ days", description: "Internal users holding a license without using it.", columns: ["User", "Username", "Profile", "Last login", "Created"], rows: [["Pablo Díaz", "pablo@acme.com", "Sales User", "Never", "2025-02-11"]], status: "ok" }],
    docs: { summary: { label: "Invoice", sobject: "Invoice__c", fields: 24, recordTypes: 2, triggers: 1, flows: 3, validationRules: 2, workflowRules: 0, notes: [] },
      mermaid: 'flowchart TD\n  save(["Save Invoice"])\n  subgraph s0 ["1. Before-save flows"]\n    s0_0["Flow: Set Status (create or update)"]\n  end\n  save --> s0\n  s0 --> commit(["Commit"])', markdown: "#", html: "<html>" },
    compareOrgs: { a: "acme.my.salesforce.com", b: "acme--uat.sandbox.my.salesforce.com", sobject: "Invoice__c", markdown: "#", sections: [
      { key: "fields", title: "Fields", status: "ok", onlyA: [], onlyB: ["Discount__c"], changed: [{ name: "Amount__c", details: ["required: no → yes", "helpText: — → Total incl. tax"] }], total: 24 },
      { key: "flows", title: "Flows (definition and active status; flow contents aren't compared)", status: "ok", onlyA: [], onlyB: [], changed: [{ name: "Notify_Finance", details: ["active: yes → no"] }], total: 31 },
      { key: "layouts", title: "Page layouts (names only)", status: "ok", onlyA: [], onlyB: [], changed: [], total: 2 },
      { key: "apexClasses", title: "Apex classes", status: "error", error: "acme--uat.sandbox.my.salesforce.com: Session expired or invalid" }] },
  };
  window.chrome.runtime.sendMessage = (m, cb) => W[m.type] ? setTimeout(() => cb({ ok: true, data: W[m.type], meta: { calls: 14, cached: 1, orgUsage: "api-usage=1840/15000" } }), 60) : orig(m, cb);
  window.chrome.runtime.openOptionsPage = () => {};
  window.chrome.identity = { getRedirectURL: (p) => `https://kfjhgdlmnbcoakpqrstuv.chromiumapp.org/${p}` };
  window.chrome.storage.session = { get: async () => ({}), set: async () => {}, remove: async () => {} };
})();
