// @ts-check
// Finds the Salesforce session the user already has open.
// No login of its own: it reads the `sid` cookie from the org's API domain.

import { isSalesforceHost } from "./hosts.js";

// API session cookies live on *.my.salesforce.com (and older *.salesforce.com instance hosts).
const API_COOKIE_DOMAINS = ["salesforce.com"];

export function guessApiHost(pageHost) {
  return pageHost
    .replace(".lightning.force.com", ".my.salesforce.com")
    .replace(".my.salesforce-setup.com", ".my.salesforce.com");
}

export async function getSession(pageHost) {
  if (!isSalesforceHost(pageHost)) throw new Error("Not a Salesforce page.");

  const pageCookie = await chrome.cookies.get({ url: `https://${pageHost}`, name: "sid" });
  if (pageCookie && pageHost.endsWith(".my.salesforce.com")) {
    return { host: pageHost, sid: pageCookie.value };
  }

  // The Lightning sid doesn't work for the API, but its prefix is the org Id:
  // use it to find the API-domain cookie that belongs to the same org.
  const orgId = pageCookie?.value.split("!")[0];
  if (orgId) {
    for (const domain of API_COOKIE_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ name: "sid", domain, secure: true });
      const match = cookies.find((c) => c.value.startsWith(orgId + "!"));
      if (match) return { host: match.domain.replace(/^\./, ""), sid: match.value };
    }
  }

  // Last resort: derive the API domain from the page domain.
  const guess = guessApiHost(pageHost);
  const guessCookie = await chrome.cookies.get({ url: `https://${guess}`, name: "sid" });
  if (guessCookie) return { host: guess, sid: guessCookie.value };

  throw new Error("No active Salesforce session found for this org. Log in again and reload the page.");
}

// Every org the user is logged into in this browser, one entry per org, API domains only.
export async function listOrgSessions() {
  const byOrg = new Map();
  for (const domain of API_COOKIE_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ name: "sid", domain, secure: true });
    for (const c of cookies) {
      const orgId = c.value.split("!")[0];
      const host = c.domain.replace(/^\./, "");
      if (!/^00D[a-zA-Z0-9]{12,15}$/.test(orgId) || !isSalesforceHost(host)) continue;
      // Prefer My Domain hosts over generic ones (e.g. login.salesforce.com).
      if (!byOrg.has(orgId) || host.includes(".my.")) byOrg.set(orgId, { orgId, host, sid: c.value });
    }
  }
  return [...byOrg.values()];
}

export const orgIdOf = (session) => String(session.sid || "").split("!")[0];
