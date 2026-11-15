import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeURL, decodeState, encodeState, githubAccessToken, githubEnabled, githubProfile, GithubAuthError } from '../server/github';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function configured() {
  vi.stubEnv('GITHUB_CLIENT_ID', 'client');
  vi.stubEnv('GITHUB_CLIENT_SECRET', 'secret');
}

describe('GitHub OAuth helpers', () => {
  it('stays disabled until both credentials are configured', () => {
    expect(githubEnabled()).toBe(false);
    vi.stubEnv('GITHUB_CLIENT_ID', 'client');
    expect(githubEnabled()).toBe(false);
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'secret');
    expect(githubEnabled()).toBe(true);
  });

  it('builds the authorize URL from SITE_ORIGIN and carries state', () => {
    configured(); vi.stubEnv('SITE_ORIGIN', 'https://olai.example.com/');
    const url = new URL(authorizeURL('http://localhost:4321', 'abc123'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://olai.example.com/api/auth/github/callback');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('abc123');
  });

  it('keeps the invite code in the state cookie and strips unsafe characters', () => {
    const value = encodeState('ab12-cd');
    const [state] = value.split(':');
    expect(state).toMatch(/^[a-f0-9]{32}$/);
    expect(decodeState(value)).toEqual({ state, inviteCode: 'AB12CD' });
    expect(decodeState(undefined)).toEqual({ state: '', inviteCode: '' });
  });

  it('exchanges the authorization code and rejects a missing token', async () => {
    configured();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'token-1' }))
      .mockResolvedValueOnce(Response.json({ error: 'bad_verification_code' }));
    vi.stubGlobal('fetch', fetch);
    await expect(githubAccessToken('code-1', 'http://localhost:4321', AbortSignal.timeout(1000))).resolves.toBe('token-1');
    const body = new URLSearchParams(fetch.mock.calls[0][1].body as string);
    expect(body.get('code')).toBe('code-1');
    expect(body.get('redirect_uri')).toBe('http://localhost:4321/api/auth/github/callback');
    await expect(githubAccessToken('code-2', 'http://localhost:4321', AbortSignal.timeout(1000)))
      .rejects.toMatchObject({ code: 'token' });
  });

  it('uses only the verified primary email', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 42, login: 'octocat' }))
      .mockResolvedValueOnce(Response.json([
        { email: 'secondary@example.test', primary: false, verified: true },
        { email: 'Main@Example.test', primary: true, verified: true },
      ]));
    vi.stubGlobal('fetch', fetch);
    await expect(githubProfile('token', AbortSignal.timeout(1000)))
      .resolves.toEqual({ id: '42', login: 'octocat', email: 'main@example.test' });
  });

  it('classifies an unreachable GitHub endpoint as a network error', async () => {
    configured();
    vi.stubEnv('GITHUB_PROXY', '');
    vi.stubEnv('GITHUB_RESOLVE_IP', '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await githubAccessToken('code', 'http://localhost:4321', AbortSignal.timeout(1000)).catch(reason => reason);
    expect(error).toBeInstanceOf(GithubAuthError);
    expect(error.code).toBe('network');
  });

  it('rejects an account without a verified email', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 7, login: 'person' }))
      .mockResolvedValueOnce(Response.json([{ email: 'unverified@example.test', primary: true, verified: false }]));
    vi.stubGlobal('fetch', fetch);
    const error = await githubProfile('token', AbortSignal.timeout(1000)).catch(reason => reason);
    expect(error).toBeInstanceOf(GithubAuthError);
    expect(error.code).toBe('email');
  });
});
