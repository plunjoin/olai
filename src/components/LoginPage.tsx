import { useEffect, useState, type SubmitEvent } from 'react';
import { ArrowLeft, CircleAlert, Eye, EyeOff, KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-react';
import { accountRequest } from '../lib/account';
import { flushStorage } from '../lib/storage';
import { t } from '../lib/i18n';
import { AuthBrand, AuthShowcase } from './auth/AuthFrame';
import GithubSvg from './svg/GithubSvg';

const GITHUB_ERRORS: Record<string, string> = {
  config: t('GitHub 登录尚未配置，请使用邮箱登录。'),
  denied: t('已取消 GitHub 授权。'),
  state: t('GitHub 登录会话已过期，请重试。'),
  network: t('暂时无法连接 GitHub，请稍后重试或联系管理员检查服务器网络代理。'),
  token: t('GitHub 授权失败，请重试。'),
  profile: t('无法读取 GitHub 账号信息，请重试。'),
  email: t('GitHub 账号没有可用的已验证邮箱，请先在 GitHub 验证邮箱。'),
  banned: t('此账号已被停用，请联系管理员。'),
  failed: t('GitHub 登录失败，请重试。'),
};

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'sent';

const query = (name: string) => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) || '';
};
const githubError = () => GITHUB_ERRORS[query('github_error')] || (query('github_error') ? GITHUB_ERRORS.failed : '');
/** 只接受站内相对路径，避免 ?next= 被用作开放跳转。 */
const nextPath = () => {
  const next = query('next');
  return /^\/(?!\/)/.test(next) && !next.startsWith('/login') ? next : '/';
};
const stripAuthParams = () => {
  const url = new URL(window.location.href);
  for (const name of ['github_error', 'verify', 'reset']) url.searchParams.delete(name);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
};

export default function LoginPage({ githubLogin = false }: { githubLogin?: boolean }) {
  const [mode, setMode] = useState<Mode>(() => query('reset') ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [invite, setInvite] = useState(() => typeof window === 'undefined' ? '' : query('invite').toUpperCase());
  const [resetToken, setResetToken] = useState(() => query('reset'));
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(Boolean(query('verify')));
  const [error, setError] = useState(githubError);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const verifyToken = query('verify');
    const reset = query('reset');
    // GitHub 回调失败或验证/重置链接带来的参数用过后从地址栏移除。
    if (query('github_error') || verifyToken || reset) stripAuthParams();
    if (githubError()) return;
    let alive = true;
    if (verifyToken) {
      accountRequest('verify', { token: verifyToken }).then(async state => {
        if (!alive) return;
        if (state.user) {
          await flushStorage();
          window.location.replace(nextPath());
        }
      }).catch(failure => {
        if (!alive) return;
        setBusy(false);
        setMode('login');
        setError(failure instanceof Error ? failure.message : t('账号操作失败，请重试。'));
      });
      return () => { alive = false; };
    }
    // 已登录时直接回到工作台，避免重复输入账号。
    accountRequest('me').then(state => {
      if (alive && state.user) window.location.replace(nextPath());
    }).catch(() => { /* 账号服务不可用时仍展示表单，提交时会给出具体原因。 */ });
    return () => { alive = false; };
  }, []);

  const switchMode = (next: Mode, message = '') => {
    setMode(next);
    setError('');
    setNotice(message);
    if (next !== 'reset') setResetToken('');
    if (next !== 'register' && next !== 'login') setPassword('');
    setConfirmation('');
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || mode === 'sent') return;
    if ((mode === 'register' || mode === 'reset') && password !== confirmation) { setError(t('两次输入的密码不一致。')); return; }
    setBusy(true);
    setError('');
    try {
      if (mode === 'forgot') {
        const state = await accountRequest('forgot', { email });
        setBusy(false);
        switchMode('sent', state.message || t('如果该邮箱已注册，我们已发送重置邮件。'));
        return;
      }
      if (mode === 'reset') {
        await flushStorage();
        await accountRequest('reset', { token: resetToken, password });
        window.location.assign(nextPath());
        return;
      }
      await flushStorage();
      const action = mode === 'register' ? 'register' : 'login';
      const state = await accountRequest(action, { email, password, ...(action === 'register' && invite.trim() ? { inviteCode: invite.trim() } : {}) });
      if (state.pendingVerification) {
        setBusy(false);
        switchMode('sent', state.message || t('验证邮件已发送，请查收后再登录。'));
        return;
      }
      window.location.assign(nextPath());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('账号操作失败，请重试。'));
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || !email) { setError(t('请输入有效邮箱。')); switchMode('login'); return; }
    setBusy(true);
    setError('');
    try {
      const state = await accountRequest('resend', { email });
      setNotice(state.message || t('如果该邮箱需要验证，我们已发送验证邮件。'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('账号操作失败，请重试。'));
    } finally {
      setBusy(false);
    }
  };

  const githubHref = `/api/auth/github${mode === 'register' && invite.trim() ? `?invite=${encodeURIComponent(invite.trim())}` : ''}`;
  const title = {
    login: t('欢迎回来'),
    register: t('开始你的创作'),
    forgot: t('重置密码'),
    reset: t('设置新密码'),
    sent: t('请查收邮件'),
  }[mode];
  const subtitle = {
    login: t('登录后继续你的创作旅程。'),
    register: t('注册后即可保存并同步创作记录。'),
    forgot: t('输入注册邮箱，我们会发送重置链接。'),
    reset: t('请输入 8–128 位新密码。'),
    sent: notice ? t(notice) : t('请到邮箱查收邮件，并留意垃圾箱。'),
  }[mode];

  return <div className="auth-page">
    <AuthShowcase />
    <main className="auth-main">
      <div className="auth-main-top">
        <span className="auth-mobile-brand"><AuthBrand /></span>
        <a className="auth-back" href="/" aria-label={t('返回工作台')}><ArrowLeft size={15} /><span>{t('返回工作台')}</span></a>
      </div>
      <div className="auth-card-wrap">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="auth-sub">{subtitle}</p>

          {(mode === 'login' || mode === 'register') && <div className="auth-tabs" role="tablist" aria-label={t('登录或注册')}>
            <button type="button" role="tab" className="auth-tab" aria-selected={mode === 'login'} disabled={busy} onClick={() => switchMode('login')}>{t('登录')}</button>
            <button type="button" role="tab" className="auth-tab" aria-selected={mode === 'register'} disabled={busy} onClick={() => switchMode('register')}>{t('创建账号')}</button>
          </div>}

          {mode === 'sent' ? <div className="auth-sent">
            {error && <p className="auth-error" role="alert"><CircleAlert size={15} /><span>{t(error)}</span></p>}
            <p className="auth-hint">{t('没有收到？请检查垃圾箱，或重新发送邮件。')}</p>
            <button className="primary-button auth-submit" type="button" disabled={busy} onClick={() => void resend()}>
              <MailCheck size={16} />{busy ? t('请稍候…') : t('重新发送邮件')}
            </button>
          </div> : <form onSubmit={event => void submit(event)}>
            {error && <p className="auth-error" role="alert"><CircleAlert size={15} /><span>{t(error)}</span></p>}

            {githubLogin && (mode === 'login' || mode === 'register') && <>
              <a className="auth-github" href={githubHref}><GithubSvg size={16} />{t('使用 GitHub 登录')}</a>
              <div className="auth-divider">{t('或使用邮箱')}</div>
            </>}

            {mode !== 'reset' && <label className="auth-field"><span className="auth-label">{t('邮箱')}</span><input type="email" name="email" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>}
            {mode !== 'forgot' && <label className="auth-field">
              <span className="auth-label">{mode === 'reset' ? t('新密码') : t('密码')}</span>
              <span className="auth-input-wrap">
                <input type={reveal ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
                <button type="button" className="auth-eye" aria-label={reveal ? t('隐藏密码') : t('显示密码')} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
            </label>}
            {mode === 'login' && <p className="auth-switch auth-forgot"><button type="button" disabled={busy} onClick={() => switchMode('forgot')}>{t('忘记密码？')}</button></p>}
            {(mode === 'register' || mode === 'reset') && <label className="auth-field"><span className="auth-label">{t('确认密码')}</span><input type={reveal ? 'text' : 'password'} name="confirmation" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>}
            {mode === 'register' && <label className="auth-field"><span className="auth-label">{t('邀请码（可选）')}</span><input type="text" name="invite" autoComplete="off" maxLength={12} value={invite} disabled={busy} placeholder={t('8 位邀请码')} onChange={event => setInvite(event.target.value.toUpperCase())} /></label>}

            {mode === 'register' && <>
              {githubLogin && <p className="auth-hint">{t('GitHub 登录会自动创建账号；该邮箱已有账号时直接关联。邀请码会一并带入。')}</p>}
              <p className="auth-hint">{t('注册后需要验证邮箱才能登录。每天按北京时间零点重置额度。歌曲封面使用图片额度。登录账号生成时按所选画质消耗积分。')}</p>
            </>}

            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {mode === 'login' ? <LogIn size={16} /> : mode === 'register' ? <UserPlus size={16} /> : <KeyRound size={16} />}
              {busy ? t('请稍候…') : mode === 'login' ? t('登录') : mode === 'register' ? t('注册') : mode === 'reset' ? t('保存新密码') : t('发送重置邮件')}
            </button>
          </form>}

          <p className="auth-switch">
            {mode === 'login'
              ? <>{t('还没有账号？')}<button type="button" disabled={busy} onClick={() => switchMode('register')}>{t('创建账号')}</button></>
              : mode === 'register'
              ? <>{t('已有账号？')}<button type="button" disabled={busy} onClick={() => switchMode('login')}>{t('去登录')}</button></>
              : <>{t('想起密码了？')}<button type="button" disabled={busy} onClick={() => switchMode('login')}>{t('去登录')}</button></>}
          </p>
        </div>
        <p className="auth-legal">{t('同一浏览器内的游客记录会在登录后自动同步。')}</p>
      </div>
    </main>
  </div>;
}
