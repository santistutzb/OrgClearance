// @ts-check
// Per-org authentication settings and OAuth 2.0 (authorization code + PKCE).
//
// Default is "cookie": reuse the browser's Salesforce session. Orgs with API Access Control
// reject that, so an org can be switched to "oauth": the user creates a Connected App or
// External Client App in their org and pastes its Consumer Key in the options page.
// No client secret is used or stored. The access token lives in session storage only
// (cleared when the browser closes) and no refresh token is requested.

const CONFIG_KEY = "orgConfigs";
import { isSalesforceHost } from "./hosts.js";
import "../i18n.js";

const t = (k, v) => globalThis.OrgClearanceI18n.t(k, v);

/** @typedef {{mode: "cookie" | "oauth", clientId?: string}} OrgConfig */

// Accepts anything the user may paste (Lightning URL, Setup URL, bare host) and returns the API host.
/** @param {string} input */
export function normalizeHost(input) {
  let host = String(input || "").trim();
  try { if (/^https?:\/\//i.test(host)) host = new URL(host).hostname; } catch { /* keep as typed */ }
  host = host.replace(/\/.*$/, "").toLowerCase()
    .replace(".lightning.force.com", ".my.salesforce.com")
    .replace(".my.salesforce-setup.com", ".my.salesforce.com");
  if (!isSalesforceHost(host)) throw new Error(t("That doesn't look like a Salesforce My Domain URL (e.g. https://acme.my.salesforce.com)."));
  return host;
}

/** @returns {Promise<Record<string, OrgConfig>>} */
export async function getAllConfigs() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return /** @type {Record<string, OrgConfig>} */ (stored[CONFIG_KEY] ?? {});
}

/** @param {string} host */
export async function getOrgConfig(host) {
  return (await getAllConfigs())[host] ?? null;
}

/** @param {string} host @param {OrgConfig | null} config */
export async function setOrgConfig(host, config) {
  const all = await getAllConfigs();
  if (config) all[host] = config; else delete all[host];
  await chrome.storage.local.set({ [CONFIG_KEY]: all });
  await chrome.storage.session.remove(tokenKey(host));
}

// ---------- PKCE helpers (pure) ----------

/** @param {Uint8Array} bytes */
export function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(byteLength = 48) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** @param {string} verifier */
export async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** @param {{host: string, clientId: string, redirectUri: string, challenge: string, state: string}} p */
export function buildAuthorizeUrl({ host, clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "api",
    code_challenge: challenge, code_challenge_method: "S256", state,
  });
  return `https://${host}/services/oauth2/authorize?${q}`;
}

/** @param {string} redirected @param {string} expectedState */
export function parseRedirect(redirected, expectedState) {
  const url = new URL(redirected);
  const params = url.searchParams;
  if (params.get("error")) throw new Error(t("Salesforce refused the login: {error}", { error: params.get("error_description") || params.get("error") }));
  if (params.get("state") !== expectedState) throw new Error(t("OAuth state mismatch. Try again."));
  const code = params.get("code");
  if (!code) throw new Error(t("Salesforce didn't return an authorization code."));
  return code;
}

// ---------- token flow (needs chrome.identity) ----------

const tokenKey = (host) => `token:${host}`;

/** @param {string} host */
export async function clearToken(host) {
  await chrome.storage.session.remove(tokenKey(host));
}

/**
 * @param {string} host  API host of the org (My Domain)
 * @param {{interactive?: boolean, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{host: string, sid: string}>}
 */
export async function getOAuthSession(host, { interactive = true, fetchImpl } = {}) {
  /** @type {any} */
  const cached = (await chrome.storage.session.get(tokenKey(host)))[tokenKey(host)];
  if (cached?.sid) return cached;

  const config = await getOrgConfig(host);
  if (config?.mode !== "oauth" || !config.clientId) throw new Error(t("OAuth isn't set up for {host}. Open the extension options.", { host }));

  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const verifier = randomString(64);
  const state = randomString(16);
  const authUrl = buildAuthorizeUrl({ host, clientId: config.clientId, redirectUri, challenge: await codeChallenge(verifier), state });

  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive });
  } catch (e) {
    throw new Error(interactive ? t("Login window closed or failed: {error}", { error: e.message }) : t("Login required."));
  }
  if (!redirected) throw new Error(t("Login was cancelled."));
  const code = parseRedirect(redirected, state);

  const res = await (fetchImpl ?? fetch)(`https://${host}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(t("Token request failed: {error}. Check the Consumer Key, callback URL and that \"Require Secret for Web Server Flow\" is off.", { error: body.error_description || body.error || `HTTP ${res.status}` }));
  }
  // The API host comes from Salesforce's response; only accept a Salesforce domain.
  let instanceHost = "";
  try { instanceHost = new URL(body.instance_url).hostname; } catch { /* invalid URL */ }
  if (!isSalesforceHost(instanceHost)) throw new Error(t("Salesforce returned an unexpected instance URL. Login aborted."));
  const session = { host: instanceHost, sid: body.access_token };
  await chrome.storage.session.set({ [tokenKey(host)]: session });
  return session;
}
