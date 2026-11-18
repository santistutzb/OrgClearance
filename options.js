// @ts-check
// Settings: how the extension connects to each org, and shortcuts.
import { normalizeHost, getAllConfigs, setOrgConfig } from "./src/auth.js";
import "./i18n.js";

const I18N = globalThis.OrgClearanceI18n;
const t = (k, v) => I18N.t(k, v);

const { h, icon, logo, CSS, fontFaceCss, makeSend, errorBox, statusPill } = globalThis.OrgClearanceUI;
const app = document.getElementById("app");
const redirectUri = chrome.identity.getRedirectURL("oauth2");

const PAGE_CSS = `
  body { margin: 0; font-family: var(--font); font-size: 15px; line-height: 1.5; color: var(--ink); background: var(--wash); }
  main { max-width: 760px; margin: 0 auto; padding: 36px 24px 56px; }
  .brand { display: flex; gap: 10px; align-items: center; font-weight: 700; font-size: 17px; }
  h1 { font-size: 26px; margin: 22px 0 4px; letter-spacing: -0.01em; }
  .intro { color: var(--muted); margin: 0 0 8px; max-width: 64ch; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); padding: 20px 22px; margin-top: 18px; }
  .card > h2 { margin-bottom: 6px; }
  .org { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .org:last-child { border-bottom: 0; }
  .org .host { flex: 1; min-width: 220px; }
  .org .result { flex-basis: 100%; }
  .ok { display: flex; gap: 8px; align-items: center; color: var(--yes); font-size: 13px; margin-top: 4px; }
  ol.steps { padding-left: 20px; margin: 10px 0; } ol.steps li { margin: 6px 0; }
  code, .mono { font-family: var(--mono); font-size: 12px; background: var(--wash); padding: 2px 6px; border-radius: 4px; word-break: break-all; }
  .callback { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
  kbd { font-family: var(--mono); font-size: 12px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 1px 6px; background: var(--surface); }
  .form { max-width: 460px; } .form .btn-primary { width: auto; }
`;

function testButton(host) {
  const out = h("div", { class: "result" });
  const btn = h("button", { class: "btn btn-secondary btn-small", onclick: async () => {
    btn.disabled = true;
    out.replaceChildren(h("div", { class: "muted small" }, t("Testing the connection. A Salesforce login window may open.")));
    try {
      const r = await makeSend()({ type: "testOrg", org: host });
      out.replaceChildren(h("div", { class: "ok" }, icon("check"), t(r.auth === "oauth" ? t("Connected to {name} ({kind}) using OAuth.") : t("Connected to {name} ({kind}) using your browser session."), { name: r.name, kind: r.sandbox ? "sandbox" : r.edition })));
    } catch (e) { out.replaceChildren(errorBox(e)); }
    btn.disabled = false;
  } }, t("Test connection"));
  return { btn, out };
}

async function render() {
  const configs = await getAllConfigs();
  const known = await makeSend()({ type: "listOrgs" }).catch(() => []);
  const hosts = [...new Set([...known.map((o) => o.host), ...Object.keys(configs)])].sort();

  const urlInput = h("input", { type: "text", id: "oc-url", placeholder: "https://acme.my.salesforce.com", list: "known-orgs" });
  const keyInput = h("input", { type: "text", id: "oc-key", placeholder: t("Paste the Consumer Key"), autocomplete: "off", spellcheck: "false" });
  const formErr = h("div");
  const save = h("button", { class: "btn btn-primary", onclick: async () => {
    formErr.replaceChildren();
    try {
      const host = normalizeHost(urlInput.value);
      const clientId = keyInput.value.trim();
      if (!/^[A-Za-z0-9._]{20,}$/.test(clientId)) throw new Error(t("That doesn't look like a Consumer Key. Copy it again from the app's settings in Salesforce."));
      await setOrgConfig(host, { mode: "oauth", clientId });
      await render();
    } catch (e) { formErr.replaceChildren(errorBox(e)); }
  } }, icon("shield"), t("Save and connect with OAuth"));

  const orgRows = hosts.length ? hosts.map((host) => {
    const cfg = configs[host];
    const test = testButton(host);
    return h("div", { class: "org" },
      h("div", { class: "host" }, h("div", { class: "api", style: "font-size:13px" }, host),
        h("div", { class: "muted small" }, cfg?.mode === "oauth" ? t("Connects with OAuth") : t("Connects with your browser session"))),
      test.btn,
      cfg ? h("button", { class: "btn btn-ghost btn-small", onclick: async () => { await setOrgConfig(host, null); await render(); } }, t("Use browser session instead")) : null,
      test.out);
  }) : [h("p", { class: "muted" }, t("No orgs yet. Log into Salesforce in this browser and reload this page."))];

  app.replaceChildren(h("main", {},
    h("div", { class: "brand" }, logo(30), "OrgClearance"),
    h("h1", {}, t("Settings")),
    h("p", { class: "intro" }, t("OrgClearance only reads from Salesforce, and only from your browser. Nothing is sent anywhere else.")),

    languageCard(),

    h("section", { class: "card" },
      h("h2", {}, t("Your orgs")),
      h("p", { class: "muted" }, t("Orgs you're logged into appear here automatically.")),
      orgRows),

    h("section", { class: "card" },
      h("h2", {}, t("Connect an org with OAuth")),
      h("p", {}, t("Only needed if an org blocks extensions from using your browser session (for example, with API Access Control). You'll create an app in that org so OrgClearance can sign in through it.")),
      h("ol", { class: "steps" },
        h("li", {}, t("In Setup, create an External Client App (or a Connected App) and turn on OAuth.")),
        h("li", {}, t("Use this callback URL:"),
          h("div", { class: "callback" }, h("span", { class: "mono" }, redirectUri),
            h("button", { class: "btn btn-ghost btn-small", onclick: (e) => navigator.clipboard.writeText(redirectUri).then(() => { e.currentTarget.lastChild.textContent = t("Copied"); }) }, icon("copy"), t("Copy")))),
        h("li", {}, t("Add the scope "), h("code", {}, "Manage user data via APIs (api)"), t(". It's the only one needed.")),
        h("li", {}, t("Turn on "), h("b", {}, "Require PKCE"), t(" and turn off "), h("b", {}, "Require Secret for Web Server Flow"), "."),
        h("li", {}, t("Copy the app's Consumer Key and paste it below."))),
      h("p", { class: "muted small" }, t("The sign-in lasts until you close the browser. OrgClearance never stores a password, secret or refresh token.")),
      h("div", { class: "form" },
        h("label", { for: "oc-url" }, t("Org URL")), urlInput,
        h("datalist", { id: "known-orgs" }, hosts.map((x) => h("option", { value: `https://${x}` }))),
        h("label", { for: "oc-key" }, "Consumer Key"), keyInput,
        formErr, save)),

    privacyCard(),

    h("section", { class: "card" },
      h("h2", {}, t("Keyboard shortcuts")),
      h("p", {}, h("kbd", {}, "Alt"), " + ", h("kbd", {}, "Shift"), " + ", h("kbd", {}, "A"), t(" opens or closes the panel on a Salesforce page.")),
      h("p", {}, h("kbd", {}, "Alt"), " + ", h("kbd", {}, "Shift"), " + ", h("kbd", {}, "W"), t(" opens the workspace.")),
      h("p", { class: "muted small" }, t("You can change them at chrome://extensions/shortcuts."))),
  ));
}

// Interface language. "Automatic" follows the browser; the choice applies to every page of the extension.
function languageCard() {
  const select = h("select", { id: "oc-lang", style: "max-width:260px" },
    [["auto", t("Automatic (same as the browser)")], ["en", "English"], ["es", "Español"]].map(([value, label]) => h("option", { value }, label)));
  chrome.storage.local.get("lang").then((r) => { select.value = r.lang === "en" || r.lang === "es" ? r.lang : "auto"; }).catch(() => {});
  select.addEventListener("change", async () => {
    await chrome.storage.local.set({ lang: select.value });
    location.reload();
  });
  return h("section", { class: "card" },
    h("h2", {}, t("Language")),
    h("p", { class: "muted" }, t("Applies to the panel, the workspace and the files you export. Reload open Salesforce tabs to see the change there.")),
    h("label", { for: "oc-lang" }, t("Language")), select);
}

// What the extension keeps on this computer, and a way to clear it.
function privacyCard() {
  const status = h("div", { class: "muted small", role: "status" });
  const forget = h("button", { class: "btn btn-secondary btn-small", onclick: async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("recent:"));
    await chrome.storage.local.remove(keys);
    status.textContent = keys.length ? t("Recent people cleared.") : t("There was nothing to clear.");
  } }, t("Forget recent people"));
  return h("section", { class: "card" },
    h("h2", {}, t("Your data")),
    h("p", {}, t("OrgClearance has no server and sends nothing outside Salesforce. On this computer it only keeps:")),
    h("ul", {},
      h("li", {}, t("The last 8 people you looked up in each org (name, username, profile), to show them as shortcuts.")),
      h("li", {}, t("How each org connects (browser session or OAuth, and the Consumer Key you pasted).")),
      h("li", {}, t("An OAuth sign-in, only until you close the browser."))),
    h("div", { class: "row" }, forget, status));
}

document.head.append(h("style", {}, fontFaceCss("") + CSS + PAGE_CSS));
await I18N.ready;
document.documentElement.lang = I18N.getLang();
render();
