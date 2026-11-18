// @ts-check
// Plain-text summary of an access check, ready to paste into a ticket or a reply to the user.
import "../i18n.js";

const I18N = globalThis.OrgClearanceI18n;
const t = (k, v) => I18N.t(k, v);
const STATUS = { yes: "Yes", no: "No", unknown: "Can't tell", na: "Doesn't apply" };
const status = (s) => t(STATUS[s] ?? s);
const names = (list) => (list?.length ? list.map((s) => s.label).join(", ") : "");

/** @param {any} r result of explainAccess */
export function formatTicket(r, { date = new Date() } = {}) {
  const id = r.recordId ? ` ${r.recordId}` : "";
  const what = r.field ? t("the {field} field on {sobject}{id}", { field: r.field, sobject: r.sobject, id }) : `${r.sobject}${id}`;
  const answer = t({ yes: "Can see it", no: "Can't see it", unknown: "Couldn't confirm" }[r.verdict.status]);
  const lines = [
    t("Access check: {name} ({username}) on {what}", { name: r.user.name, username: r.user.username, what }),
    t("Result: {answer}", { answer }),
  ];
  if (r.verdict.reasons.length) lines.push("", t("Why:"), ...r.verdict.reasons.map((x) => `- ${x}`));

  lines.push("", t("Details:"));
  const o = r.object;
  lines.push(`- ${t("Object {sobject}", { sobject: r.sobject })}: ${status(o.status)}${o.readBy?.length ? ` (${t("read from {sources}", { sources: names(o.readBy) })})` : ""}`);
  const f = r.fieldAccess;
  if (f && f.status !== "skipped") {
    const extra = f.readBy?.length ? ` (${t("read from {sources}", { sources: names(f.readBy) })})` : f.status === "no" ? ` (${t("field-level security")})` : "";
    lines.push(`- ${t("Field {field}", { field: r.field })}: ${status(f.status)}${extra}`);
  }
  const sc = r.screen;
  if (sc && sc.status !== "skipped") {
    const where = sc.layout ? ` (${sc.recordType ? t("layout: {layout}, record type: {recordType}", { layout: sc.layout.name, recordType: sc.recordType.name }) : t("layout: {layout}", { layout: sc.layout.name })})` : "";
    lines.push(`- ${t("On their page")}: ${status(sc.status)}${where}`);
  }
  const c = r.record;
  if (c && c.status !== "skipped") {
    const why = c.reasons?.length ? ` (${c.reasons.map((x) => x.text).join("; ")})` : c.owd ? ` (${t("org-wide default: {label}", { label: c.owd.label })})` : "";
    lines.push(`- ${t("Record")}: ${status(c.status)}${why}`);
  }
  if (r.suggestions?.length) {
    const cap = (s) => s.replace(/^(?:Or|O) /, "").replace(/^./, (ch) => ch.toUpperCase());
    const groups = problemGroups(r);
    lines.push("", groups.length > 1 ? t("Suggested fix (each part needs one of its options):") : t("Suggested fix (pick one):"));
    for (const g of groups) {
      if (groups.length > 1) lines.push(`${g.title}:`);
      lines.push(...g.items.map((s) => `- ${cap(s.title)}. ${s.detail}`));
    }
  }
  lines.push("", t("Checked with OrgClearance on {date}.", { date: date.toISOString().slice(0, 10) }));
  return lines.join("\n");
}

const PROBLEM_TITLE = { user: "User", object: "Object access", field: "Field access", record: "Record sharing" };

/** Suggestions grouped by the problem they solve, in display order. */
export function problemGroups(r) {
  const groups = [];
  for (const s of r.suggestions ?? []) {
    const key = s.problem ?? "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const title = key === "object" ? t("Read on {sobject}", { sobject: r.sobject }) : key === "field" ? t("Read on the {field} field", { field: r.field })
        : key === "screen" ? t("Showing the field on their page") : key === "record" ? t("Access to this record") : t(PROBLEM_TITLE[key] ?? "Other");
      g = { key, title, items: [] };
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}
