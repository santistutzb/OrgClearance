// @ts-check
// Minimal Salesforce REST API client. GET only.
// Counts the API calls each action makes and reads the org's daily usage from the response header.

export const API_VERSION = "62.0";

const DESCRIBE_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, {at: number, value: any}>} */
const describeCache = new Map();

export function clearDescribeCache() { describeCache.clear(); }

export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {string} [code] */
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {{host: string, sid: string}} session
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [opts]
 */
export function createClient({ host, sid }, { fetchImpl, now = Date.now } = {}) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));
  const base = `https://${host}`;
  const data = `/services/data/v${API_VERSION}`;
  const usage = { calls: 0, cached: 0, orgUsage: /** @type {string|null} */ (null) };

  /** @param {string} path @param {{text?: boolean}} [o] */
  async function request(path, { text = false } = {}) {
    usage.calls++;
    const res = await doFetch(base + path, {
      headers: { Authorization: `Bearer ${sid}`, Accept: text ? "text/plain" : "application/json" },
    });
    const limit = res.headers?.get?.("Sforce-Limit-Info");
    if (limit) usage.orgUsage = limit;
    const raw = await res.text();
    if (text && res.ok) return raw;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* non-JSON response */ }
    if (!res.ok) {
      const first = Array.isArray(body) ? body[0] : null;
      throw new ApiError(first?.message || `HTTP ${res.status}`, res.status, first?.errorCode);
    }
    return body;
  }

  /** @param {string} path */
  async function cachedRequest(path) {
    const key = `${host}|${path}`;
    const hit = describeCache.get(key);
    if (hit && now() - hit.at < DESCRIBE_TTL_MS) { usage.cached++; return hit.value; }
    const value = await request(path);
    describeCache.set(key, { at: now(), value });
    return value;
  }

  /** @param {string} endpoint @param {string} soql @returns {Promise<any[]>} */
  async function runQuery(endpoint, soql) {
    let page = await request(`${data}/${endpoint}?q=${encodeURIComponent(soql)}`);
    const records = [...page.records];
    while (!page.done && page.nextRecordsUrl) {
      page = await request(page.nextRecordsUrl);
      records.push(...page.records);
    }
    return records;
  }

  return {
    host,
    usage,
    /** @param {string} soql */
    query: (soql) => runQuery("query", soql),
    /** @param {string} soql */
    toolingQuery: (soql) => runQuery("tooling/query", soql),
    /** @param {string} sobject */
    describe: (sobject) => cachedRequest(`${data}/sobjects/${encodeURIComponent(sobject)}/describe`),
    describeGlobal: () => cachedRequest(`${data}/sobjects`),
    /** @param {string} id */
    logBody: (id) => request(`${data}/sobjects/ApexLog/${encodeURIComponent(id)}/Body`, { text: true }),
  };
}

/** "api-usage=25/15000" -> {used: 25, max: 15000} */
export function parseUsage(header) {
  const m = /api-usage=(\d+)\/(\d+)/.exec(header || "");
  return m ? { used: Number(m[1]), max: Number(m[2]) } : null;
}

// Runs a query once per chunk of Ids so long IN (...) lists don't exceed URL limits.
/**
 * @param {(soql: string) => Promise<any[]>} run
 * @param {(inList: string) => string} build
 * @param {string[]} ids
 * @param {number} [size]
 */
export async function queryIn(run, build, ids, size = 150) {
  const unique = [...new Set(ids)];
  const out = [];
  for (let i = 0; i < unique.length; i += size) {
    const chunk = unique.slice(i, i + size);
    for (const id of chunk) if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id)) throw new Error("Invalid Id");
    out.push(...await run(build(chunk.map((id) => `'${id}'`).join(","))));
  }
  return out;
}
