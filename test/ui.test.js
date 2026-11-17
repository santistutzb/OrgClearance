// Renders the panel and the workspace with realistic data, expands every section,
// and fails on broken text such as "[object HTMLDivElement]", "undefined" or a stray "null".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const BAD = /\[object |\bundefined\b|\bNaN\b|^\s*null\s*$|\bnull\b(?= *[,.)]|$)/;

function badText(root) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3 && BAD.test(node.textContent)) out.push(node.textContent.trim());
    if (node.shadowRoot) walk(node.shadowRoot);
    node.childNodes?.forEach(walk);
  };
  walk(root);
  return out;
}

function setup(url, extra = []) {
  const dom = new JSDOM(`<!doctype html><head></head><body><div id="app"></div></body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  let shadow;
  const orig = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (o) { shadow = orig.call(this, { ...o, mode: "open" }); return shadow; };
  for (const f of ["test/fixtures/ui-mock.js", ...extra, "ui.js"]) w.eval(read(f));
  return { w, shadow: () => shadow };
}

async function pick(w, scope, index = 0) {
  const input = scope.querySelectorAll("input[type=search]")[index];
  input.value = "an"; input.dispatchEvent(new w.Event("input"));
  await tick(450);
  scope.querySelector(".hit").click();
}

test("panel: every tab renders clean text with all sections expanded", async () => {
  const { w, shadow } = setup("https://acme.lightning.force.com/lightning/r/Account/001000000000001AAA/view");
  w.eval(read("content.js"));
  const r = shadow();
  r.querySelector(".fab").click(); await tick();
  const views = () => [...r.querySelectorAll(".panel-body > div")];
  const visible = () => views().find((v) => !v.hidden);
  const tab = (name) => [...r.querySelectorAll(".tabs button")].find((b) => b.dataset.name === name).click();

  for (const userIndex of [0, 1]) { // Ana (blocked) and Bruno (allowed)
    tab("Explain");
    const v = visible();
    v.querySelector(".picked button")?.click();
    v.querySelector("input[type=search]").value = "an";
    v.querySelector("input[type=search]").dispatchEvent(new w.Event("input")); await tick(450);
    v.querySelectorAll(".hit")[userIndex].click();
    v.querySelector("input[list]").value = "AnnualRevenue";
    v.querySelector(".btn-primary").click(); await tick();
    v.querySelectorAll("details").forEach((d) => { d.open = true; });
    assert.ok(v.querySelector(".pass"), "result card rendered");
    if (userIndex === 0) {
      assert.equal(v.querySelectorAll(".fixes li").length, 4, "fix suggestions rendered");
      assert.equal(v.querySelectorAll(".fixgroup").length, 2, "grouped by problem");
      assert.ok([...v.querySelectorAll("button")].some((b) => b.textContent.includes("Copy for a ticket")), "copy button rendered");
    } else {
      assert.equal(v.querySelector(".fixes"), null, "no fix section when they can see it");
    }
    assert.deepEqual(badText(v), [], `Explain (user ${userIndex})`);
  }

  tab("Fields"); await pick(w, visible()); visible().querySelector(".btn-primary").click(); await tick();
  assert.ok(visible().querySelectorAll("tbody tr").length > 0);
  assert.deepEqual(badText(visible()), [], "Fields");

  tab("Compare"); await pick(w, visible(), 0); await pick(w, visible(), 1);
  visible().querySelector(".btn-primary").click(); await tick();
  visible().querySelectorAll("details").forEach((d) => { d.open = true; });
  assert.ok(visible().querySelector(".diffs"));
  assert.deepEqual(badText(visible()), [], "Compare");

  tab("History");
  visible().querySelector(".btn-primary").click(); visible().querySelector(".btn-secondary").click(); await tick(200);
  assert.ok(visible().querySelectorAll(".timeline li").length > 0);
  assert.deepEqual(badText(visible()), [], "History");
  assert.deepEqual(badText(r), [], "whole panel");
});

test("workspace: every page renders clean text with all sections expanded", async () => {
  const { w } = setup("https://extid.chromiumapp.org/workspace.html", ["test/fixtures/ui-mock-workspace.js"]);
  w.eval(read("workspace.js"));
  await tick(250);
  const d = w.document;
  const page = (name) => { [...d.querySelectorAll("nav.side button")].find((b) => b.dataset.name === name).click(); return [...d.querySelectorAll(".content > div")].find((x) => !x.hidden); };
  const expandAll = () => d.querySelectorAll("details").forEach((x) => { x.open = true; });

  let v = page("User");
  v.querySelector("input[type=search]").dispatchEvent(new w.Event("focus")); await tick();
  v.querySelector(".chip").click();
  v.querySelector(".btn-primary").click(); await tick(); expandAll();
  assert.ok(v.querySelector("table.objects"));
  assert.deepEqual(badText(v), [], "User");

  v = page("Audit"); v.querySelector(".btn-primary").click(); await tick(); expandAll();
  assert.ok(v.querySelectorAll("details.group").length >= 5);
  assert.deepEqual(badText(v), [], "Audit");

  v = page("Docs"); v.querySelector("input[list]").value = "Invoice__c"; v.querySelector(".btn-primary").click(); await tick(); expandAll();
  assert.ok(v.querySelector(".mermaid-src"));
  assert.deepEqual(badText(v), [], "Docs");

  v = page("Orgs"); v.querySelector("input[list]").value = "Invoice__c"; v.querySelector(".btn-primary").click(); await tick(); expandAll();
  assert.ok(v.querySelectorAll("details.group").length >= 3);
  assert.deepEqual(badText(v), [], "Orgs");
  assert.deepEqual(badText(d.body), [], "whole workspace");
});
