// Process-local byte cache. Authorization is never cached: callers must check
// ownership/publication before looking up bytes or honoring an ETag.
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const TTL = 15 * 60_000;
interface Segment { start: number; bytes: Uint8Array }
interface Entry { segments: Segment[]; size: number; expires: number; complete: boolean }
const entries = new Map<string, Entry>();
let total = 0;
let capturing = 0;
function drop(key: string) {
  const entry = entries.get(key);
  if (entry) { total -= entry.size; entries.delete(key); }
}
export function clearMediaCache() { entries.clear(); total = 0; }
export function cachedMedia(key: string, start: number, end: number, partial: boolean): Uint8Array | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { drop(key); return null; }
  const segment = entry.segments.find(s => s.start <= start && s.start + s.bytes.length > start);
  if (!segment || (!partial && segment.start + segment.bytes.length <= end)) return null;
  entries.delete(key); entries.set(key, entry); // bounded LRU, expiry is not extended
  return segment.bytes.subarray(start - segment.start, Math.min(end + 1 - segment.start, segment.bytes.length));
}
/** A transformed response (thumbnail) has no known final length, so it is only
 * served from cache once the whole response was captured, never a prefix. */
export function completeMedia(key: string): Uint8Array | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { drop(key); return null; }
  if (!entry.complete) return null;
  const segment = entry.segments.find(s => s.start === 0);
  if (!segment || segment.bytes.length !== entry.size) return null;
  entries.delete(key); entries.set(key, entry);
  return segment.bytes;
}
function remember(key: string, start: number, bytes: Uint8Array, complete: boolean) {
  if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) return;
  const previous = entries.get(key);
  const segments = previous && previous.expires > Date.now() ? [...previous.segments] : [];
  const joined = segments.filter(s => s.start <= start + bytes.length && s.start + s.bytes.length >= start);
  const first = Math.min(start, ...joined.map(s => s.start));
  const last = Math.max(start + bytes.length, ...joined.map(s => s.start + s.bytes.length));
  if (last - first > MAX_CAPTURE_BYTES) return;
  const merged = new Uint8Array(last - first);
  for (const s of joined) merged.set(s.bytes, s.start - first);
  merged.set(bytes, start - first);
  const remaining = segments.filter(s => !joined.includes(s));
  remaining.push({ start: first, bytes: merged });
  const size = remaining.reduce((n, s) => n + s.bytes.length, 0);
  if (size > MAX_CAPTURE_BYTES) return;
  drop(key);
  while (total + size > MAX_BYTES && entries.size) drop(entries.keys().next().value!);
  entries.set(key, { segments: remaining, size, expires: Date.now() + TTL, complete: complete && first === 0 }); total += size;
}
/** Keep delivered prefixes too: browsers cancel open-ended video metadata reads.
 * In-flight capture memory is capped globally, not just per concurrent request. */
export function captureMedia(key: string, start: number) {
  let chunks: Uint8Array[] = [], length = 0, finished = false;
  const commit = (complete = false) => {
    if (finished) return;
    finished = true;
    if (length) {
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      remember(key, start, bytes, complete);
    }
    capturing -= length; chunks = [];
  };
  return {
    append(bytes: Uint8Array) {
      if (finished) return;
      if (capturing + bytes.length > MAX_CAPTURE_BYTES) { commit(); return; }
      chunks.push(bytes.slice()); length += bytes.length; capturing += bytes.length;
    },
    commit,
  };
}
