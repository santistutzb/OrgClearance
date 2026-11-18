// @ts-check
// Service worker: the only place that touches credentials and calls Salesforce.
// Pages (panel, workspace, options) send messages; they never see a session id or token.

import { createClient } from "./src/api.js";
import { resolveSession, listKnownOrgs, forgetOAuthToken, isAuthError, isApiBlocked } from "./src/resolve.js";
import { orgIdOf, getSession } from "./src/session.js";
import { searchUsers, explainAccess, compareUsers, fieldMatrix, resolveObject } from "./src/access.js";
import { userOverview } from "./src/user.js";
import { whoCanSee } from "./src/who.js";
import { formatTicket, problemGroups } from "./src/ticket.js";
import { runAudit } from "./src/audit.js";
import { collectObjectDoc, toMarkdown, toHtml, toMermaid } from "./src/docs.js";
import { snapshot, diffSnapshots, toMarkdownReport } from "./src/orgdiff.js";
import { buildTimeline, scanLogs } from "./src/timeline.js";

const EXT_ORIGIN = chrome.runtime.getURL("");

// Handlers get (client, message, session). `pages` says who may call them.
const handlers = {
  searchUsers: { pages: "any", run: (c, m) => searchUsers(c, m.term) },
  explain: { pages: "panel", run: async (c, m) => { const r = await explainAccess(c, m.params); return { ...r, fixGroups: problemGroups(r), ticket: formatTicket(r) }; } },
  compare: { pages: "panel", run: (c, m) => compareUsers(c, m.params) },
  fieldMatrix: { pages: "panel", run: (c, m) => fieldMatrix(c, m.params) },
  resolveObject: { pages: "panel", run: (c, m) => resolveObject(c, m.recordId) },
  timeline: { pages: "panel", run: (c, m) => buildTimeline(c, m.params) },
  whoCanSee: { pages: "panel", run: (c, m) => whoCanSee(c, m.params) },
  scanLogs: { pages: "panel", run: (c, m) => scanLogs(c, m.params) },
  listFields: {
    pages: "any",
    run: async (c, m) => (await c.describe(m.sobject)).fields
      .map((f) => ({ name: f.name, label: f.label })).sort((a, b) => a.name.localeCompare(b.name)),
  },
  listObjects: {
    pages: "any",
    run: async (c) => (await c.describeGlobal()).sobjects
      .filter((s) => s.queryable && s.layoutable)
      .map((s) => ({ name: s.name, label: s.label })).sort((a, b) => a.name.localeCompare(b.name)),
  },

  userOverview: { pages: "any", run: (c, m) => userOverview(c, m.params) },
  audit: { pages: "any", run: (c) => runAudit(c) },
  docs: {
    pages: "any",
    run: async (c, m) => {
      const doc = await collectObjectDoc(c, m.sobject);
      return {
        summary: {
          label: doc.label, sobject: doc.sobject, fields: doc.fields.length, recordTypes: doc.recordTypes.length,
          triggers: doc.triggers.length, flows: doc.flows.length, validationRules: doc.validationRules.length,
          workflowRules: doc.workflowRules.length, notes: doc.notes,
        },
        mermaid: toMermaid(doc), markdown: toMarkdown(doc), html: toHtml(doc),
      };
    },
  },
  compareOrgs: {
    pages: "any",
    run: async (c, m, session) => {
      if (m.otherOrg === session.configHost) throw new Error("Pick two different orgs.");
      const other = await resolveSession({ orgHost: m.otherOrg });
      const otherClient = createClient(other);
      const [a, b] = await Promise.all([snapshot(c, m.sobject), snapshot(otherClient, m.sobject)]);
      const diff = diffSnapshots({ ...a, host: session.configHost }, { ...b, host: other.configHost });
      c.usage.calls += otherClient.usage.calls;
      return { ...diff, markdown: toMarkdownReport(diff) };
    },
  },
  // Confirms credentials work; used by the options page.
  testOrg: {
    pages: "extension",
    run: async (c, m, session) => {
      const org = (await c.query("SELECT Id, Name, IsSandbox, OrganizationType FROM Organization"))[0];
      return { name: org.Name, sandbox: org.IsSandbox, edition: org.OrganizationType, auth: session.auth, host: session.configHost };
    },
  },
};

// Messages that don't need a Salesforce session.
const local = {
  listOrgs: async (m, sender) => {
    const orgs = await listKnownOrgs();
    let current = null;
    if (!isExtensionPage(sender) && sender.tab?.url) {
      try { current = orgIdOf(await getSession(new URL(sender.tab.url).hostname)); } catch { /* not logged in via cookie */ }
    }
    return orgs.map((o) => ({ ...o, current: !!current && o.orgId === current }));
  },
  openWorkspace: async (m, sender) => {
    let org = m.org ?? null;
    if (!org && sender.tab?.url) {
      try { org = (await getSession(new URL(sender.tab.url).hostname)).host; } catch { /* pick in the workspace */ }
    }
    const q = new URLSearchParams();
    if (org) q.set("org", org);
    if (typeof m.user === "string" && /^005[a-zA-Z0-9]{12,15}$/.test(m.user)) q.set("user", m.user);
    await chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html${q.size ? `?${q}` : ""}`) });
    return true;
  },
  openOptions: async () => { await chrome.runtime.openOptionsPage(); return true; },
};

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(EXT_ORIGIN);
}

function sessionTarget(msg, sender) {
  // Extension pages name the org; Salesforce tabs use their own host and can't pick another org.
  if (isExtensionPage(sender)) return { orgHost: String(msg.org || "") };
  return { pageHost: new URL(sender.tab.url).hostname };
}

function withHint(e, session) {
  const msg = e?.message || String(e);
  if (session?.auth !== "oauth" && isApiBlocked(e)) {
    return `${msg} This org blocks API access with the browser session. Set up OAuth for it in the extension options.`;
  }
  return msg;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromExt = isExtensionPage(sender);

  if (local[msg?.type]) {
    local[msg.type](msg, sender).then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  const h = handlers[msg?.type];
  if (!h) return false;
  if (h.pages === "panel" && fromExt) return false;
  if (h.pages === "extension" && !fromExt) return false;
  if (!fromExt && !sender.tab?.url) return false;

  (async () => {
    let session = null;
    let client = null;
    try {
      session = await resolveSession(sessionTarget(msg, sender));
      client = createClient(session);
      let data;
      try {
        data = await h.run(client, msg, session);
      } catch (e) {
        if (session.auth !== "oauth" || !isAuthError(e)) throw e;
        // Expired OAuth token: get a new one and retry once.
        await forgetOAuthToken(session.configHost);
        session = await resolveSession(sessionTarget(msg, sender));
        client = createClient(session);
        data = await h.run(client, msg, session);
      }
      sendResponse({ ok: true, data, meta: { calls: client.usage.calls, cached: client.usage.cached, orgUsage: client.usage.orgUsage, auth: session.auth } });
    } catch (e) {
      sendResponse({ ok: false, error: withHint(e, session), meta: client ? { calls: client.usage.calls, orgUsage: client.usage.orgUsage } : null });
    }
  })();
  return true; // async response
});

// Extension icon: open the workspace for the org in the current tab, if any.
chrome.action.onClicked.addListener((tab) => local.openWorkspace({}, { tab, id: chrome.runtime.id }));

// Keyboard shortcut: toggle the panel on the current Salesforce tab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => { /* not a Salesforce page */ });
});
