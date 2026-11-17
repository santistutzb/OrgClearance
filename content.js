// @ts-check
// Record panel on top of Salesforce: Explain, Fields, Compare, History.
// Org-wide tools (User, Audit, Docs, Orgs) live in the workspace page.
// Lives in a Shadow DOM so page styles don't clash.
(() => {
  if (window.top !== window || document.getElementById("orgclearance-root")) return;
  const {
    h, icon, logo, CSS, fontFaceCss, STATUS, ACCESS, makeSend, run, empty, notes, errorBox, statusPill, statusDot,
    sourceList, labels, avatar, userLine, checkRow, orgKey, userPicker, tabs,
  } = globalThis.OrgClearanceUI;

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
    .ctx b { color: var(--ink); }
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
  const fieldInput = () => h("input", { type: "text", list: "oc-fields", placeholder: "e.g. Industry", "aria-label": "Field" });
  const fieldLabel = () => h("label", {}, "Field ", h("span", { class: "opt" }, "(optional)"));

  // ---------- Explain ----------

  const ex = { picker: userPicker(send, "Who do you want to check?", key), field: fieldInput(), out: h("div") };
  ex.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("shield"), "Check access");
  ex.picker.onChange = () => { ex.btn.disabled = !(ex.picker.user && state.ctx); };
  ex.btn.addEventListener("click", () => run(send, ex.btn, ex.out, async () => renderExplain(await send({
    type: "explain",
    params: { userId: ex.picker.user.id, sobject: state.ctx.sobject, recordId: state.ctx.recordId, field: ex.field.value.trim() || null },
  })), "Checking permissions and sharing…"));
  const explainEmpty = () => empty("shield", "Pick a person to start", "You'll see whether they can open this record (and a field, if you name one), and exactly what grants or blocks it.");
  ex.out.append(explainEmpty());
  const explainView = h("div", {},
    h("p", { class: "lead" }, "Can someone see this record or one of its fields, and why?"),
    ex.picker.el, fieldLabel(), ex.field, ex.btn, ex.out);

  const firstLabel = (list) => (list?.length ? list[0].label + (list.length > 1 ? ` and ${list.length - 1} more` : "") : "");

  function objectRow(r) {
    const o = r.object;
    const line = o.status === "yes" ? `Read granted by ${firstLabel(o.readBy)}`
      : o.status === "no" ? "No profile or permission set grants read" : "Couldn't verify";
    return checkRow(o.status, `Object: ${r.sobject}`, line, [
      o.error && h("p", { class: "muted" }, o.error),
      o.readBy?.length ? [h("div", { class: "muted small" }, "Read granted by"), sourceList(o.readBy)] : null,
      mutedList(o.muted),
      o.status !== "unknown" ? h("p", { class: "muted small" },
        `Create: ${labels(o.createBy)}. Edit: ${labels(o.editBy)}. Delete: ${labels(o.deleteBy)}. View All: ${labels(o.viewAllBy)}. Modify All: ${labels(o.modifyAllBy)}.`) : null,
    ], o.status === "no");
  }

  function fieldRow(r) {
    const f = r.fieldAccess;
    if (!f || f.status === "skipped") return null;
    const line = f.status === "yes" ? `Read granted by ${firstLabel(f.readBy)}`
      : f.status === "no" ? "Hidden by field-level security" : f.status === "na" ? "Not controlled by field-level security" : "Couldn't verify";
    return checkRow(f.status, `Field: ${r.field}`, line, [
      f.note && h("p", { class: "muted" }, f.note),
      f.error && h("p", { class: "muted" }, f.error),
      f.readBy?.length ? [h("div", { class: "muted small" }, "Read granted by"), sourceList(f.readBy)] : null,
      mutedList(f.muted),
    ], f.status === "no");
  }

  function recordRow(r) {
    const c = r.record;
    if (!c || c.status === "skipped") return null;
    const line = c.status === "yes" ? (c.reasons?.[0]?.text ?? `Access level: ${c.maxAccessLevel}`)
      : c.status === "no" ? "Sharing doesn't reach this person" : "Couldn't verify";
    return checkRow(c.status, "This record", line, [
      c.error && h("p", { class: "muted" }, c.error),
      c.maxAccessLevel || c.owd ? h("p", { class: "muted small" },
        [c.maxAccessLevel && `Access level: ${c.maxAccessLevel}.`, c.owd && `Org-wide default for ${c.owd.audience} users: ${c.owd.label}.`].filter(Boolean).join(" ")) : null,
      c.reasons?.length ? [h("div", { class: "muted small" }, "Why they have access"), h("ul", {}, c.reasons.map((x) => h("li", {}, x.text)))] : null,
      notes(c.notes),
    ], c.status === "no");
  }

  const mutedList = (muted) => muted?.length ? h("ul", {}, muted.map((m) => h("li", {},
    `Included in group ${m.group} (from ${m.components.join(", ")}) but ${m.outdated ? "the group needs recalculation" : "muted there"}.`))) : null;

  function holder(u) {
    return h("div", { class: "holder" }, avatar(u.name, "lg"),
      h("div", { class: "who" }, h("div", { class: "name" }, u.name + (u.isActive === false ? " (inactive)" : "")), h("div", { class: "sub" }, userLine(u))));
  }

  // Copies the plain-text summary for a ticket or a reply to the person who asked.
  function copyButton(text) {
    if (!text) return null;
    const label = h("span", {}, "Copy for a ticket");
    const btn = h("button", { class: "btn btn-secondary btn-small", title: "Copies the result, the reasons and the suggested fix as plain text" }, icon("copy"), label);
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); }
      catch {
        // Fallback when the page doesn't grant clipboard access.
        const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text;
        root.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      label.textContent = "Copied";
      setTimeout(() => { label.textContent = "Copy for a ticket"; }, 2000);
    });
    return btn;
  }

  const FIX_ICON = { assign: "user", edit: "fields", unmute: "shield", renew: "clock", share: "compare", role: "user", rule: "settings", activate: "user" };
  function fixes(r) {
    if (!r.suggestions?.length && !r.suggestionNotes?.length) return null;
    const groups = r.fixGroups?.length ? r.fixGroups : [{ key: "all", title: "", items: r.suggestions ?? [] }];
    const many = groups.length > 1;
    const item = (x) => h("li", {},
      h("span", { class: "dot s-read" }, icon(FIX_ICON[x.kind] ?? "check")),
      h("div", {}, h("div", { class: "title" }, x.title), h("div", { class: "muted small" }, x.detail),
        x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener", class: "small" }, "Open in Salesforce ", icon("external")) : null));
    return h("section", { class: "fixes", "aria-label": "How to fix it" },
      h("h3", {}, "How to fix it"),
      h("p", { class: "muted small", style: "margin-top:0" }, many
        ? `There are ${groups.length} separate problems. Each one needs one of its options. OrgClearance only suggests; it doesn't change anything.`
        : "Pick the option that fits. OrgClearance only suggests; it doesn't change anything."),
      groups.filter((g) => g.items.length).map((g) => [many ? h("div", { class: "fixgroup" }, g.title) : null, h("ul", {}, g.items.map(item))]),
      notes(r.suggestionNotes));
  }

  // For a "yes", say in one line what gives them access, so the answer stands on its own.
  function whyYes(r) {
    const parts = [];
    if (r.record?.status === "yes" && r.record.reasons?.length) parts.push(r.record.reasons[0].text);
    if (r.fieldAccess?.status === "yes" && r.fieldAccess.readBy?.length) parts.push(`field read from ${firstLabel(r.fieldAccess.readBy)}`);
    if (!parts.length && r.object?.readBy?.length) parts.push(`object read from ${firstLabel(r.object.readBy)}`);
    return parts.length ? h("p", { class: "muted", style: "margin:8px 0 0 40px" }, `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase())) : null;
  }

  function renderExplain(r) {
    const v = r.verdict;
    const what = r.field ? `the ${r.field} field on this record` : "this record";
    const answer = { yes: `Can see ${what}.`, no: `Can't see ${what}.`, unknown: `Can't tell yet whether they can see ${what}.` }[v.status];
    return [
      h("section", { class: `pass v-${v.status}`, "aria-label": "Result" },
        holder(r.user),
        h("div", { class: "answer" }, statusDot(v.status), h("span", {}, answer)),
        v.reasons.length ? h("ul", {}, v.reasons.map((x) => h("li", {}, x))) : null,
        v.status === "yes" ? whyYes(r) : null),
      h("div", { class: "row", style: "margin-top:10px" }, copyButton(r.ticket)),
      fixes(r),
      h("div", { class: "checks" }, objectRow(r), fieldRow(r), recordRow(r),
        h("details", { class: "check" },
          h("summary", {}, h("span", { class: "dot s-na" }, icon("user")),
            h("span", { class: "what" }, h("div", { class: "title" }, "Where their permissions come from"),
              h("div", { class: "line" }, `${r.sources.length} source${r.sources.length === 1 ? "" : "s"} checked`)), icon("chevron")),
          h("div", { class: "body" }, sourceList(r.sources) ?? h("p", { class: "muted" }, "None."),
            r.expired?.length ? h("p", { class: "muted small" }, `Expired and ignored: ${r.expired.map((s) => s.label).join(", ")}.`) : null,
            r.componentsError ? h("p", { class: "muted small" }, `Couldn't break down permission set groups: ${r.componentsError}`) : null))),
      h("div", { class: "row", style: "margin-top:14px" },
        h("button", { class: "btn btn-ghost btn-small", onclick: () => send({ type: "openWorkspace", user: r.user.id }) },
          icon("workspace"), "See everything this person can do in the org")),
    ];
  }

  // ---------- Fields ----------

  const fm = { picker: userPicker(send, "Whose field access?", key), out: h("div"), data: null };
  fm.filter = h("input", { type: "search", placeholder: "Name or label" });
  fm.show = h("select", {}, h("option", { value: "all" }, "All fields"), h("option", { value: "none" }, "No access"),
    h("option", { value: "read" }, "Read only"), h("option", { value: "edit" }, "Can edit"), h("option", { value: "always" }, "Always visible"));
  fm.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("fields"), "Show field access");
  fm.filters = h("div", { class: "two", hidden: true }, h("div", {}, h("label", {}, "Filter"), fm.filter), h("div", {}, h("label", {}, "Show"), fm.show));
  fm.picker.onChange = () => { fm.btn.disabled = !(fm.picker.user && state.ctx); };
  fm.btn.addEventListener("click", () => run(send, fm.btn, fm.out, async () => {
    fm.data = await send({ type: "fieldMatrix", params: { userId: fm.picker.user.id, sobject: state.ctx.sobject } });
    fm.filters.hidden = fm.data.status !== "ok";
    return renderMatrix();
  }, "Reading field-level security…"));
  const rerender = () => { if (fm.data) fm.out.replaceChildren(...renderMatrix()); };
  fm.filter.addEventListener("input", rerender);
  fm.show.addEventListener("change", rerender);
  const fieldsEmpty = () => empty("fields", "Pick a person to see their field access", "Every field on this object, with whether they can edit, read or not see it, and which permission grants it.");
  fm.out.append(fieldsEmpty());
  const fieldsView = h("div", { hidden: true },
    h("p", { class: "lead" }, "What can someone do with each field on this object?"),
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
      d.object.status !== "yes" ? h("div", { class: "err" }, icon("alert"), h("div", {}, `${d.user.name} can't read ${d.sobject} at all, so none of these fields are visible to them.`)) : null,
      h("div", { class: "counts" }, ["edit", "read", "none", "always"].map((k) => statusPill(k, `${ACCESS[k]}: ${counts[k] || 0}`))),
      rows.length ? h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Access"), h("th", {}, "Granted by"))),
        h("tbody", {}, rows.map((f) => h("tr", {},
          h("td", {}, h("div", {}, f.label), h("div", { class: "api muted" }, f.name)),
          h("td", {}, statusPill(f.access, ACCESS[f.access]), f.muted ? h("div", { class: "muted small" }, "Muted in a group") : null),
          h("td", { class: "muted" }, f.access === "always" ? "No field-level security" : (f.access === "edit" ? f.editBy : f.readBy).join(", ") || "Nobody")))))
        : h("p", { class: "muted" }, "No fields match these filters."),
    ];
  }

  // ---------- Compare ----------

  const cp = { a: userPicker(send, "First person", key), b: userPicker(send, "Second person", key), field: fieldInput(), out: h("div") };
  cp.btn = h("button", { class: "btn btn-primary", disabled: true }, icon("compare"), "Compare access");
  cp.a.onChange = cp.b.onChange = () => { cp.btn.disabled = !(cp.a.user && cp.b.user && state.ctx); };
  cp.btn.addEventListener("click", () => run(send, cp.btn, cp.out, async () => renderCompare(await send({
    type: "compare",
    params: { userIdA: cp.a.user.id, userIdB: cp.b.user.id, sobject: state.ctx.sobject, recordId: state.ctx.recordId, field: cp.field.value.trim() || null },
  })), "Checking both people…"));
  const compareEmpty = () => empty("compare", "Pick two people", "Useful when one person sees something and a colleague doesn't: you'll get the permission that makes the difference.");
  cp.out.append(compareEmpty());
  const compareView = h("div", { hidden: true },
    h("p", { class: "lead" }, "Why can one person see this and another can't?"),
    cp.a.el, cp.b.el, fieldLabel(), cp.field, cp.btn, cp.out);

  function renderCompare(c) {
    const col = (r) => h("div", {}, avatar(r.user.name), h("div", { class: "name" }, r.user.name), h("div", { class: "sub" }, userLine(r.user)),
      h("div", { class: "lines" },
        h("div", {}, "Object", statusPill(r.object.status)),
        r.fieldAccess.status !== "skipped" ? h("div", {}, "Field", statusPill(r.fieldAccess.status)) : null,
        r.record.status !== "skipped" ? h("div", {}, "Record", statusPill(r.record.status)) : null));
    const list = (title, items, fallback) => h("div", {}, h("h3", {}, title), sourceList(items) ?? h("p", { class: "muted" }, fallback));
    return [
      h("div", { class: "holders" }, col(c.a), col(c.b)),
      h("h3", {}, "What's different"),
      c.differences.length
        ? h("ul", { class: "diffs" }, c.differences.map((d) => h("li", {},
            h("span", { class: "dot s-read" }, icon("compare")),
            h("div", {}, h("div", { class: "title" }, `${d.check}: ${STATUS[d.a].toLowerCase()} for ${c.a.user.name}, ${STATUS[d.b].toLowerCase()} for ${c.b.user.name}`),
              h("div", { class: "muted" }, d.explanation ?? "No single permission explains this difference.")))))
        : h("p", { class: "muted" }, "Both get the same result."),
      list(`Only ${c.a.user.name} has`, c.onlyA, "Nothing extra."),
      list(`Only ${c.b.user.name} has`, c.onlyB, "Nothing extra."),
      list("Both have", c.common, "Nothing in common."),
    ];
  }

  // ---------- History ----------

  const hi = { out: h("div"), logsOut: h("div") };
  hi.btn = h("button", { class: "btn btn-primary", disabled: true, style: "margin-top:12px" }, icon("clock"), "Show timeline");
  hi.logsBtn = h("button", { class: "btn btn-secondary", disabled: true, style: "margin-top:12px" }, icon("search"), "Scan debug logs");
  const KIND_LABEL = { created: "Created", modified: "Modified", field: "Field change", activity: "Activity", email: "Email" };
  const when = (iso) => { const d = new Date(iso); return [d.toLocaleDateString(), d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })]; };
  hi.btn.addEventListener("click", () => run(send, hi.btn, hi.out, async () => {
    const t = await send({ type: "timeline", params: { sobject: state.ctx.sobject, recordId: state.ctx.recordId } });
    return [
      t.events.length ? h("ol", { class: "timeline" }, t.events.map((e) => {
        const [day, time] = when(e.at);
        return h("li", {}, h("div", { class: "when" }, h("div", {}, day), h("div", {}, time)),
          h("div", {}, h("div", {}, e.text), h("div", { class: "who" }, `${KIND_LABEL[e.kind] ?? e.kind}${e.who ? ` by ${e.who}` : ""}`)));
      })) : empty("clock", "Nothing recorded yet", "No history, activities or emails were found for this record."),
      notes(t.notes),
    ];
  }, "Gathering history…"));
  hi.logsBtn.addEventListener("click", () => run(send, hi.logsBtn, hi.logsOut, async () => {
    const r = await send({ type: "scanLogs", params: { recordId: state.ctx.recordId, limit: 20 } });
    const head = h("p", { class: "muted" }, `Read the ${r.scanned} most recent debug logs${r.failed ? ` (${r.failed} couldn't be opened)` : ""}; ${r.matches.length} mention this record.`);
    if (!r.matches.length) {
      return [head, empty("search", "No logs mention this record", "Debug logs only exist while a trace flag is on. In Setup, open Debug Logs, add a trace flag for the person, repeat what they did, then scan again.")];
    }
    return [head, ...r.matches.map((m) => {
      const [day, time] = when(m.at);
      return h("div", { class: "log" },
        h("div", {}, h("b", {}, `${day} ${time}`), ` by ${m.user}`),
        m.flows.length ? h("div", {}, `Flows: ${m.flows.join(", ")}`) : null,
        m.triggers.length ? h("div", {}, `Triggers: ${m.triggers.join(", ")}`) : null,
        m.validations.length ? h("div", {}, `Validation rules checked: ${m.validations.join(", ")}`) : null,
        m.failures.length ? h("div", { style: "color:var(--no)" }, m.failures.join(", ")) : null,
        m.errors.length ? h("div", { style: "color:var(--no)" }, `Errors: ${m.errors.join("; ")}`) : null);
    })];
  }, "Reading debug logs…"));
  const historyView = h("div", { hidden: true },
    h("p", { class: "lead" }, "What happened to this record, and who did it?"),
    h("div", { class: "two" }, hi.btn, hi.logsBtn),
    hi.out, hi.logsOut);

  // ---------- shell ----------

  const views = { Explain: explainView, Fields: fieldsView, Compare: compareView, History: historyView };
  const { nav } = tabs(views, {}, { Explain: "shield", Fields: "fields", Compare: "compare", History: "clock" });
  const ctxEl = h("div", { class: "ctx" });
  const panel = h("div", { class: "panel", hidden: true, role: "dialog", "aria-label": "OrgClearance" },
    h("header", {},
      h("div", { class: "bar" }, logo(26), h("span", { class: "brand" }, "OrgClearance"),
        h("button", { class: "iconbtn", title: "Open the workspace: user overview, audit, docs, org comparison", "aria-label": "Open workspace", onclick: () => send({ type: "openWorkspace" }) }, icon("workspace")),
        h("button", { class: "iconbtn", title: "Settings", "aria-label": "Settings", onclick: () => send({ type: "openOptions" }) }, icon("settings")),
        h("button", { class: "iconbtn", title: "Close (Alt+Shift+A)", "aria-label": "Close", onclick: toggle }, icon("close"))),
      ctxEl, nav),
    h("div", { class: "panel-body" }, ...Object.values(views), fieldList));
  const fab = h("button", { class: "fab", "aria-label": "Open OrgClearance (Alt+Shift+A)", onclick: toggle },
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
      ctxEl.replaceChildren(icon("alert"), "Open a record to use these tabs. Org-wide tools are in the workspace.");
      return refreshButtons();
    }
    if (state.ctx && ctx.recordId === state.ctx.recordId) return;
    state.ctx = null;
    ctxEl.replaceChildren(h("span", { class: "spinner" }), "Reading this record…");
    try {
      if (!ctx.sobject) ctx.sobject = await send({ type: "resolveObject", recordId: ctx.recordId });
      state.ctx = ctx;
      ctxEl.replaceChildren("Checking ", h("b", {}, ctx.sobject), h("span", { class: "api" }, ctx.recordId));
      const fields = await send({ type: "listFields", sobject: ctx.sobject });
      fieldList.replaceChildren(...fields.map((f) => h("option", { value: f.name, label: f.label })));
      ex.out.replaceChildren(explainEmpty());
      fm.out.replaceChildren(fieldsEmpty());
      cp.out.replaceChildren(compareEmpty());
      [hi.out, hi.logsOut].forEach((o) => o.replaceChildren());
      fm.data = null;
      fm.filters.hidden = true;
    } catch (e) {
      ctxEl.replaceChildren(errorBox(e));
    }
    refreshButtons();
  }
  function refreshButtons() {
    [ex.picker, fm.picker, cp.a].forEach((p) => p.onChange());
    hi.btn.disabled = hi.logsBtn.disabled = !state.ctx;
  }
})();
