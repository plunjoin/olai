import type { APIRoute } from 'astro';
import { authorizeURL, encodeState, githubEnabled, siteOrigin, STATE_COOKIE, STATE_PATH } from '../../../../lib/server/github';
import { normalizeInviteCode, validInviteCode } from '../../../../lib/server/points';

export const prerender = false;

export const GET: APIRoute = async context => {
  const base = siteOrigin(context.url.origin);
  if (!githubEnabled()) return context.redirect(`${base}/login?github_error=config`);
  const invite = normalizeInviteCode(context.url.searchParams.get('invite'));
  const state = encodeState(validInviteCode(invite) ? invite : '');
  context.cookies.set(STATE_COOKIE, state, {
    path: STATE_PATH, httpOnly: true, sameSite: 'lax', maxAge: 600,
    secure: base.startsWith('https:'),
  });
  return context.redirect(authorizeURL(context.url.origin, state.split(':')[0]));
};
