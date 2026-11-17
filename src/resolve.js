// @ts-check
// Decides which org and which credentials a request uses.
//  - From a Salesforce tab: the tab's org, from its host.
//  - From the extension's own pages (workspace, options): an org the user picked, which must be
//    one they're logged into (cookie) or have set up for OAuth. Nothing else is accepted.
// Then the org's auth mode picks the cookie session or an OAuth token.

import { getSession, guessApiHost, listOrgSessions } from "./session.js";
import { getAllConfigs, getOrgConfig, getOAuthSession, clearToken } from "./auth.js";

/** Orgs available to the workspace: logged in via cookie, or configured for OAuth. No session ids. */
export async function listKnownOrgs() {
  const [cookies, configs] = await Promise.all([listOrgSessions(), getAllConfigs()]);
  const byHost = new Map(cookies.map((c) => [c.host, { host: c.host, orgId: c.orgId, auth: configs[c.host]?.mode ?? "cookie" }]));
  for (const [host, cfg] of Object.entries(configs)) {
    if (cfg.mode === "oauth" && !byHost.has(host)) byHost.set(host, { host, orgId: null, auth: "oauth" });
  }
  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * @param {{pageHost?: string, orgHost?: string, interactive?: boolean}} p
 * @returns {Promise<{host: string, sid: string, auth: "cookie" | "oauth", configHost: string}>}
 */
export async function resolveSession({ pageHost, orgHost, interactive = true }) {
  /** @type {{host: string, sid: string | null, error?: Error}} */
  let base;
  if (orgHost) {
    const cookie = (await listOrgSessions()).find((s) => s.host === orgHost);
    const config = await getOrgConfig(orgHost);
    if (!cookie && config?.mode !== "oauth") throw new Error(`You're not logged into ${orgHost} in this browser. Log in and try again.`);
    base = { host: orgHost, sid: cookie?.sid ?? null };
  } else if (pageHost) {
    try { base = await getSession(pageHost); }
    catch (e) { base = { host: guessApiHost(pageHost), sid: null, error: e }; }
  } else {
    throw new Error("No org selected.");
  }

  const config = await getOrgConfig(base.host);
  if (config?.mode === "oauth") {
    const s = await getOAuthSession(base.host, { interactive });
    return { ...s, auth: "oauth", configHost: base.host };
  }
  if (!base.sid) throw base.error ?? new Error("No active Salesforce session found for this org.");
  return { host: base.host, sid: base.sid, auth: "cookie", configHost: base.host };
}

/** @param {string} configHost */
export const forgetOAuthToken = (configHost) => clearToken(configHost);

// Errors Salesforce returns when the session can't be used for the API.
export const isAuthError = (e) => e?.status === 401 || /INVALID_SESSION_ID|Session expired or invalid/i.test(e?.message || "");
export const isApiBlocked = (e) =>
  /API_DISABLED_FOR_ORG|API is not enabled|not valid for use with the REST API|API_CURRENTLY_DISABLED|OAUTH_APP_ACCESS_DENIED|not approved for access/i.test(e?.message || "");
