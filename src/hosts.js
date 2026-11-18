// @ts-check
// The only hosts a session id or token is ever sent to. Matches the extension's host_permissions.
import "../i18n.js";

const SALESFORCE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:salesforce\.com|force\.com|salesforce-setup\.com)$/i;

/** @param {unknown} host */
export function isSalesforceHost(host) {
  return typeof host === "string" && host.length <= 253 && SALESFORCE_HOST.test(host);
}

/** @param {unknown} host */
export function assertSalesforceHost(host) {
  if (!isSalesforceHost(host)) throw new Error(globalThis.OrgClearanceI18n.t("Refusing to connect to {host}: not a Salesforce domain.", { host: String(host) }));
  return /** @type {string} */ (host);
}
