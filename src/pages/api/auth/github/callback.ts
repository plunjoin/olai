import type { APIRoute } from 'astro';
import { startSession } from '../../../../lib/server/auth';
import { AccountBannedError } from '../../../../lib/server/admin';
import { decodeState, GithubAuthError, githubAccessToken, githubEnabled, githubProfile, siteOrigin, STATE_COOKIE, STATE_PATH } from '../../../../lib/server/github';
import { loginWithGithub } from '../../../../lib/server/oauth';

export const prerender = false;

export const GET: APIRoute = async context => {
  const base = siteOrigin(context.url.origin);
  const stateCookie = context.cookies.get(STATE_COOKIE)?.value;
  context.cookies.delete(STATE_COOKIE, { path: STATE_PATH });
  const back = (error?: string) => context.redirect(error ? `${base}/login?github_error=${encodeURIComponent(error)}` : `${base}/`);

  if (!githubEnabled()) return back('config');
  if (context.url.searchParams.get('error')) return back('denied');
  const { state, inviteCode } = decodeState(stateCookie);
  // state 必须与本次浏览器发起的授权一致，防止把别人的 GitHub 回调塞进当前会话。
  if (!state || context.url.searchParams.get('state') !== state) return back('state');
  const code = context.url.searchParams.get('code');
  if (!code) return back('token');
  try {
    const token = await githubAccessToken(code, context.url.origin, AbortSignal.timeout(15_000));
    const profile = await githubProfile(token, AbortSignal.timeout(15_000));
    const user = await loginWithGithub(profile, inviteCode);
    await startSession(context, user.id);
    return back();
  } catch (error) {
    console.error('GitHub login failed:', error);
    if (error instanceof AccountBannedError) return back('banned');
    return back(error instanceof GithubAuthError ? error.code : 'failed');
  }
};
