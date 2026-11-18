// @ts-check
// Full-page workspace for org-wide work: User overview, Audit, Docs, Orgs.
// Opened from the extension icon (Alt+Shift+W) or from the panel.
(async () => {
  const I18N = globalThis.OrgClearanceI18n;
  await I18N.ready;
  const t = (k, v) => I18N.t(k, v);
  document.documentElement.lang = I18N.getLang();
  const {
    h, icon, logo, CSS, fontFaceCss, makeSend, run, empty, notes, errorBox, statusPill, sourceList, avatar, userLine,
    download, toCsv, stamp, orgKey, userPicker,
  } = globalThis.OrgClearanceUI;

  const params = new URLSearchParams(location.search);
  const orgSelect = h("select", { "aria-label": t("Org"), id: "org" });
  const send = makeSend(() => ({ org: orgSelect.value }));
  const key = () => orgKey(orgSelect.value);
  const orgShort = () => orgSelect.value.split(".")[0];
  const app = document.getElementById("app");
  const dl = (name, text, mime) => download(document.body, name, text, mime);

  const PAGE_CSS = `
    html, body { margin: 0; height: 100%; }
    body { font-family: var(--font); font-size: 15px; line-height: 1.5; color: var(--ink); background: var(--wash); }
    .shell { display: grid; grid-template-columns: 264px 1fr; min-height: 100vh; }
    aside { background: var(--surface); border-right: 1px solid var(--line); padding: 20px 16px; display: flex; flex-direction: column; gap: 18px;
      position: sticky; top: 0; height: 100vh; box-sizing: border-box; }
    .brand { display: flex; gap: 10px; align-items: center; font-weight: 700; font-size: 17px; padding: 0 4px; }
    .orgpick label { margin-top: 0; font-size: 12px; color: var(--muted); }
    nav.side { display: grid; gap: 4px; }
    nav.side button { display: grid; grid-template-columns: 22px 1fr; gap: 2px 10px; align-items: start; text-align: left; border: 0; background: none;
      padding: 10px; border-radius: 10px; color: var(--ink); }
    nav.side button .ic { grid-row: span 2; width: 20px; height: 20px; color: var(--muted); margin-top: 1px; }
    nav.side button b { font-size: 14px; } nav.side button span.d { font-size: 12px; color: var(--muted); line-height: 1.35; }
    nav.side button:hover { background: var(--wash); }
    nav.side button[aria-current="page"] { background: var(--brand-soft); }
    nav.side button[aria-current="page"] .ic, nav.side button[aria-current="page"] b { color: var(--brand); }
    aside .foot { margin-top: auto; display: grid; gap: 4px; }
    main { padding: 32px 40px 56px; min-width: 0; }
    .content { max-width: 940px; }
    h1 { font-size: 26px; line-height: 1.2; margin: 0; font-weight: 700; letter-spacing: -0.01em; }
    .intro { color: var(--muted); margin: 6px 0 22px; max-width: 64ch; }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); padding: 20px 22px; }
    .form { max-width: 460px; }
    .form .btn-primary { width: auto; }
    .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 18px; }
    .profile { display: flex; gap: 14px; align-items: center; }
    .profile .name { font-size: 20px; font-weight: 700; }
    .section { margin-top: 26px; }
    .section > h2 { margin-bottom: 4px; }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .toolbar .search { flex: 1; min-width: 220px; max-width: 340px; }
    .toolbar .btn-primary { width: auto; margin-top: 0; }
    .tick { color: var(--yes); }
    .mermaid-src { background: var(--wash); padding: 12px; border-radius: var(--r-control); font-size: 12px; overflow: auto; max-height: 280px; }
    .no-org { max-width: 520px; margin: 12vh auto; text-align: left; }
    @media (max-width: 860px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: static; height: auto; }
      main { padding: 24px 18px 40px; }
    }
  `;

  const objectList = h("datalist", { id: "oc-objects" });
  const objectInput = () => h("input", { type: "text", list: "oc-objects", placeholder: t("e.g. Account or Invoice__c"), "aria-label": t("Object") });

  // ---------- User ----------

  const us = { picker: userPicker(send, t("Who do you want to look at?"), key), out: h("div"), data: null };
  us.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("user"), t("Show their access"));
  us.picker.onChange = () => { us.btn.disabled = !us.picker.user || !orgSelect.value; };
  us.btn.addEventListener("click", () => loadUser(us.picker.user.id));
  const loadUser = (userId) => run(send, us.btn, us.out, async () => {
    us.data = await send({ type: "userOverview", params: { userId } });
    return renderUser();
  }, t("Collecting permissions, objects and groups…"));
  us.filter = h("input", { type: "search", placeholder: t("Filter objects"), "aria-label": t("Filter objects") });
  us.filter.addEventListener("input", () => { if (us.data) us.out.querySelector(".objects")?.replaceWith(objectTable()); });
  us.out.append(empty("user", t("Pick a person"), t("You'll get every system permission, object and group they have, and the profile or permission set behind each one.")));

  const tick = (b) => (b ? h("span", { class: "tick", "aria-label": "yes" }, icon("check")) : "");
  const csvTick = (b) => (b ? t("Yes") : "");
  function objectTable() {
    const q = us.filter.value.trim().toLowerCase();
    const rows = us.data.objects.filter((o) => !q || o.sobject.toLowerCase().includes(q));
    return h("table", { class: "objects" },
      h("thead", {}, h("tr", {}, [t("Object"), t("Read"), t("Create"), t("Edit"), t("Delete"), t("View all"), t("Modify all"), t("Read granted by")].map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((o) => h("tr", {},
        h("td", { class: "api" }, o.sobject),
        ...[o.read, o.create, o.edit, o.delete, o.viewAll, o.modifyAll].map((b) => h("td", { class: "c" }, tick(b))),
        h("td", { class: "muted" }, o.by.join(", "))))));
  }

  function renderUser() {
    const d = us.data;
    const u = d.user;
    const sensitive = d.systemPerms.filter((p) => p.sensitive);
    const other = d.systemPerms.filter((p) => !p.sensitive);
    const permTable = (list) => h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, t("Permission")), h("th", {}, t("Granted by")))),
      h("tbody", {}, list.map((p) => h("tr", {}, h("td", {}, p.label), h("td", { class: "muted" }, p.by.join(", "))))));
    return [
      h("div", { class: "card section" },
        h("div", { class: "profile" }, avatar(u.name, "lg"),
          h("div", {}, h("div", { class: "name" }, u.name, u.isActive ? null : " ", u.isActive ? null : statusPill("no", t("Inactive"))),
            h("div", { class: "muted" }, `${u.username}. ${userLine(u)}.`))),
        h("div", { class: "grid2" },
          h("div", {}, h("h3", {}, t("Where their permissions come from")), sourceList(d.sources) ?? h("p", { class: "muted" }, t("None.")),
            d.expired.length ? h("p", { class: "muted small" }, t("Expired and ignored: {list}.", { list: d.expired.map((s) => s.label).join(", ") })) : null),
          h("div", {}, h("h3", {}, t("Groups and queues")),
            d.groups.length ? h("ul", {}, d.groups.map((g) => h("li", {}, `${g.name} (${t(g.type).toLowerCase()})`))) : h("p", { class: "muted" }, t("Not in any public group or queue."))))),
      h("div", { class: "section" },
        h("h2", {}, t("Sensitive system permissions")),
        h("p", { class: "muted" }, t("The ones auditors usually ask about: data export, user management, setup and code.")),
        sensitive.length ? permTable(sensitive) : h("p", { class: "muted" }, t("None of them.")),
        other.length ? h("details", { class: "group" }, h("summary", {}, h("span", { class: "grow" }, t("Other system permissions ({n})", { n: other.length })), icon("chevron")),
          h("div", { class: "body" }, permTable(other))) : null),
      h("div", { class: "section" },
        h("h2", {}, t("Objects they can read ({n})", { n: d.objects.length })),
        h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search"), us.filter),
          h("button", { class: "btn btn-secondary btn-small", onclick: () => dl(`user-objects-${u.username}-${stamp()}.csv`,
            toCsv([t("Object"), t("Read"), t("Create"), t("Edit"), t("Delete"), t("View all"), t("Modify all"), t("Read granted by")],
              d.objects.map((o) => [o.sobject, csvTick(o.read), csvTick(o.create), csvTick(o.edit), csvTick(o.delete), csvTick(o.viewAll), csvTick(o.modifyAll), o.by.join("; ")])), "text/csv") },
            icon("download"), t("Objects CSV")),
          h("button", { class: "btn btn-secondary btn-small", onclick: () => dl(`user-system-permissions-${u.username}-${stamp()}.csv`,
            toCsv([t("Permission"), t("API name"), t("Sensitive"), t("Granted by")], d.systemPerms.map((p) => [p.label, p.name, p.sensitive ? t("Yes") : "", p.by.join("; ")])), "text/csv") },
            icon("download"), t("System permissions CSV"))),
        objectTable()),
      notes(d.notes),
    ];
  }

  // ---------- Audit ----------

  const au = { out: h("div"), data: null };
  au.btn = h("button", { class: "btn btn-primary" }, icon("audit"), t("Run the audit"));
  au.csvAll = h("button", { class: "btn btn-secondary btn-small", hidden: true, onclick: () => {
    const rows = au.data.flatMap((s) => s.status === "ok" ? s.rows.map((r) => [s.title, ...r]) : []);
    const width = Math.max(...au.data.map((s) => s.columns.length));
    dl(`orgclearance-audit-${orgShort()}-${stamp()}.csv`, toCsv([t("Check"), ...Array.from({ length: width }, (_, i) => t("Column {n}", { n: i + 1 }))], rows), "text/csv");
  } }, icon("download"), t("Download all results"));
  au.btn.addEventListener("click", () => run(send, au.btn, au.out, async () => {
    au.data = await send({ type: "audit" });
    au.csvAll.hidden = false;
    const found = au.data.filter((s) => s.status === "ok" && s.rows.length).length;
    return [h("p", { class: "muted section" }, found ? t("{found} of {total} checks found something to review.", { found, total: au.data.length }) : t("Nothing to review in any check.")),
      ...au.data.map(renderAuditSection)];
  }, t("Running 7 checks. Large orgs can take a minute…")));
  au.out.append(empty("audit", t("Nothing run yet"), t("Seven read-only checks: powerful permissions, sharing bypasses, unused permission sets and profiles, duplicates, expiring access and dormant users.")));

  function renderAuditSection(s) {
    const n = s.status === "ok" ? s.rows.length : null;
    const tone = s.status === "error" ? "unknown" : n ? "no" : "yes";
    const shown = s.rows.slice(0, 200);
    return h("details", { class: "group" },
      h("summary", {}, h("span", { class: `count s-${tone}` }, n == null ? "!" : String(n)),
        h("span", { class: "grow" }, h("div", {}, s.title), h("div", { class: "muted small", style: "font-weight:400" }, s.description)), icon("chevron")),
      h("div", { class: "body" },
        s.status === "error" ? errorBox(new Error(t("This check couldn't run: {error}", { error: s.error }))) : null,
        s.status === "ok" && s.rows.length ? [
          h("table", {}, h("thead", {}, h("tr", {}, s.columns.map((c) => h("th", {}, c)))),
            h("tbody", {}, shown.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))),
          s.rows.length > shown.length ? h("p", { class: "muted small" }, t("Showing 200 of {n}. The CSV has all of them.", { n: s.rows.length })) : null,
          h("div", { class: "toolbar" }, h("button", { class: "btn btn-secondary btn-small", onclick: () => dl(`${s.id}-${orgShort()}-${stamp()}.csv`, toCsv(s.columns, s.rows), "text/csv") }, icon("download"), t("Download CSV"))),
        ] : null,
        s.status === "ok" && !s.rows.length ? h("p", { class: "muted" }, t("Nothing found.")) : null));
  }

  // ---------- Docs ----------

  const dc = { obj: objectInput(), out: h("div") };
  dc.btn = h("button", { class: "btn btn-primary" }, icon("docs"), t("Generate documentation"));
  dc.btn.addEventListener("click", () => run(send, dc.btn, dc.out, async () => {
    const sobject = dc.obj.value.trim();
    if (!sobject) throw new Error(t("Type an object's API name first, for example Account."));
    const d = await send({ type: "docs", sobject });
    const s = d.summary;
    const facts = [t("{n} fields", { n: s.fields }), t("{n} record types", { n: s.recordTypes }), t("{n} triggers", { n: s.triggers }), t("{n} record-triggered flows", { n: s.flows }), t("{n} validation rules", { n: s.validationRules }), t("{n} workflow rules", { n: s.workflowRules })];
    return [
      h("div", { class: "card section" },
        h("h2", {}, `${s.label}`), h("p", { class: "muted" }, h("span", { class: "api" }, s.sobject), `: ${facts.join(", ")}.`),
        h("div", { class: "toolbar" },
          h("button", { class: "btn btn-primary btn-small", style: "margin-top:0", onclick: () => dl(`${s.sobject}-documentation.html`, d.html, "text/html") }, icon("download"), t("Download HTML")),
          h("button", { class: "btn btn-secondary btn-small", onclick: () => dl(`${s.sobject}-documentation.md`, d.markdown, "text/markdown") }, icon("download"), t("Download Markdown")),
          h("button", { class: "btn btn-secondary btn-small", onclick: (e) => navigator.clipboard.writeText(d.mermaid).then(() => { e.currentTarget.lastChild.textContent = t("Diagram copied"); }) }, icon("copy"), t("Copy diagram"))),
        h("p", { class: "muted small" }, t("The HTML file draws the diagram and links every item to its page in Setup."))),
      h("div", { class: "section" }, h("h2", {}, t("What runs when a record is saved")), h("pre", { class: "mermaid-src" }, d.mermaid)),
      notes(s.notes),
    ];
  }, t("Reading fields and automation…")));
  dc.out.append(empty("docs", t("Pick an object"), t("You'll get a data dictionary, record types, triggers, flows and validation rules in save order, ready to share with your team.")));

  // ---------- Orgs ----------

  const og = { other: h("select", { "aria-label": t("Other org") }), obj: objectInput(), out: h("div") };
  og.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("orgs"), t("Compare orgs"));
  og.btn.addEventListener("click", () => run(send, og.btn, og.out, async () => {
    const sobject = og.obj.value.trim();
    if (!sobject) throw new Error(t("Type an object's API name first, for example Account."));
    const d = await send({ type: "compareOrgs", otherOrg: og.other.value, sobject });
    const total = d.sections.reduce((n, s) => n + (s.status === "ok" ? s.onlyA.length + s.onlyB.length + s.changed.length : 0), 0);
    return [
      h("div", { class: "toolbar section" },
        h("p", { class: "muted", style: "margin:0;flex:1" }, total ? t("{n} differences between {a} and {b}. Changes read from the first org to the second.", { n: total, a: d.a, b: d.b }) : t("No differences found between {a} and {b}.", { a: d.a, b: d.b })),
        h("button", { class: "btn btn-secondary btn-small", onclick: () => dl(`org-compare-${d.sobject}-${stamp()}.md`, d.markdown, "text/markdown") }, icon("download"), t("Download report"))),
      ...d.sections.map((s) => {
        const n = s.status === "ok" ? s.onlyA.length + s.onlyB.length + s.changed.length : null;
        return h("details", { class: "group" },
          h("summary", {}, h("span", { class: `count s-${s.status === "error" ? "unknown" : n ? "read" : "yes"}` }, n == null ? "!" : String(n)), h("span", { class: "grow" }, s.title), icon("chevron")),
          h("div", { class: "body" },
            s.status === "error" ? errorBox(new Error(t("Couldn't compare this part: {error}", { error: s.error }))) : null,
            s.status === "ok" && !n ? h("p", { class: "muted" }, t("Same in both orgs ({n} compared).", { n: s.total })) : null,
            s.onlyA?.length ? [h("h3", {}, t("Only in {org}", { org: d.a })), h("ul", {}, s.onlyA.map((x) => h("li", {}, x)))] : null,
            s.onlyB?.length ? [h("h3", {}, t("Only in {org}", { org: d.b })), h("ul", {}, s.onlyB.map((x) => h("li", {}, x)))] : null,
            s.changed?.length ? [h("h3", {}, t("Different")), h("ul", {}, s.changed.map((c) => h("li", {}, h("b", {}, c.name), h("div", { class: "muted small" }, c.details.join("; ")))))] : null));
      }),
    ];
  }, t("Reading both orgs…")));
  og.out.append(empty("orgs", t("Pick an org and an object"), t("Fields, validation rules, record types, layouts, permissions, flows and Apex are compared. Run it before a deploy.")));

  // ---------- shell ----------

  const pages = {
    User: { icon: "user", desc: t("Everything one person can do"), title: t("What can this person do?"), intro: t("System permissions, object access and groups for one user, each with the profile or permission set that grants it."),
      body: h("div", {}, h("div", { class: "card form" }, us.picker.el, us.btn), us.out) },
    Audit: { icon: "audit", desc: t("Access that's too broad or unused"), title: t("Permission audit"), intro: t("Find access that's broader than it should be, permissions nobody uses, and accounts nobody logs into. Nothing is changed."),
      body: h("div", {}, h("div", { class: "toolbar" }, au.btn, au.csvAll), au.out) },
    Docs: { icon: "docs", desc: t("Document an object and its automation"), title: t("Object documentation"), intro: t("A shareable page for one object: fields, record types and every automation that runs when a record is saved."),
      body: h("div", {}, h("div", { class: "card form" }, h("label", { style: "margin-top:0" }, t("Object")), dc.obj, dc.btn), dc.out) },
    Orgs: { icon: "orgs", desc: t("Sandbox vs production"), title: t("Compare two orgs"), intro: t("See what's different between the org selected on the left and another one you're logged into, before you deploy."),
      body: h("div", {}, h("div", { class: "card form" }, h("label", { style: "margin-top:0" }, t("Compare with")), og.other, h("label", {}, t("Object")), og.obj, og.btn), og.out) },
  };
  const titleEl = h("h1", {});
  const introEl = h("p", { class: "intro" });
  const navButtons = Object.entries(pages).map(([name, p]) =>
    h("button", { "data-name": name, onclick: () => select(name) }, icon(p.icon), h("b", {}, t(name)), h("span", { class: "d" }, p.desc)));
  function select(name) {
    navButtons.forEach((b) => (b.dataset.name === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    Object.entries(pages).forEach(([n, p]) => { p.body.hidden = n !== name; });
    titleEl.textContent = pages[name].title;
    introEl.textContent = pages[name].intro;
  }

  let orgs = [];
  function refreshOtherOrgs() {
    const others = orgs.filter((o) => o.host !== orgSelect.value);
    og.other.replaceChildren(...(others.length
      ? others.map((o) => h("option", { value: o.host }, `${o.host}${o.auth === "oauth" ? " (OAuth)" : ""}`))
      : [h("option", { value: "" }, t("No other org yet: log into it in another tab"))]));
    og.btn.disabled = !others.length;
  }
  async function onOrgChange() {
    refreshOtherOrgs();
    us.picker.clear(); us.picker.onChange();
    au.csvAll.hidden = true;
    objectList.replaceChildren();
    if (!orgSelect.value) return;
    try {
      const objs = await send({ type: "listObjects" });
      objectList.replaceChildren(...objs.map((o) => h("option", { value: o.name, label: o.label })));
    } catch (e) { us.out.replaceChildren(errorBox(e)); }
  }
  orgSelect.addEventListener("change", onOrgChange);

  document.head.append(h("style", {}, fontFaceCss("") + CSS + PAGE_CSS));
  const shell = h("div", { class: "shell" },
    h("aside", {},
      h("div", { class: "brand" }, logo(30), "OrgClearance"),
      h("div", { class: "orgpick" }, h("label", { for: "org" }, t("Org")), orgSelect),
      h("nav", { class: "side", "aria-label": t("Tools") }, navButtons),
      h("div", { class: "foot" },
        h("button", { class: "btn btn-ghost", style: "justify-content:flex-start", onclick: () => location.reload() }, icon("search"), t("Look for orgs again")),
        h("button", { class: "btn btn-ghost", style: "justify-content:flex-start", onclick: () => chrome.runtime.openOptionsPage() }, icon("settings"), t("Settings")))),
    h("main", {}, h("div", { class: "content" }, titleEl, introEl, ...Object.values(pages).map((p) => p.body))),
    objectList);
  const noOrg = h("div", { class: "no-org card", hidden: true },
    h("div", { class: "brand" }, logo(30), "OrgClearance"),
    h("h1", { style: "margin-top:18px" }, t("Log into Salesforce first")),
    h("p", { class: "intro" }, t("OrgClearance works with the orgs you're logged into in this browser. Open your org in another tab, then come back and look again. If your org blocks that, set it up with OAuth in Settings.")),
    h("div", { class: "toolbar" },
      h("button", { class: "btn btn-primary", style: "width:auto;margin-top:0", onclick: () => location.reload() }, icon("search"), t("Look for orgs again")),
      h("button", { class: "btn btn-secondary", onclick: () => chrome.runtime.openOptionsPage() }, icon("settings"), t("Open settings"))));
  app.append(shell, noOrg);
  select("User");

  (async () => {
    try { orgs = await send({ type: "listOrgs" }); }
    catch (e) { orgs = []; noOrg.append(errorBox(e)); }
    if (!orgs.length) { shell.hidden = true; noOrg.hidden = false; return; }
    orgSelect.replaceChildren(...orgs.map((o) => h("option", { value: o.host }, `${o.host}${o.auth === "oauth" ? " (OAuth)" : ""}`)));
    const wanted = params.get("org");
    if (wanted && orgs.some((o) => o.host === wanted)) orgSelect.value = wanted;
    await onOrgChange();
    const user = params.get("user");
    if (user) { select("User"); loadUser(user); }
  })();
})();
