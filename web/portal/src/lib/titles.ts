import { request } from './api';
import { getLocale } from './i18n';

export type TitleKind = 'conversation' | 'work';

/** Keep a prompt excerpt under a rune cap without splitting surrogate pairs. */
function clampRunes(value: string, max: number): string {
  const runes = Array.from(value);
  return runes.length > max ? runes.slice(0, max).join('') : value;
}

/**
 * Ask the server to summarize a conversation or work prompt with the system's
 * default chat model. The title follows the current interface language.
 * Best effort: when the service is unavailable the caller keeps its local
 * truncated fallback and the user sees no error.
 */
export async function generateTitle(kind: TitleKind, text: string, reply = ''): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    const body: Record<string, string> = { kind, text: clampRunes(trimmed, 4000), locale: getLocale() };
    if (reply.trim()) body.reply = clampRunes(reply.trim(), 2000);
    const response = await request('title', { method: 'POST', body: JSON.stringify(body) });
    const data = await response.json();
    return typeof data?.title === 'string' ? data.title.trim() : '';
  } catch {
    return '';
  }
}
