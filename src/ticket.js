// @ts-check
// Plain-text summary of an access check, ready to paste into a ticket or a reply to the user.

const STATUS = { yes: "Yes", no: "No", unknown: "Can't tell", na: "Doesn't apply" };
const names = (list) => (list?.length ? list.map((s) => s.label).join(", ") : "");

/** @param {any} r result of explainAccess */
export function formatTicket(r, { date = new Date() } = {}) {
  const what = r.field ? `the ${r.field} field on ${r.sobject} ${r.recordId ?? ""}`.trim() : `${r.sobject} ${r.recordId ?? ""}`.trim();
  const answer = { yes: "Can see it", no: "Can't see it", unknown: "Couldn't confirm" }[r.verdict.status];
  const lines = [
    `Access check: ${r.user.name} (${r.user.username}) on ${what}`,
    `Result: ${answer}`,
  ];
  if (r.verdict.reasons.length) lines.push("", "Why:", ...r.verdict.reasons.map((x) => `- ${x}`));

  lines.push("", "Details:");
  const o = r.object;
  lines.push(`- Object ${r.sobject}: ${STATUS[o.status]}${o.readBy?.length ? ` (read from ${names(o.readBy)})` : ""}`);
  const f = r.fieldAccess;
  if (f && f.status !== "skipped") {
    lines.push(`- Field ${r.field}: ${STATUS[f.status]}${f.readBy?.length ? ` (read from ${names(f.readBy)})` : f.status === "no" ? " (field-level security)" : ""}`);
  }
  const c = r.record;
  if (c && c.status !== "skipped") {
    const why = c.reasons?.length ? ` (${c.reasons.map((x) => x.text).join("; ")})` : c.owd ? ` (org-wide default: ${c.owd.label})` : "";
    lines.push(`- Record: ${STATUS[c.status]}${why}`);
  }
  if (r.suggestions?.length) {
    const cap = (t) => t.replace(/^Or /, "").replace(/^./, (ch) => ch.toUpperCase());
    const groups = problemGroups(r);
    lines.push("", groups.length > 1 ? "Suggested fix (each part needs one of its options):" : "Suggested fix (pick one):");
    for (const g of groups) {
      if (groups.length > 1) lines.push(`${g.title}:`);
      lines.push(...g.items.map((s) => `- ${cap(s.title)}. ${s.detail}`));
    }
  }
  lines.push("", `Checked with OrgClearance on ${date.toISOString().slice(0, 10)}.`);
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
      const title = key === "object" ? `Read on ${r.sobject}` : key === "field" ? `Read on the ${r.field} field` : key === "record" ? "Access to this record" : PROBLEM_TITLE[key] ?? "Other";
      g = { key, title, items: [] };
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}
