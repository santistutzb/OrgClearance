// @ts-check
// The only hosts a session id or token is ever sent to. Matches the extension's host_permissions.
const SALESFORCE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:salesforce\.com|force\.com|salesforce-setup\.com)$/i;

/** @param {unknown} host */
export function isSalesforceHost(host) {
  return typeof host === "string" && host.length <= 253 && SALESFORCE_HOST.test(host);
}

/** @param {unknown} host */
export function assertSalesforceHost(host) {
  if (!isSalesforceHost(host)) throw new Error(`Refusing to connect to ${String(host)}: not a Salesforce domain.`);
  return /** @type {string} */ (host);
}
