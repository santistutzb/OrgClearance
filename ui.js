// @ts-check
// Shared UI kit for the panel (content script), workspace and settings pages.
// Classic script: exposes globalThis.OrgClearanceUI. Org data always goes in through textContent;
// innerHTML is only used for the constant icon markup defined in this file.
(() => {
  if (globalThis.OrgClearanceUI) return;
  const I18N = globalThis.OrgClearanceI18n;
  const t = (k, v) => I18N.t(k, v);
  // Label maps read the language when used, not when this script loads (the saved choice loads async).
  const lazy = (o) => Object.defineProperties({}, Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { get: () => t(v), enumerable: true }])));

  /** @param {string} tag @param {Record<string, any>} [props] @param {...any} children @returns {any} */
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    // Flatten fully: sections often pass [heading, list] groups inside other arrays.
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
    return el;
  }

  // ---------- icons (constant markup, 24px grid, stroke = currentColor) ----------

  const ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.6"/><path d="M12 17h.01"/>',
    minus: '<path d="M7 12h10"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>',
    shield: '<path d="M12 3l7.5 2.8V12c0 4.6-3.2 7.7-7.5 9-4.3-1.3-7.5-4.4-7.5-9V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    fields: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    compare: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M8 11v2a3 3 0 0 0 3 3h2M16 13v-2a3 3 0 0 0-3-3h-2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    audit: '<path d="M9 4.5h6v3H9z"/><path d="M7.5 5.5H5.5v15h13v-15h-2"/><path d="M9 14l2 2 4-4.5"/>',
    docs: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14 3.5v4.5h4.5M9.5 13h6M9.5 16.5h4"/>',
    orgs: '<rect x="3.5" y="5" width="7" height="14" rx="1.5"/><rect x="13.5" y="5" width="7" height="14" rx="1.5"/><path d="M6 9h2M16 9h2M6 12.5h2M16 12.5h2"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13"/><path d="M17.5 14v5.5h-13v-13H10"/>',
    download: '<path d="M12 4.5V15M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14"/>',
    chevron: '<path d="M7 10l5 5 5-5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
    workspace: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  };
  const LOGO = '<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#0E4D5C"/><path d="M58 18 L93 30 V57 C93 80 79 95 58 104 C37 95 23 80 23 57 V30 Z" fill="#fff"/><path d="M41 60 L53 72 L75 48" fill="none" stroke="#0E4D5C" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><line x1="98" y1="98" x2="112" y2="112" stroke="#0E4D5C" stroke-width="16" stroke-linecap="round"/><circle cx="86" cy="86" r="19" fill="#0E4D5C"/><line x1="98" y1="98" x2="110" y2="110" stroke="#F2B33D" stroke-width="8" stroke-linecap="round"/><circle cx="86" cy="86" r="13" fill="none" stroke="#F2B33D" stroke-width="7"/></svg>';

  /** @param {keyof typeof ICONS} name @param {string} [cls] */
  function icon(name, cls = "") {
    const span = document.createElement("span");
    span.className = `ic ${cls}`.trim();
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
    return span;
  }
  function logo(size = 24) {
    const span = document.createElement("span");
    span.className = "logo";
    span.style.width = span.style.height = `${size}px`;
    span.innerHTML = LOGO;
    return span;
  }

  // ---------- tokens + components ----------

  const CSS = `
    :host, :root {
      --ink: #1C2230; --muted: #5B6475; --faint: #8A93A3; --line: #E2E6EC; --wash: #F4F6F9; --surface: #FFFFFF;
      --brand: #0E4D5C; --brand-ink: #0A3A46; --brand-soft: #E3EFF1; --signal: #F2B33D;
      --yes: #1E7A4C; --yes-soft: #E4F3EA; --no: #B3261E; --no-soft: #FBE9E7; --unknown: #8A5A00; --unknown-soft: #FFF3D6;
      --na: #4A5568; --na-soft: #EEF1F5;
      --font: "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      --r-control: 8px; --r-card: 14px;
    }
    .ic { display: inline-flex; width: 18px; height: 18px; flex: none; vertical-align: -4px; }
    .ic svg { width: 100%; height: 100%; }
    .logo { display: inline-flex; flex: none; } .logo svg { width: 100%; height: 100%; }
    h2 { font-size: 17px; line-height: 1.3; margin: 0; font-weight: 700; color: var(--ink); }
    h3 { font-size: 14px; margin: 18px 0 6px; font-weight: 700; color: var(--ink); }
    p { margin: 6px 0; }
    label { display: block; font-weight: 700; font-size: 13px; margin: 14px 0 6px; color: var(--ink); }
    label .opt { font-weight: 400; color: var(--muted); }
    input, select { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #C9D0DA; border-radius: var(--r-control);
      font: inherit; font-size: 14px; color: var(--ink); background: var(--surface); }
    input::placeholder { color: var(--faint); }
    input:focus, select:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
    .search { position: relative; }
    .search .ic { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--faint); pointer-events: none; }
    .search input { padding-left: 36px; }
    button { font: inherit; cursor: pointer; }
    button:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid var(--brand-soft); outline-offset: 2px; border-radius: 6px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: var(--r-control);
      border: 1px solid transparent; font-weight: 700; font-size: 14px; line-height: 1.2; }
    .btn-primary { background: var(--brand); color: #fff; width: 100%; margin-top: 16px; }
    .btn-primary:hover:not(:disabled) { background: var(--brand-ink); }
    .btn-primary:disabled { background: #B9CDD2; cursor: default; }
    .btn-secondary { background: var(--surface); color: var(--brand); border-color: #B9CDD2; }
    .btn-secondary:hover:not(:disabled) { background: var(--brand-soft); }
    .btn-secondary:disabled { color: var(--faint); cursor: default; }
    .btn-small { padding: 6px 10px; font-size: 13px; }
    .btn-ghost { background: none; border: 0; color: var(--brand); padding: 4px 6px; font-weight: 700; }
    .btn-ghost:hover { background: var(--brand-soft); border-radius: 6px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .two { display: flex; gap: 10px; } .two > * { flex: 1; min-width: 0; }
    .muted { color: var(--muted); font-size: 13px; }
    .small { font-size: 12px; }
    .api { font-family: var(--mono); font-size: 12px; word-break: break-all; }

    /* user picker */
    .hits { border: 1px solid var(--line); border-radius: var(--r-control); margin-top: 6px; background: var(--surface); overflow: hidden; }
    .hit { display: flex; gap: 10px; align-items: center; padding: 8px 10px; cursor: pointer; border: 0; border-bottom: 1px solid var(--line);
      width: 100%; background: none; text-align: left; color: var(--ink); }
    .hit:last-child { border-bottom: 0; } .hit:hover, .hit:focus-visible { background: var(--wash); }
    .hit .who { min-width: 0; } .hit .name { font-weight: 700; } .hit .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; flex: none;
      background: var(--brand-soft); color: var(--brand); font-weight: 700; font-size: 12px; }
    .avatar.lg { width: 40px; height: 40px; font-size: 15px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
    .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); background: var(--surface); border-radius: 999px;
      padding: 3px 10px 3px 3px; font-size: 13px; color: var(--ink); }
    .chip .avatar { width: 22px; height: 22px; font-size: 10px; }
    .chip:hover { border-color: #B9CDD2; background: var(--wash); }
    .picked { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-control); background: var(--wash); }
    .picked .who { flex: 1; min-width: 0; }

    /* status */
    .status { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 2px 9px 2px 6px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .status .ic { width: 14px; height: 14px; vertical-align: 0; }
    .s-yes { background: var(--yes-soft); color: var(--yes); } .s-no { background: var(--no-soft); color: var(--no); }
    .s-unknown { background: var(--unknown-soft); color: var(--unknown); } .s-na, .s-always { background: var(--na-soft); color: var(--na); }
    .s-edit { background: var(--yes-soft); color: var(--yes); } .s-read { background: var(--brand-soft); color: var(--brand); } .s-none { background: var(--no-soft); color: var(--no); }
    .dot { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; flex: none; }
    .dot .ic { width: 15px; height: 15px; vertical-align: 0; }

    /* verdict pass: the one bold element */
    .pass { position: relative; margin-top: 18px; border: 1px solid var(--line); border-radius: var(--r-card); padding: 14px 16px 14px 22px; background: var(--surface); overflow: hidden; }
    .pass::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; background: var(--stripe); }
    .pass.v-yes { --stripe: var(--yes); } .pass.v-no { --stripe: var(--no); } .pass.v-unknown { --stripe: var(--signal); }
    .pass .holder { display: flex; gap: 10px; align-items: center; }
    .pass .holder .who { flex: 1; min-width: 0; } .pass .holder .name { font-weight: 700; } .pass .holder .sub { font-size: 12px; color: var(--muted); }
    .pass .answer { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-size: 17px; font-weight: 700; line-height: 1.35; }
    .pass .answer .dot { width: 30px; height: 30px; margin-top: -2px; } .pass .answer .dot .ic { width: 18px; height: 18px; }
    .pass ul { margin: 10px 0 0; padding-left: 20px; color: var(--ink); font-size: 13px; }

    /* expandable check rows */
    .checks { margin-top: 14px; border-top: 1px solid var(--line); }
    details.check { border-bottom: 1px solid var(--line); }
    details.check > summary { list-style: none; display: flex; gap: 10px; align-items: center; padding: 11px 2px; cursor: pointer; }
    details.check > summary::-webkit-details-marker { display: none; }
    details.check > summary .what { flex: 1; min-width: 0; }
    details.check > summary .title { font-weight: 700; } details.check > summary .line { font-size: 12px; color: var(--muted); }
    details.check > summary > .ic:last-child { color: var(--faint); transition: transform .15s; }
    details.check[open] > summary > .ic:last-child { transform: rotate(180deg); }
    details.check .body { padding: 0 2px 12px 36px; font-size: 13px; }
    details.check .body ul { margin: 4px 0 8px; padding-left: 18px; }
    @media (prefers-reduced-motion: reduce) { details.check > summary > .ic:last-child { transition: none; } }

    /* sections that group results (audit, org diff) */
    details.group { border: 1px solid var(--line); border-radius: var(--r-control); margin-top: 8px; background: var(--surface); }
    details.group > summary { list-style: none; display: flex; gap: 10px; align-items: center; padding: 11px 12px; cursor: pointer; font-weight: 700; }
    details.group > summary::-webkit-details-marker { display: none; }
    details.group > summary .grow { flex: 1; }
    details.group > summary > .ic:last-child { color: var(--faint); transition: transform .15s; }
    details.group[open] > summary > .ic:last-child { transform: rotate(180deg); }
    details.group .body { padding: 0 12px 12px; }
    .count { display: inline-flex; min-width: 26px; justify-content: center; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }

    /* empty, loading, errors */
    .empty { display: flex; gap: 12px; align-items: flex-start; padding: 16px; margin-top: 16px; border: 1px dashed #C9D0DA; border-radius: var(--r-card); color: var(--muted); }
    .empty .ic { width: 22px; height: 22px; color: var(--brand); }
    .empty b { display: block; color: var(--ink); margin-bottom: 2px; }
    .loading { display: flex; gap: 10px; align-items: center; margin-top: 18px; color: var(--muted); }
    .spinner { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--brand-soft); border-top-color: var(--brand); animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-top-color: var(--brand-soft); border-right-color: var(--brand); } }
    .err { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 10px 12px; border-radius: var(--r-control); background: var(--no-soft); color: var(--no); font-size: 13px; }
    .err .ic { width: 18px; height: 18px; }
    .note { margin-top: 10px; padding: 10px 12px; border-radius: var(--r-control); background: var(--wash); color: var(--muted); font-size: 12px; }
    .note ul { margin: 0; padding-left: 18px; }
    .usage { color: var(--faint); font-size: 11px; margin-top: 16px; }

    /* tables */
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th { text-align: left; font-size: 12px; font-weight: 700; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); }
    td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    td.c { text-align: center; } td.nowrap { white-space: nowrap; }
    tr:hover td { background: #FAFBFC; }

    /* tabs */
    .tabs { display: flex; gap: 2px; padding: 3px; background: var(--wash); border-radius: 10px; }
    .tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; background: none;
      padding: 7px 8px; border-radius: 8px; color: var(--muted); font-weight: 700; font-size: 13px; }
    .tabs button .ic { width: 16px; height: 16px; vertical-align: 0; }
    .tabs button:hover { color: var(--ink); }
    .tabs button[aria-selected="true"] { background: var(--surface); color: var(--brand); border-color: var(--line); }
    .lead { color: var(--muted); font-size: 13px; margin: 2px 0 4px; }
    [hidden] { display: none !important; }
  `;

  // Font files ship with the extension. Pages load them relatively; the panel registers them
  // on the Salesforce page (fonts can't be declared inside a shadow root). Falls back to system UI.
  function fontFaceCss(base) {
    return ["400", "700"].map((w) => ["latin", "latin-ext"].map((sub) =>
      `@font-face{font-family:"Atkinson Hyperlegible";font-style:normal;font-display:swap;font-weight:${w};` +
      `src:url("${base}fonts/atkinson-hyperlegible-${sub}-${w}-normal.woff2") format("woff2");}`).join("")).join("");
  }

  // ---------- messaging + API usage meter ----------

  function makeSend(extra = () => ({})) {
    const usage = { calls: 0, cached: 0, orgUsage: null };
    /** @param {Record<string, any>} msg */
    const send = (msg) => new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({ lang: I18N.getLang(), ...extra(), ...msg }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.meta) {
          usage.calls += res.meta.calls || 0;
          usage.cached += res.meta.cached || 0;
          if (res.meta.orgUsage) usage.orgUsage = res.meta.orgUsage;
        }
        res?.ok ? resolve(res.data) : reject(new Error(res?.error || t("Something went wrong. Try again.")));
      }));
    send.usage = usage;
    send.resetUsage = () => { usage.calls = 0; usage.cached = 0; };
    return send;
  }

  function usageLine(usage) {
    const m = /api-usage=(\d+)\/(\d+)/.exec(usage.orgUsage || "");
    const parts = [I18N.tn(usage.calls, "{n} API call", "{n} API calls") + (usage.cached ? t(", {n} from cache", { n: usage.cached }) : "")];
    if (m) parts.push(t("org usage today {used} of {max}", { used: Number(m[1]).toLocaleString(), max: Number(m[2]).toLocaleString() }));
    return h("div", { class: "usage" }, t("Used {parts}.", { parts: parts.join("; ") }));
  }

  const loading = (text = undefined) => h("div", { class: "loading", role: "status" }, h("span", { class: "spinner" }), text ?? t("Checking…"));
  const errorBox = (e) => h("div", { class: "err", role: "alert" }, icon("alert"), h("div", {}, e.message));
  const empty = (iconName, title, text) => h("div", { class: "empty" }, icon(iconName), h("div", {}, h("b", {}, title), text));
  const notes = (list) => list?.length ? h("div", { class: "note" }, h("ul", {}, list.map((n) => h("li", {}, n)))) : null;

  /** Runs an action: disables the button, shows progress, renders the result and the API usage. */
  async function run(send, btn, out, fn, loadingText) {
    btn.disabled = true;
    send.resetUsage();
    out.replaceChildren(loading(loadingText));
    try { out.replaceChildren(...[].concat(await fn()).flat().filter((x) => x != null && x !== false), usageLine(send.usage)); }
    catch (e) { out.replaceChildren(errorBox(e)); }
    btn.disabled = false;
  }

  // ---------- small renderers ----------

  const STATUS = lazy({ yes: "Yes", no: "No", unknown: "Can't tell", na: "Doesn't apply" });
  const STATUS_ICON = { yes: "check", no: "x", unknown: "help", na: "minus" };
  const ACCESS = lazy({ edit: "Edit", read: "Read", none: "None", always: "Always" });
  const KIND = lazy({ profile: "Profile", permset: "Permission set", group: "Permission set group" });

  const statusPill = (status, text) => h("span", { class: `status s-${status}` },
    STATUS_ICON[status] ? icon(STATUS_ICON[status]) : null, text ?? STATUS[status] ?? status);
  const statusDot = (status) => h("span", { class: `dot s-${status}` }, icon(STATUS_ICON[status] ?? "minus"));
  const badge = statusPill; // older name
  const sourceItem = (s) => `${KIND[s.kind]}: ${s.label}` + (s.via?.length ? ` (via ${s.via.join(", ")})` : "");
  const sourceList = (items) => items?.length ? h("ul", {}, items.map((s) => h("li", {}, sourceItem(s)))) : null;
  const labels = (items) => items?.length ? items.map((s) => s.label).join(", ") : "nobody";
  const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
  const avatar = (name, cls = "") => h("span", { class: `avatar ${cls}`.trim(), "aria-hidden": "true" }, initials(name));
  const userLine = (u) => [u.profileName ?? t("No profile"), u.roleName].filter(Boolean).join(", ");

  /** Collapsible row: status dot, title, one-line summary, details below. */
  function checkRow(status, title, line, body, open = false) {
    return h("details", { class: "check", open },
      h("summary", {}, statusDot(status), h("span", { class: "what" }, h("div", { class: "title" }, title), line ? h("div", { class: "line" }, line) : null), icon("chevron")),
      h("div", { class: "body" }, body));
  }

  // ---------- downloads ----------

  function download(container, filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = h("a", { href: url, download: filename });
    container.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  // Org data goes into CSVs; a value starting with = + - @ (or a tab/CR) would run as a spreadsheet formula.
  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (cols, rows) => [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- user picker with recent users ----------

  const orgKey = (host) => String(host || "").toLowerCase()
    .replace(".lightning.force.com", ".my.salesforce.com").replace(".my.salesforce-setup.com", ".my.salesforce.com");
  const RECENT_MAX = 8;

  /** @returns {Promise<any[]>} */
  async function getRecent(key) {
    try { const v = (await chrome.storage.local.get(`recent:${key}`))[`recent:${key}`]; return Array.isArray(v) ? v : []; } catch { return []; }
  }
  async function addRecent(key, u) {
    try {
      const list = [u, ...(await getRecent(key)).filter((x) => x.id !== u.id)].slice(0, RECENT_MAX);
      await chrome.storage.local.set({ [`recent:${key}`]: list.map(({ id, name, username, isActive, profileName, roleName }) => ({ id, name, username, isActive, profileName, roleName })) });
    } catch { /* storage unavailable */ }
  }

  /**
   * @param {any} send
   * @param {string} labelText
   * @param {() => string} getKey returns the org key for recent users
   */
  function userPicker(send, labelText, getKey) {
    let user = null;
    const input = h("input", { type: "search", placeholder: t("Search by name, username or email"), "aria-label": labelText, autocomplete: "off" });
    const searchBox = h("div", { class: "search" }, icon("search"), input);
    const hits = h("div");
    const picked = h("div", { hidden: true });
    let timer;
    const picker = {
      el: h("div", {}, h("label", {}, labelText), searchBox, picked, hits),
      get user() { return user; },
      onChange: () => {},
      clear() { user = null; input.value = ""; hits.replaceChildren(); picked.hidden = true; searchBox.hidden = false; },
    };
    const choose = (u) => {
      user = u; hits.replaceChildren();
      picked.replaceChildren(h("div", { class: "picked" }, avatar(u.name),
        h("div", { class: "who" }, h("div", { class: "name" }, u.name + (u.isActive === false ? t(" (inactive)") : "")), h("div", { class: "sub muted small" }, u.username)),
        h("button", { class: "btn btn-ghost btn-small", onclick: () => { picker.clear(); picker.onChange(); input.focus(); } }, t("Change"))));
      picked.hidden = false; searchBox.hidden = true;
      picker.onChange();
      addRecent(getKey(), u);
    };
    const showRecent = async () => {
      if (input.value.trim()) return;
      const recent = await getRecent(getKey());
      hits.replaceChildren(recent.length
        ? h("div", { class: "chips" }, h("span", { class: "muted small" }, t("Recent:")),
            recent.map((u) => h("button", { class: "chip", title: u.username, onclick: () => choose(u) }, avatar(u.name), u.name)))
        : "");
    };
    input.addEventListener("focus", showRecent);
    input.addEventListener("input", () => {
      user = null; picker.onChange();
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const term = input.value.trim();
        if (term.length < 2) return term ? hits.replaceChildren() : showRecent();
        try {
          const users = await send({ type: "searchUsers", term });
          hits.replaceChildren(users.length
            ? h("div", { class: "hits" }, users.map((u) =>
                h("button", { class: "hit", onclick: () => choose(u) }, avatar(u.name),
                  h("span", { class: "who" }, h("div", { class: "name" }, u.name + (u.isActive ? "" : t(" (inactive)"))),
                    h("div", { class: "sub" }, `${u.username}, ${userLine(u)}`)))))
            : h("div", { class: "muted small", style: "margin-top:6px" }, t("No users match \"{term}\".", { term })));
        } catch (e) { hits.replaceChildren(errorBox(e)); }
      }, 300);
    });
    return picker;
  }

  /** Segmented tabs with icons. views: {name: element}; icons: {name: iconName}. */
  function tabs(views, onSelect = {}, icons = {}) {
    const buttons = Object.keys(views).map((name, i) =>
      h("button", { role: "tab", "aria-selected": i === 0 ? "true" : "false", "data-name": name, onclick: () => select(name) },
        icons[name] ? icon(icons[name]) : null, t(name)));
    function select(name) {
      buttons.forEach((t) => t.setAttribute("aria-selected", t.dataset.name === name ? "true" : "false"));
      Object.entries(views).forEach(([n, v]) => { v.hidden = n !== name; });
      onSelect[name]?.();
    }
    return { nav: h("div", { class: "tabs", role: "tablist" }, buttons), select, buttons };
  }

  globalThis.OrgClearanceUI = {
    h, icon, logo, CSS, fontFaceCss, STATUS, ACCESS, KIND, makeSend, run, usageLine, loading, errorBox, empty, notes,
    statusPill, statusDot, badge, sourceItem, sourceList, labels, initials, avatar, userLine, checkRow,
    download, toCsv, stamp, orgKey, userPicker, tabs, getRecent, addRecent,
  };
})();
