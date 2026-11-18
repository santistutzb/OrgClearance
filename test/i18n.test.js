// Spanish coverage: every literal passed to the translator has a Spanish entry with the same
// placeholders, and the panel and workspace render in Spanish without falling back to English.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "../i18n.js";

const I18N = globalThis.OrgClearanceI18n;
const root = new URL("..", import.meta.url).pathname;
const FILES = ["background.js", "ui.js", "content.js", "workspace.js", "options.js",
  ...fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`)];

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => JSON.parse(`"${s}"`);
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Literal keys handed to t()/tr()/tn(), including both sides of a ternary inside the call. */
function keysIn(src) {
  const keys = new Set();
  const call = /\b(?:t|tr|tn|I18N\.t|I18N\.tn)\(/g;
  for (const m of src.matchAll(call)) {
    // Read the call's arguments up to the matching parenthesis.
    let depth = 1, i = m.index + m[0].length, inStr = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") inStr = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    const args = src.slice(m.index + m[0].length, i - 1);
    // Literals that are the text itself: the first argument, tn's two forms, ternary branches.
    const top = args.replace(/\{[^{}]*\}\s*\)?\s*$/, ""); // drop the trailing vars object
    for (const s of top.matchAll(new RegExp(STR, "g"))) keys.add(unq(s[1]));
  }
  return keys;
}

test("i18n: every translated literal has a Spanish entry with the same placeholders", () => {
  const missing = [], badHoles = [];
  for (const f of FILES) {
    for (const k of keysIn(fs.readFileSync(path.join(root, f), "utf8"))) {
      if (k.length < 2 || !/[A-Za-z]/.test(k) || /^[a-z]+(?:[A-Z][a-z]+)*$/.test(k) && !(k in I18N.ES)) continue; // identifiers (data keys), not text
      if (!Object.prototype.hasOwnProperty.call(I18N.ES, k)) missing.push(`${f}: ${k}`);
      else if (holes(k) !== holes(I18N.ES[k])) badHoles.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(missing, [], "missing Spanish translations");
  assert.deepEqual(badHoles, [], "placeholders differ between English and Spanish");
});

test("i18n: language detection and fallback", () => {
  assert.equal(I18N.detect("es"), "es");
  assert.equal(I18N.detect("en"), "en");
  I18N.setLang("es");
  assert.equal(I18N.t("Yes"), "Sí");
  assert.equal(I18N.t("Only in {org}", { org: "dev" }), "Solo en dev");
  assert.equal(I18N.tn(2, "{n} source checked", "{n} sources checked"), "2 fuentes revisadas");
  assert.equal(I18N.t("Not a real key {x}", { x: 1 }), "Not a real key 1", "unknown text falls back to English");
  I18N.setLang("en");
  assert.equal(I18N.t("Yes"), "Yes");
});
