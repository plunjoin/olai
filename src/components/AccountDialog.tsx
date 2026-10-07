import { useId, useState } from 'react';
import { LogIn, LogOut, X } from 'lucide-react';
import Dialog from './ui/Dialog';
import { accountRequest, type AccountState } from '../lib/account';
import { flushStorage, syncGuestRecords } from '../lib/storage';

export default function AccountDialog({ account, onClose }: { account: AccountState; onClose: () => void }) {
  const titleId = useId();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncAccount, setSyncAccount] = useState<AccountState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const close = () => { if (!busy) { if (syncAccount?.user) window.location.assign('/'); else onClose(); } };
  const submit = async () => {
    if (busy) return;
    if (!account.user && !syncAccount && mode === 'register' && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true); setError('');
    try {
      await flushStorage();
      const next = syncAccount || await accountRequest(account.user ? 'logout' : mode, { email, password });
      if (next.user && !account.user) {
        setSyncAccount(next); setSyncing(true);
        await syncGuestRecords(next.user.id);
      }
      window.location.assign('/');
    } catch (error) { setError(error instanceof Error ? error.message : '账号操作失败，请重试。'); setBusy(false); setSyncing(false); }
  };
  return <Dialog labelledBy={titleId} onClose={close} className="account-modal">
    <form className="account-dialog" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="modal-heading"><h2 id={titleId}>{account.user ? '我的账号' : mode === 'login' ? '登录 Olai' : '注册 Olai'}</h2><button type="button" className="icon-button" aria-label="关闭账号窗口" disabled={busy} onClick={close}><X size={20} /></button></div>
      {account.user ? <><p className="account-email">{account.user.email}</p><p className="muted">会话、作品和歌词保存到你的账号。图片、音乐、视频每天各可生成 {account.generationLimit} 次，对话不限次数。</p><p className="field-hint">游客记录已关联到账号，退出后可继续以游客身份使用。</p></> : <>
        <p className="muted">登录后会将游客会话和作品同步到当前账号，可在其他设备继续查看。</p>
        <label className="field-label">邮箱<input data-dialog-focus type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
        <label className="field-label">密码<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
        {mode === 'register' && <label className="field-label">确认密码<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>}
        <p className="field-hint">每天按北京时间零点重置额度。歌曲封面使用图片额度。</p>
      </>}
      {error && <p className="message-error" role="alert">{error}</p>}
      <div className="modal-footer">{!account.user && !syncAccount && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '创建账号' : '已有账号，去登录'}</button>}
        <button className="primary-button" type="submit" disabled={busy}>{account.user ? <LogOut size={16} /> : <LogIn size={16} />}{busy ? syncing ? '正在同步游客记录…' : '请稍候…' : syncAccount ? '重试同步' : account.user ? '退出登录' : mode === 'login' ? '登录' : '注册并登录'}</button>
      </div>
    </form>
  </Dialog>;
}
