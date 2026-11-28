"""Check whether Google accepts a redirect_uri for an OAuth client.

Google compares redirect_uri byte for byte; it never prefix-matches a path.
When the Authorized redirect URIs list in the Cloud Console does not contain
the exact value the server sends, the browser lands on an opaque
"Error 400: redirect_uri_mismatch" page and nothing else explains it. This
script reproduces that check without a login, so the console can be verified
after every change.

    python scripts/verify-oauth-redirect.py --client-id <CLIENT_ID> \
        --redirect-uri https://example.com/api/auth/google/callback

Exit code 0 means the URI is registered (Google showed its sign-in page),
1 means it is rejected or the client id is wrong, 2 means the probe itself
could not be completed.
"""
import argparse
import base64
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TIMEOUT = 30

# Windows consoles default to a legacy code page, which mangles the Chinese
# output. Force UTF-8 so the result reads the same everywhere.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8', errors='replace')


def probe(client_id, redirect_uri, proxy):
    # Google checks redirect_uri before it checks anything else, so a plain
    # request without a real code is enough to learn whether the URI matches.
    challenge = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode()
    query = urllib.parse.urlencode({
        'client_id': client_id,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': 'verify-redirect-uri',
    })
    opener = urllib.request.build_opener()
    if proxy:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({
            'http': proxy, 'https': proxy,
        }))
    request = urllib.request.Request(f'{AUTH_URL}?{query}', headers={
        'User-Agent': 'Mozilla/5.0 verify-oauth-redirect',
    })
    try:
        with opener.open(request, timeout=TIMEOUT) as response:
            return response.read().decode('utf-8', 'replace'), response.geturl()
    except urllib.error.HTTPError as error:
        return error.read().decode('utf-8', 'replace'), error.geturl()
    except urllib.error.URLError as error:
        print(f'无法连接 Google：{error.reason}', file=sys.stderr)
        if not proxy:
            print('提示：若本机需要代理，请加 --proxy http://127.0.0.1:7897', file=sys.stderr)
        return None, ''


def classify(body, final_url):
    if body is None:
        return 'unknown', '探测请求失败'
    if 'redirect_uri_mismatch' in body:
        return 'mismatch', 'redirect_uri 未登记在 Cloud Console（或与登记值不完全一致）'
    if 'invalid_client' in body:
        return 'invalid_client', 'client_id 无效或不是 Web application 类型'
    if 'invalid_request' in body:
        return 'invalid_request', '请求参数被拒绝，检查 redirect_uri 是否为合法绝对地址'
    if 'access_denied' in body:
        return 'access_denied', '同意屏处于 Testing 且当前账号不是测试用户（回调会返回 google_error=denied）'
    # Google checks redirect_uri first, so reaching any sign-in page means the
    # URI matched. The flow moved from GeneralOAuthFlow (legacy/consent) to
    # GeneralOAuthLite (v3/signin/identifier), so accept either shape.
    if 'accounts.google.com' in final_url and '/signin' in final_url:
        return 'ok', '已通过校验，Google 正常显示登录页'
    if 'accounts.google.com/signin' in body:
        return 'ok', '已通过校验，Google 正常显示登录页'
    return 'unknown', f'未识别的响应（最终地址 {final_url}），请人工确认'


def main():
    parser = argparse.ArgumentParser(description='验证 Google OAuth 回调地址是否已登记')
    parser.add_argument('--client-id', default=os.environ.get('GOOGLE_CLIENT_ID', ''),
                        help='OAuth 客户端 ID（默认取环境变量 GOOGLE_CLIENT_ID）')
    parser.add_argument('--redirect-uri', default=os.environ.get('OAUTH_REDIRECT_URI', ''),
                        help='要验证的回调地址（默认取环境变量 OAUTH_REDIRECT_URI）')
    parser.add_argument('--proxy', default=os.environ.get('HTTPS_PROXY', ''),
                        help='代理地址，例如 http://127.0.0.1:7897')
    parser.add_argument('--json', action='store_true', help='以 JSON 输出结果')
    args = parser.parse_args()

    if not args.client_id or not args.redirect_uri:
        parser.error('需要 --client-id 与 --redirect-uri（或设置同名环境变量）')

    body, final_url = probe(args.client_id, args.redirect_uri, args.proxy)
    verdict, detail = classify(body, final_url)
    result = {
        'clientId': args.client_id,
        'redirectUri': args.redirect_uri,
        'verdict': verdict,
        'detail': detail,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f'client_id    : {args.client_id}')
        print(f'redirect_uri : {args.redirect_uri}')
        print(f'结果          : {verdict}')
        print(f'说明          : {detail}')

    if verdict == 'ok':
        return 0
    if verdict == 'unknown':
        return 2
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
