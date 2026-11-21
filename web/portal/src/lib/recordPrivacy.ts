// Shared by browser persistence and the records API. Never traverse host objects
// (especially Blob), and do not confuse user prompts or workflow IDs with config.
const PRIVATE_FIELDS = new Set([
  'model', 'models', 'modelname', 'modelid', 'modelmetadata', 'modelconfig',
  'chatmodel', 'imagemodel', 'videomodel', 'musicmodel', 'audiomodel',
  'systemprompt', 'systemprompts', 'developerprompt', 'presetprompt', 'presetprompts',
  'apikey', 'key', 'rememberkey', 'authorization', 'proxyauthorization',
  'accesstoken', 'refreshtoken', 'token', 'secret', 'password',
  'apibaseurl', 'baseurl', 'upstreamurl', 'upstreammodel', 'upstreammodels',
]);
const normalized = (field: string) => field.replace(/[-_\s]/g, '').toLowerCase();
function privateField(field: string): boolean {
  const name = normalized(field);
  return PRIVATE_FIELDS.has(name) || /^ai(?:api|chatmodel|imagemodel|videomodel|musicmodel|systemprompt)/.test(name);
}
function opaqueText(field: string, value: string): boolean {
  const name = normalized(field);
  return /(?:id|ids)$/.test(name) || /(?:blobdata|base64)$/.test(name) ||
    ['b64json', 'data', 'linkedaccountid'].includes(name) || /^data:|^blob:/i.test(value);
}

/** Remove private config properties without changing ordinary content or media.
 * The server can additionally redact known secret values from textual fields.
 * Unchanged branches retain their identity so legacy stores need rewriting only
 * when private metadata was actually found.
 */
export function scrubRecordPrivacy<T>(value: T, redactText?: (text: string) => string): T {
  function scrub(input: unknown, field = ''): unknown {
    if (typeof input === 'string') return redactText && !opaqueText(field, input) ? redactText(input) : input;
    if (!input || typeof input !== 'object') return input;
    if (Array.isArray(input)) {
      const items = input.map(item => scrub(item, field));
      return items.some((item, index) => item !== input[index]) ? items : input;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return input;
    let changed = false;
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(input)) {
      if (privateField(key)) { changed = true; continue; }
      // Legacy provider task IDs can contain private model names. They are no
      // longer accepted by the generation API; keep only new opaque job tokens.
      if (['remoteid', 'videoremoteid'].includes(normalized(key)) && typeof item === 'string' && !/^job_[A-Za-z0-9_-]+$/.test(item)) { changed = true; continue; }
      const clean = scrub(item, key);
      if (clean !== item) changed = true;
      entries.push([key, clean]);
    }
    return changed ? Object.fromEntries(entries) : input;
  }
  return scrub(value) as T;
}
