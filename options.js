// @ts-check
// Settings: how the extension connects to each org, and shortcuts.
import { normalizeHost, getAllConfigs, setOrgConfig } from "./src/auth.js";

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
    out.replaceChildren(h("div", { class: "muted small" }, "Testing the connection. A Salesforce login window may open."));
    try {
      const r = await makeSend()({ type: "testOrg", org: host });
      out.replaceChildren(h("div", { class: "ok" }, icon("check"), `Connected to ${r.name} (${r.sandbox ? "sandbox" : r.edition}) using ${r.auth === "oauth" ? "OAuth" : "your browser session"}.`));
    } catch (e) { out.replaceChildren(errorBox(e)); }
    btn.disabled = false;
  } }, "Test connection");
  return { btn, out };
}

async function render() {
  const configs = await getAllConfigs();
  const known = await makeSend()({ type: "listOrgs" }).catch(() => []);
  const hosts = [...new Set([...known.map((o) => o.host), ...Object.keys(configs)])].sort();

  const urlInput = h("input", { type: "text", id: "oc-url", placeholder: "https://acme.my.salesforce.com", list: "known-orgs" });
  const keyInput = h("input", { type: "text", id: "oc-key", placeholder: "Paste the Consumer Key", autocomplete: "off", spellcheck: "false" });
  const formErr = h("div");
  const save = h("button", { class: "btn btn-primary", onclick: async () => {
    formErr.replaceChildren();
    try {
      const host = normalizeHost(urlInput.value);
      const clientId = keyInput.value.trim();
      if (!/^[A-Za-z0-9._]{20,}$/.test(clientId)) throw new Error("That doesn't look like a Consumer Key. Copy it again from the app's settings in Salesforce.");
      await setOrgConfig(host, { mode: "oauth", clientId });
      await render();
    } catch (e) { formErr.replaceChildren(errorBox(e)); }
  } }, icon("shield"), "Save and connect with OAuth");

  const orgRows = hosts.length ? hosts.map((host) => {
    const cfg = configs[host];
    const t = testButton(host);
    return h("div", { class: "org" },
      h("div", { class: "host" }, h("div", { class: "api", style: "font-size:13px" }, host),
        h("div", { class: "muted small" }, cfg?.mode === "oauth" ? "Connects with OAuth" : "Connects with your browser session")),
      t.btn,
      cfg ? h("button", { class: "btn btn-ghost btn-small", onclick: async () => { await setOrgConfig(host, null); await render(); } }, "Use browser session instead") : null,
      t.out);
  }) : [h("p", { class: "muted" }, "No orgs yet. Log into Salesforce in this browser and reload this page.")];

  app.replaceChildren(h("main", {},
    h("div", { class: "brand" }, logo(30), "OrgClearance"),
    h("h1", {}, "Settings"),
    h("p", { class: "intro" }, "OrgClearance only reads from Salesforce, and only from your browser. Nothing is sent anywhere else."),

    h("section", { class: "card" },
      h("h2", {}, "Your orgs"),
      h("p", { class: "muted" }, "Orgs you're logged into appear here automatically."),
      orgRows),

    h("section", { class: "card" },
      h("h2", {}, "Connect an org with OAuth"),
      h("p", {}, "Only needed if an org blocks extensions from using your browser session (for example, with API Access Control). You'll create an app in that org so OrgClearance can sign in through it."),
      h("ol", { class: "steps" },
        h("li", {}, "In Setup, create an External Client App (or a Connected App) and turn on OAuth."),
        h("li", {}, "Use this callback URL:",
          h("div", { class: "callback" }, h("span", { class: "mono" }, redirectUri),
            h("button", { class: "btn btn-ghost btn-small", onclick: (e) => navigator.clipboard.writeText(redirectUri).then(() => { e.currentTarget.lastChild.textContent = "Copied"; }) }, icon("copy"), "Copy"))),
        h("li", {}, "Add the scope ", h("code", {}, "Manage user data via APIs (api)"), ". It's the only one needed."),
        h("li", {}, "Turn on ", h("b", {}, "Require PKCE"), " and turn off ", h("b", {}, "Require Secret for Web Server Flow"), "."),
        h("li", {}, "Copy the app's Consumer Key and paste it below.")),
      h("p", { class: "muted small" }, "The sign-in lasts until you close the browser. OrgClearance never stores a password, secret or refresh token."),
      h("div", { class: "form" },
        h("label", { for: "oc-url" }, "Org URL"), urlInput,
        h("datalist", { id: "known-orgs" }, hosts.map((x) => h("option", { value: `https://${x}` }))),
        h("label", { for: "oc-key" }, "Consumer Key"), keyInput,
        formErr, save)),

    h("section", { class: "card" },
      h("h2", {}, "Keyboard shortcuts"),
      h("p", {}, h("kbd", {}, "Alt"), " + ", h("kbd", {}, "Shift"), " + ", h("kbd", {}, "A"), " opens or closes the panel on a Salesforce page."),
      h("p", {}, h("kbd", {}, "Alt"), " + ", h("kbd", {}, "Shift"), " + ", h("kbd", {}, "W"), " opens the workspace."),
      h("p", { class: "muted small" }, "You can change them at chrome://extensions/shortcuts.")),
  ));
}

document.head.append(h("style", {}, fontFaceCss("") + CSS + PAGE_CSS));
render();
