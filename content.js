// @ts-check
// Record panel on top of Salesforce: Explain, Fields, Compare, History.
// Org-wide tools (User, Audit, Docs, Orgs) live in the workspace page.
// Lives in a Shadow DOM so page styles don't clash.
(async () => {
  if (window.top !== window || document.getElementById("orgclearance-root") || globalThis.__orgClearancePanel) return;
  globalThis.__orgClearancePanel = true;
  await globalThis.OrgClearanceI18n.ready;
  const {
    h, icon, logo, CSS, fontFaceCss, STATUS, ACCESS, makeSend, run, empty, notes, errorBox, statusPill, statusDot,
    sourceList, labels, avatar, userLine, checkRow, orgKey, userPicker, tabs, download, toCsv, stamp,
  } = globalThis.OrgClearanceUI;
  const I18N = globalThis.OrgClearanceI18n;
  const t = (k, v) => I18N.t(k, v);
  const tn = (n, one, other, v) => I18N.tn(n, one, other, v);

  const send = makeSend();
  const key = () => orgKey(location.hostname);
  const state = { ctx: null };

  function parseContext() {
    const m = location.pathname.match(/\/lightning\/r\/(?:([A-Za-z0-9_]+)\/)?([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view/);
    return m ? { sobject: m[1] || null, recordId: m[2] } : null;
  }

  // Fonts can't be declared inside a shadow root, so register them on the page once.
  if (!document.getElementById("orgclearance-fonts")) {
    try {
      const style = document.createElement("style");
      style.id = "orgclearance-fonts";
      style.textContent = fontFaceCss(chrome.runtime.getURL(""));
      (document.head || document.documentElement).append(style);
    } catch { /* system font fallback */ }
  }

  const PANEL_CSS = `
    :host { all: initial; font-family: var(--font); font-size: 14px; line-height: 1.45; color: var(--ink); }
    .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; }
    .fab .logo { width: 44px; height: 44px; border-radius: 12px; box-shadow: 0 2px 10px rgba(14,77,92,.35); }
    .fab .tip { order: -1; background: var(--ink); color: #fff; font-size: 12px; font-weight: 700; padding: 5px 9px; border-radius: 6px;
      opacity: 0; transform: translateX(6px); transition: opacity .15s, transform .15s; pointer-events: none; white-space: nowrap; }
    .fab:hover .tip, .fab:focus-visible .tip { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) { .fab .tip { transition: none; } }
    .panel { position: fixed; right: 18px; bottom: 74px; z-index: 2147483000; width: 440px; max-width: calc(100vw - 36px); max-height: calc(100vh - 100px);
      display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: 0 12px 40px rgba(28,34,48,.18), 0 2px 6px rgba(28,34,48,.08); overflow: hidden; }
    header { padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
    .bar { display: flex; align-items: center; gap: 10px; }
    .bar .brand { flex: 1; font-weight: 700; font-size: 15px; }
    .iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--muted); }
    .iconbtn:hover { background: var(--wash); color: var(--ink); }
    .ctx { display: flex; align-items: center; gap: 6px; margin: 10px 0 12px; font-size: 13px; color: var(--muted); min-height: 20px; }
    .record { min-width: 0; flex: 1; }
    .rname { font-size: 16px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rmeta { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; }
    .otype { background: var(--brand-soft); color: var(--brand); font-weight: 700; font-size: 12px; padding: 1px 8px; border-radius: 999px; }
    .rid { letter-spacing: .02em; }
    .iconbtn.small { width: 24px; height: 24px; border-radius: 6px; }
    .iconbtn.small .ic { width: 14px; height: 14px; vertical-align: 0; }
    .iconbtn.done { color: var(--yes); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .panel-body { padding: 14px 16px 18px; overflow: auto; }
    .holders { display: flex; gap: 10px; margin-top: 18px; }
    .holders > div { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: var(--r-card); padding: 12px; }
    .holders .name { font-weight: 700; margin-top: 6px; } .holders .sub { font-size: 12px; color: var(--muted); }
    .holders .lines { margin-top: 10px; display: grid; gap: 6px; font-size: 13px; }
    .holders .lines div { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
    .timeline { list-style: none; padding: 0; margin: 16px 0 0; }
    .timeline li { display: grid; grid-template-columns: 92px 1fr; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .timeline .when { color: var(--muted); font-size: 12px; }
    .timeline .who { color: var(--muted); font-size: 12px; }
    .log { border-left: 3px solid var(--brand); padding: 6px 10px; margin-top: 10px; font-size: 13px; background: var(--wash); border-radius: 0; }
    .fixes ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 8px; }
    a.inline { color: var(--brand); font-weight: 700; text-decoration: none; display: inline-flex; gap: 3px; align-items: center; }
    a.inline .ic { width: 13px; height: 13px; vertical-align: 0; }
    a.inline:hover { text-decoration: underline; }
    .summary { display: flex; gap: 10px; align-items: baseline; margin-top: 18px; font-size: 15px; }
    .summary .big { font-size: 28px; font-weight: 700; color: var(--brand); line-height: 1; }
    .people { list-style: none; padding: 0; margin: 12px 0 0; }
    .people li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .people .who { min-width: 0; } .people .name { font-weight: 700; }
    .tabs button { padding: 7px 4px; gap: 4px; min-width: 0; font-size: 12.5px; }
    .fixgroup { margin-top: 14px; font-weight: 700; font-size: 13px; color: var(--muted); }
    .fixes li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-control); }
    .fixes .title { font-weight: 700; }
    .fixes a { color: var(--brand); font-weight: 700; text-decoration: none; display: inline-flex; gap: 4px; align-items: center; margin-top: 4px; }
    .fixes a .ic { width: 14px; height: 14px; vertical-align: 0; }
    .fixes a:hover { text-decoration: underline; }
    .diffs { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 10px; }
    .diffs li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-control); }
    .diffs .title { font-weight: 700; }
    .counts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  `;

  const fieldList = h("datalist", { id: "oc-fields" });
  const fieldInput = () => h("input", { type: "text", list: "oc-fields", placeholder: t("e.g. Industry"), "aria-label": t("Field") });
  const fieldLabel = () => h("label", {}, t("Field"), " ", h("span", { class: "opt" }, t("(optional)")));

  // ---------- Explain ----------

  const ex = { picker: userPicker(send, t("Who do you want to check?"), key), field: fieldInput(), out: h("div") };
  ex.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("shield"), t("Check access"));
  ex.picker.onChange = () => { ex.btn.disabled = !(ex.picker.user && state.ctx); };
  ex.btn.addEventListener("click", () => run(send, ex.btn, ex.out, async () => renderExplain(await send({
    type: "explain",
    params: { userId: ex.picker.user.id, sobject: state.ctx.sobject, recordId: state.ctx.recordId, field: ex.field.value.trim() || null },
  })), t("Checking permissions and sharing…")));
  const explainEmpty = () => empty("shield", t("Pick a person to start"), t("You'll see whether they can open this record (and a field, if you name one), and exactly what grants or blocks it."));
  ex.out.append(explainEmpty());
  const explainView = h("div", {},
    h("p", { class: "lead" }, t("Can someone see this record or one of its fields, and why?")),
    ex.picker.el, fieldLabel(), ex.field, ex.btn, ex.out);

  const firstLabel = (list) => (list?.length ? list[0].label + (list.length > 1 ? t(" and {n} more", { n: list.length - 1 }) : "") : "");

  function objectRow(r) {
    const o = r.object;
    const line = o.status === "yes" ? t("Read granted by {source}", { source: firstLabel(o.readBy) })
      : o.status === "no" ? t("No profile or permission set grants read") : t("Couldn't verify");
    return checkRow(o.status, t("Object: {name}", { name: r.sobject }), line, [
      o.error && h("p", { class: "muted" }, o.error),
      o.readBy?.length ? [h("div", { class: "muted small" }, t("Read granted by")), sourceList(o.readBy)] : null,
      mutedList(o.muted),
      o.status !== "unknown" ? h("p", { class: "muted small" },
        t("Create: {create}. Edit: {edit}. Delete: {del}. View All: {viewAll}. Modify All: {modifyAll}.", { create: labels(o.createBy), edit: labels(o.editBy), del: labels(o.deleteBy), viewAll: labels(o.viewAllBy), modifyAll: labels(o.modifyAllBy) })) : null,
    ], o.status === "no");
  }

  function fieldRow(r) {
    const f = r.fieldAccess;
    if (!f || f.status === "skipped") return null;
    const line = f.status === "yes" ? t("Read granted by {source}", { source: firstLabel(f.readBy) })
      : f.status === "no" ? t("Hidden by field-level security") : f.status === "na" ? t("Not controlled by field-level security") : t("Couldn't verify");
    return checkRow(f.status, t("Field: {name}", { name: r.field }), line, [
      f.note && h("p", { class: "muted" }, f.note),
      f.error && h("p", { class: "muted" }, f.error),
      f.readBy?.length ? [h("div", { class: "muted small" }, t("Read granted by")), sourceList(f.readBy)] : null,
      mutedList(f.muted),
    ], f.status === "no");
  }

  function screenRow(r) {
    const c = r.screen;
    if (!c || c.status === "skipped") return null;
    const line = c.status === "yes" ? (c.layout ? t("On their page layout: {layout}", { layout: c.layout.name }) : t("On their page layout"))
      : c.status === "no" ? (c.layout ? t("Not on their page layout ({layout})", { layout: c.layout.name }) : t("Not on their page layout"))
      : c.error ? t("Couldn't verify") : t("Depends on which Lightning page they get");
    const link = (text, url) => (url ? h("a", { href: url, target: "_blank", rel: "noopener", class: "inline" }, text, icon("external")) : text);
    return checkRow(c.status, t("On their page"), line, [
      c.error && h("p", { class: "muted" }, c.error),
      c.layout ? h("p", { class: "small" }, t("Page layout: "), link(c.layout.name, c.layout.url),
        c.recordType ? t(" (record type {name})", { name: c.recordType.name }) : "",
        c.onLayout === true ? (c.behavior === "Readonly" ? t(". The field is on it, read-only.") : c.behavior === "Required" ? t(". The field is on it, required.") : t(". The field is on it."))
          : c.onLayout === false ? t(". The field isn't on it.") : ".") : null,
      c.pages?.length ? [h("div", { class: "muted small" }, t("Lightning record pages for this object")),
        h("ul", {}, c.pages.map((pg) => h("li", {}, link(pg.name, pg.url), ": ",
          pg.usesDynamicForms ? (pg.hasField ? (pg.conditional ? t("has the field (only when its visibility rule is met)") : t("has the field")) : t("uses Dynamic Forms without this field"))
            : pg.usesLayout ? t("shows the page layout") : t("no record detail on this page"))))] : null,
      notes(c.notes),
    ], c.status === "no");
  }

  function recordRow(r) {
    const c = r.record;
    if (!c || c.status === "skipped") return null;
    const line = c.status === "yes" ? (c.reasons?.[0]?.text ?? t("Access level: {level}", { level: c.maxAccessLevel }))
      : c.status === "no" ? t("Sharing doesn't reach this person") : t("Couldn't verify");
    return checkRow(c.status, t("This record"), line, [
      c.error && h("p", { class: "muted" }, c.error),
      c.maxAccessLevel || c.owd ? h("p", { class: "muted small" },
        [c.maxAccessLevel && t("Access level: {level}.", { level: c.maxAccessLevel }), c.owd && t(c.owd.audience === "external" ? "Org-wide default for external users: {label}." : "Org-wide default for internal users: {label}.", { label: c.owd.label })].filter(Boolean).join(" ")) : null,
      c.reasons?.length ? [h("div", { class: "muted small" }, t("Why they have access")), h("ul", {}, c.reasons.map((x) => h("li", {}, x.text)))] : null,
      notes(c.notes),
    ], c.status === "no");
  }

  const mutedList = (muted) => muted?.length ? h("ul", {}, muted.map((m) => h("li", {},
    t(m.outdated ? "Included in group {group} (from {from}) but the group needs recalculation." : "Included in group {group} (from {from}) but muted there.", { group: m.group, from: m.components.join(", ") })))) : null;

  function holder(u) {
    return h("div", { class: "holder" }, avatar(u.name, "lg"),
      h("div", { class: "who" }, h("div", { class: "name" }, u.name + (u.isActive === false ? t(" (inactive)") : "")), h("div", { class: "sub" }, userLine(u))));
  }

  // Copies the plain-text summary for a ticket or a reply to the person who asked.
  function copyButton(text) {
    if (!text) return null;
    const label = h("span", {}, t("Copy for a ticket"));
    const btn = h("button", { class: "btn btn-secondary btn-small", title: t("Copies the result, the reasons and the suggested fix as plain text") }, icon("copy"), label);
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); }
      catch {
        // Fallback when the page doesn't grant clipboard access.
        const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text;
        root.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      label.textContent = t("Copied");
      setTimeout(() => { label.textContent = t("Copy for a ticket"); }, 2000);
    });
    return btn;
  }

  const FIX_ICON = { layout: "docs", page: "workspace", assign: "user", edit: "fields", unmute: "shield", renew: "clock", share: "compare", role: "user", rule: "settings", activate: "user" };
  function fixes(r) {
    if (!r.suggestions?.length && !r.suggestionNotes?.length) return null;
    const groups = r.fixGroups?.length ? r.fixGroups : [{ key: "all", title: "", items: r.suggestions ?? [] }];
    const many = groups.length > 1;
    const item = (x) => h("li", {},
      h("span", { class: "dot s-read" }, icon(FIX_ICON[x.kind] ?? "check")),
      h("div", {}, h("div", { class: "title" }, x.title), h("div", { class: "muted small" }, x.detail),
        x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener", class: "small" }, t("Open in Salesforce "), icon("external")) : null));
    return h("section", { class: "fixes", "aria-label": t("How to fix it") },
      h("h3", {}, t("How to fix it")),
      h("p", { class: "muted small", style: "margin-top:0" }, many
        ? t("There are {n} separate problems. Each one needs one of its options. OrgClearance only suggests; it doesn't change anything.", { n: groups.length })
        : t("Pick the option that fits. OrgClearance only suggests; it doesn't change anything.")),
      groups.filter((g) => g.items.length).map((g) => [many ? h("div", { class: "fixgroup" }, g.title) : null, h("ul", {}, g.items.map(item))]),
      notes(r.suggestionNotes));
  }

  // For a "yes", say in one line what gives them access, so the answer stands on its own.
  function whyYes(r) {
    const parts = [];
    if (r.record?.status === "yes" && r.record.reasons?.length) parts.push(r.record.reasons[0].text);
    if (r.fieldAccess?.status === "yes" && r.fieldAccess.readBy?.length) parts.push(t("field read from {source}", { source: firstLabel(r.fieldAccess.readBy) }));
    if (!parts.length && r.object?.readBy?.length) parts.push(t("object read from {source}", { source: firstLabel(r.object.readBy) }));
    return parts.length ? h("p", { class: "muted", style: "margin:8px 0 0 40px" }, `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase())) : null;
  }

  function renderExplain(r) {
    const v = r.verdict;
    const what = r.field ? t("the {field} field on this record", { field: r.field }) : t("this record");
    const answer = t({ yes: "Can see {what}.", no: "Can't see {what}.", unknown: "Can't tell yet whether they can see {what}." }[v.status], { what });
    return [
      h("section", { class: `pass v-${v.status}`, "aria-label": t("Result") },
        holder(r.user),
        h("div", { class: "answer" }, statusDot(v.status), h("span", {}, answer)),
        v.reasons.length ? h("ul", {}, v.reasons.map((x) => h("li", {}, x))) : null,
        v.status === "yes" ? whyYes(r) : null),
      h("div", { class: "row", style: "margin-top:10px" }, copyButton(r.ticket)),
      fixes(r),
      h("div", { class: "checks" }, objectRow(r), fieldRow(r), screenRow(r), recordRow(r),
        h("details", { class: "check" },
          h("summary", {}, h("span", { class: "dot s-na" }, icon("user")),
            h("span", { class: "what" }, h("div", { class: "title" }, t("Where their permissions come from")),
              h("div", { class: "line" }, tn(r.sources.length, "{n} source checked", "{n} sources checked"))), icon("chevron")),
          h("div", { class: "body" }, sourceList(r.sources) ?? h("p", { class: "muted" }, t("None.")),
            r.expired?.length ? h("p", { class: "muted small" }, t("Expired and ignored: {list}.", { list: r.expired.map((s) => s.label).join(", ") })) : null,
            r.componentsError ? h("p", { class: "muted small" }, t("Couldn't break down permission set groups: {error}", { error: r.componentsError })) : null))),
      h("div", { class: "row", style: "margin-top:14px" },
        h("button", { class: "btn btn-ghost btn-small", onclick: () => send({ type: "openWorkspace", user: r.user.id }) },
          icon("workspace"), t("See everything this person can do in the org"))),
    ];
  }

  // ---------- Fields ----------

  const fm = { picker: userPicker(send, t("Whose field access?"), key), out: h("div"), data: null };
  fm.filter = h("input", { type: "search", placeholder: t("Name or label") });
  fm.show = h("select", {}, h("option", { value: "all" }, t("All fields")), h("option", { value: "none" }, t("No access")),
    h("option", { value: "read" }, t("Read only")), h("option", { value: "edit" }, t("Can edit")), h("option", { value: "always" }, t("Always visible")));
  fm.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("fields"), t("Show field access"));
  fm.filters = h("div", { class: "two", hidden: true }, h("div", {}, h("label", {}, t("Filter")), fm.filter), h("div", {}, h("label", {}, t("Show")), fm.show));
  fm.picker.onChange = () => { fm.btn.disabled = !(fm.picker.user && state.ctx); };
  fm.btn.addEventListener("click", () => run(send, fm.btn, fm.out, async () => {
    fm.data = await send({ type: "fieldMatrix", params: { userId: fm.picker.user.id, sobject: state.ctx.sobject } });
    fm.filters.hidden = fm.data.status !== "ok";
    return renderMatrix();
  }, t("Reading field-level security…")));
  const rerender = () => { if (fm.data) fm.out.replaceChildren(...renderMatrix()); };
  fm.filter.addEventListener("input", rerender);
  fm.show.addEventListener("change", rerender);
  const fieldsEmpty = () => empty("fields", t("Pick a person to see their field access"), t("Every field on this object, with whether they can edit, read or not see it, and which permission grants it."));
  fm.out.append(fieldsEmpty());
  const fieldsView = h("div", { hidden: true },
    h("p", { class: "lead" }, t("What can someone do with each field on this object?")),
    fm.picker.el, fm.btn, fm.filters, fm.out);

  function renderMatrix() {
    const d = fm.data;
    if (d.status !== "ok") return [errorBox(new Error(d.error))];
    const q = fm.filter.value.trim().toLowerCase();
    const rows = d.fields.filter((f) =>
      (fm.show.value === "all" || f.access === fm.show.value) &&
      (!q || f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)));
    const counts = d.fields.reduce((acc, f) => ({ ...acc, [f.access]: (acc[f.access] || 0) + 1 }), {});
    return [
      d.object.status !== "yes" ? h("div", { class: "err" }, icon("alert"), h("div", {}, t("{name} can't read {sobject} at all, so none of these fields are visible to them.", { name: d.user.name, sobject: d.sobject }))) : null,
      h("div", { class: "counts" }, ["edit", "read", "none", "always"].map((k) => statusPill(k, `${ACCESS[k]}: ${counts[k] || 0}`))),
      rows.length ? h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, t("Field")), h("th", {}, t("Access")), h("th", {}, t("Granted by")))),
        h("tbody", {}, rows.map((f) => h("tr", {},
          h("td", {}, h("div", {}, f.label), h("div", { class: "api muted" }, f.name)),
          h("td", {}, statusPill(f.access, ACCESS[f.access]), f.muted ? h("div", { class: "muted small" }, t("Muted in a group")) : null),
          h("td", { class: "muted" }, f.access === "always" ? t("No field-level security") : (f.access === "edit" ? f.editBy : f.readBy).join(", ") || t("Nobody"))))))
        : h("p", { class: "muted" }, t("No fields match these filters.")),
    ];
  }

  // ---------- Compare ----------

  const cp = { a: userPicker(send, t("First person"), key), b: userPicker(send, t("Second person"), key), field: fieldInput(), out: h("div") };
  cp.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("compare"), t("Compare access"));
  cp.a.onChange = cp.b.onChange = () => { cp.btn.disabled = !(cp.a.user && cp.b.user && state.ctx); };
  cp.btn.addEventListener("click", () => run(send, cp.btn, cp.out, async () => renderCompare(await send({
    type: "compare",
    params: { userIdA: cp.a.user.id, userIdB: cp.b.user.id, sobject: state.ctx.sobject, recordId: state.ctx.recordId, field: cp.field.value.trim() || null },
  })), t("Checking both people…")));
  const compareEmpty = () => empty("compare", t("Pick two people"), t("Useful when one person sees something and a colleague doesn't: you'll get the permission that makes the difference."));
  cp.out.append(compareEmpty());
  const compareView = h("div", { hidden: true },
    h("p", { class: "lead" }, t("Why can one person see this and another can't?")),
    cp.a.el, cp.b.el, fieldLabel(), cp.field, cp.btn, cp.out);

  function renderCompare(c) {
    const col = (r) => h("div", {}, avatar(r.user.name), h("div", { class: "name" }, r.user.name), h("div", { class: "sub" }, userLine(r.user)),
      h("div", { class: "lines" },
        h("div", {}, t("Object"), statusPill(r.object.status)),
        r.fieldAccess.status !== "skipped" ? h("div", {}, t("Field"), statusPill(r.fieldAccess.status)) : null,
        r.record.status !== "skipped" ? h("div", {}, t("Record"), statusPill(r.record.status)) : null));
    const list = (title, items, fallback) => h("div", {}, h("h3", {}, title), sourceList(items) ?? h("p", { class: "muted" }, fallback));
    return [
      h("div", { class: "holders" }, col(c.a), col(c.b)),
      h("h3", {}, t("What's different")),
      c.differences.length
        ? h("ul", { class: "diffs" }, c.differences.map((d) => h("li", {},
            h("span", { class: "dot s-read" }, icon("compare")),
            h("div", {}, h("div", { class: "title" }, t("{check}: {a} for {nameA}, {b} for {nameB}", { check: t(d.check), a: STATUS[d.a].toLowerCase(), nameA: c.a.user.name, b: STATUS[d.b].toLowerCase(), nameB: c.b.user.name })),
              h("div", { class: "muted" }, d.explanation ?? t("No single permission explains this difference."))))))
        : h("p", { class: "muted" }, t("Both get the same result.")),
      list(t("Only {name} has", { name: c.a.user.name }), c.onlyA, t("Nothing extra.")),
      list(t("Only {name} has", { name: c.b.user.name }), c.onlyB, t("Nothing extra.")),
      list(t("Both have"), c.common, t("Nothing in common.")),
    ];
  }

  // ---------- Who ----------

  const wh = { field: fieldInput(), out: h("div"), data: null };
  wh.record = h("input", { type: "checkbox", id: "oc-who-record", style: "width:auto;margin:0" });
  wh.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("user"), t("Find who can see it"));
  wh.filter = h("input", { type: "search", placeholder: t("Filter by name, username or profile"), "aria-label": t("Filter people") });
  wh.filterBox = h("div", { class: "search", hidden: true, style: "margin-top:14px" }, icon("search"), wh.filter);
  wh.btn.addEventListener("click", () => run(send, wh.btn, wh.out, async () => {
    wh.data = await send({ type: "whoCanSee", params: {
      sobject: state.ctx.sobject, field: wh.field.value.trim() || null, recordId: state.ctx.recordId, checkRecord: wh.record.checked } });
    wh.filterBox.hidden = !wh.data.users.length;
    return renderWho();
  }, wh.record.checked ? t("Finding people, then checking this record for each one…") : t("Finding everyone with access…")));
  wh.filter.addEventListener("input", () => { if (wh.data) wh.out.querySelector(".people")?.replaceWith(peopleList()); });
  const whoEmpty = () => empty("user", t("Find everyone who can see this"), t("Lists every active person who can read this object, or a field you name, and the permission that gives it to them. Useful for audits and before changing a permission."));
  wh.out.append(whoEmpty());
  const whoView = h("div", { hidden: true },
    h("p", { class: "lead" }, t("Who can see this object, one of its fields, or this record?")),
    fieldLabel(), wh.field,
    h("label", { for: "oc-who-record", class: "row", style: "font-weight:400;gap:8px;margin-top:12px" }, wh.record, t("Also check this record, person by person (up to 100 people)")),
    wh.btn, wh.out);

  function peopleList() {
    const q = wh.filter.value.trim().toLowerCase();
    const rows = wh.data.users.filter((u) => !q || [u.name, u.username, u.profileName].some((x) => String(x || "").toLowerCase().includes(q)));
    return h("ul", { class: "people" }, rows.length ? rows.map((u) => h("li", {}, avatar(u.name),
      h("div", { class: "who" }, h("div", { class: "name" }, u.name, u.userType && u.userType !== "Standard" ? h("span", { class: "muted small" }, ` (${t(u.userType)})`) : null),
        h("div", { class: "muted small" }, [u.username, u.profileName].filter(Boolean).join(", ")),
        h("div", { class: "small" }, t(wh.data.field ? "Field from {sources}" : "Read from {sources}", { sources: (wh.data.field && u.fieldVia.length ? u.fieldVia : u.objectVia).join("; ") })),
        u.recordAccess ? h("div", { class: "small" }, t("Record access: {level}", { level: t(u.recordAccess) })) : null)))
      : h("li", { class: "muted" }, t("Nobody matches this filter.")));
  }

  function renderWho() {
    const d = wh.data;
    const what = d.field ? t("the {field} field", { field: d.field }) : t("{sobject} records", { sobject: d.sobject });
    const scope = d.record.status === "checked" ? t(" and this record") : "";
    const csv = () => download(root, `who-can-see-${d.sobject}${d.field ? `-${d.field}` : ""}-${stamp()}.csv`,
      toCsv([t("Name"), t("Username"), t("Profile"), t("User type"), t("Object read from"), t("Field read from"), t("Record access")],
        d.users.map((u) => [u.name, u.username, u.profileName ?? "", u.userType ?? "", u.objectVia.join("; "), u.fieldVia.join("; "), u.recordAccess ?? ""])), "text/csv");
    return [
      h("div", { class: "summary" }, h("span", { class: "big" }, String(d.total)),
        h("span", {}, tn(d.total, "person can see {what}{scope}.", "people can see {what}{scope}.", { what, scope }))),
      d.record.status === "checked" ? h("p", { class: "muted small" }, tn(d.record.checked, "Checked this record for {n} person with permission.", "Checked this record for {n} people with permission.")) : null,
      d.users.length ? h("div", { class: "row" }, h("button", { class: "btn btn-secondary btn-small", onclick: csv }, icon("download"), t("Download CSV"))) : null,
      d.users.length ? wh.filterBox : null,
      d.users.length ? peopleList() : empty("user", t("Nobody can see it"), t("No active user has a profile or permission set that grants this.")),
      notes(d.notes),
    ];
  }

  // ---------- History ----------

  const hi = { out: h("div"), logsOut: h("div") };
  hi.btn = h("button", { class: "btn btn-primary", disabled: true, style: "margin-top:12px" }, icon("clock"), t("Show timeline"));
  hi.logsBtn = h("button", { class: "btn btn-secondary", disabled: true, style: "margin-top:12px" }, icon("search"), t("Scan debug logs"));
  const KIND_LABEL = { created: t("Created"), modified: t("Modified"), field: t("Field change"), activity: t("Activity"), email: t("Email") };
  const when = (iso) => { const d = new Date(iso); return [d.toLocaleDateString(), d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })]; };
  hi.btn.addEventListener("click", () => run(send, hi.btn, hi.out, async () => {
    const tl = await send({ type: "timeline", params: { sobject: state.ctx.sobject, recordId: state.ctx.recordId } });
    return [
      tl.events.length ? h("ol", { class: "timeline" }, tl.events.map((e) => {
        const [day, time] = when(e.at);
        return h("li", {}, h("div", { class: "when" }, h("div", {}, day), h("div", {}, time)),
          h("div", {}, h("div", {}, e.text), h("div", { class: "who" }, e.who ? t("{kind} by {who}", { kind: KIND_LABEL[e.kind] ?? e.kind, who: e.who }) : (KIND_LABEL[e.kind] ?? e.kind))));
      })) : empty("clock", t("Nothing recorded yet"), t("No history, activities or emails were found for this record.")),
      notes(tl.notes),
    ];
  }, t("Gathering history…")));
  hi.logsBtn.addEventListener("click", () => run(send, hi.logsBtn, hi.logsOut, async () => {
    const r = await send({ type: "scanLogs", params: { recordId: state.ctx.recordId, limit: 20 } });
    const head = h("p", { class: "muted" }, t(r.failed ? "Read the {scanned} most recent debug logs ({failed} couldn't be opened); {matches} mention this record." : "Read the {scanned} most recent debug logs; {matches} mention this record.", { scanned: r.scanned, failed: r.failed, matches: r.matches.length }));
    if (!r.matches.length) {
      return [head, empty("search", t("No logs mention this record"), t("Debug logs only exist while a trace flag is on. In Setup, open Debug Logs, add a trace flag for the person, repeat what they did, then scan again."))];
    }
    return [head, ...r.matches.map((m) => {
      const [day, time] = when(m.at);
      return h("div", { class: "log" },
        h("div", {}, h("b", {}, `${day} ${time}`), t(" by {who}", { who: m.user })),
        m.flows.length ? h("div", {}, t("Flows: {list}", { list: m.flows.join(", ") })) : null,
        m.triggers.length ? h("div", {}, t("Triggers: {list}", { list: m.triggers.join(", ") })) : null,
        m.validations.length ? h("div", {}, t("Validation rules checked: {list}", { list: m.validations.join(", ") })) : null,
        m.failures.length ? h("div", { style: "color:var(--no)" }, m.failures.join(", ")) : null,
        m.errors.length ? h("div", { style: "color:var(--no)" }, t("Errors: {list}", { list: m.errors.join("; ") })) : null);
    })];
  }, t("Reading debug logs…")));
  const historyView = h("div", { hidden: true },
    h("p", { class: "lead" }, t("What happened to this record, and who did it?")),
    h("div", { class: "two" }, hi.btn, hi.logsBtn),
    hi.out, hi.logsOut);

  // ---------- shell ----------

  const views = { Explain: explainView, Fields: fieldsView, Compare: compareView, Who: whoView, History: historyView };
  const { nav } = tabs(views, {}, { Explain: "shield", Fields: "fields", Compare: "compare", Who: "user", History: "clock" });
  const ctxEl = h("div", { class: "ctx" });
  const panel = h("div", { class: "panel", hidden: true, role: "dialog", "aria-label": "OrgClearance" },
    h("header", {},
      h("div", { class: "bar" }, logo(26), h("span", { class: "brand" }, "OrgClearance"),
        h("button", { class: "iconbtn", title: t("Open the workspace: user overview, audit, docs, org comparison"), "aria-label": t("Open workspace"), onclick: () => send({ type: "openWorkspace" }) }, icon("workspace")),
        h("button", { class: "iconbtn", title: t("Settings"), "aria-label": t("Settings"), onclick: () => send({ type: "openOptions" }) }, icon("settings")),
        h("button", { class: "iconbtn", title: t("Close (Alt+Shift+A)"), "aria-label": t("Close"), onclick: toggle }, icon("close"))),
      ctxEl, nav),
    h("div", { class: "panel-body" }, ...Object.values(views), fieldList));
  const fab = h("button", { class: "fab", "aria-label": t("Open OrgClearance (Alt+Shift+A)"), onclick: toggle },
    h("span", { class: "tip" }, "OrgClearance"), logo(44));

  const host = h("div", { id: "orgclearance-root" });
  const root = host.attachShadow({ mode: "closed" });
  root.append(h("style", {}, CSS + PANEL_CSS), panel, fab);
  document.documentElement.append(host);

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === "toggle") toggle(); });

  async function toggle() {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    const ctx = parseContext();
    if (!ctx) {
      state.ctx = null;
      ctxEl.replaceChildren(icon("alert"), t("Open a record to use these tabs. Org-wide tools are in the workspace."));
      return refreshButtons();
    }
    if (state.ctx && ctx.recordId === state.ctx.recordId) return;
    state.ctx = null;
    ctxEl.replaceChildren(h("span", { class: "spinner" }), h("span", {}, t("Reading this record…")));
    try {
      const info = await send({ type: "recordContext", recordId: ctx.recordId, sobject: ctx.sobject });
      ctx.sobject = info.sobject;
      state.ctx = ctx;
      ctxEl.replaceChildren(recordHeader(info));
      const fields = await send({ type: "listFields", sobject: ctx.sobject });
      fieldList.replaceChildren(...fields.map((f) => h("option", { value: f.name, label: f.label })));
      ex.out.replaceChildren(explainEmpty());
      fm.out.replaceChildren(fieldsEmpty());
      cp.out.replaceChildren(compareEmpty());
      wh.out.replaceChildren(whoEmpty()); wh.filterBox.hidden = true; wh.data = null;
      [hi.out, hi.logsOut].forEach((o) => o.replaceChildren());
      fm.data = null;
      fm.filters.hidden = true;
    } catch (e) {
      ctxEl.replaceChildren(errorBox(e));
    }
    refreshButtons();
  }
  // Which record the panel is looking at: its name, its object, and the Id with a copy button.
  function recordHeader(info) {
    const copyLabel = h("span", { class: "sr" }, t("Copy record Id"));
    const copy = h("button", { class: "iconbtn small", title: t("Copy record Id"), onclick: async () => {
      try { await navigator.clipboard.writeText(info.recordId); copy.classList.add("done"); setTimeout(() => copy.classList.remove("done"), 1500); } catch { /* clipboard blocked */ }
    } }, icon("copy"), copyLabel);
    return h("div", { class: "record" },
      h("div", { class: "rname", title: info.title ?? info.label }, info.title ?? t("{label} record", { label: info.label })),
      h("div", { class: "rmeta" }, h("span", { class: "otype" }, info.label),
        info.label !== info.sobject ? h("span", { class: "api muted" }, info.sobject) : null,
        h("span", { class: "api muted rid" }, info.recordId), copy));
  }

  function refreshButtons() {
    [ex.picker, fm.picker, cp.a].forEach((p) => p.onChange());
    hi.btn.disabled = hi.logsBtn.disabled = wh.btn.disabled = !state.ctx;
  }
})();
