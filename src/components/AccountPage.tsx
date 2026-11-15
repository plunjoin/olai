import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Copy, Images, LayoutGrid, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import { accountRequest, type AccountState } from '../lib/account';
import { flushStorage, initializeStorage, syncGuestRecords } from '../lib/storage';
import { t } from '../lib/i18n';
import AccountSyncCard from './AccountSyncCard';
import BrandLogoSvg from './svg/BrandLogoSvg';

export default function AccountPage() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setAccount(await initializeStorage());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('账号服务暂不可用。'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async (userId: string) => {
    setSyncing(true);
    setSyncNote('');
    try {
      const report = await syncGuestRecords(userId);
      setFailures(report.failures);
      if (!report.failures.length) setSyncNote(t('本地数据与云端附件已同步。'));
    } catch (failure) {
      setFailures([failure instanceof Error ? failure.message : t('请重试。')]);
    } finally {
      setSyncing(false);
    }
  }, []);

  const userId = account?.user?.id;
  useEffect(() => {
    // 从登录页带 next=/account 直接进来时，补一次游客数据同步。
    if (userId) void sync(userId);
  }, [userId, sync]);

  const copyInvite = async () => {
    if (!account?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(account.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* 剪贴板不可用时仍可手动选中邀请码。 */ }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await flushStorage();
      await accountRequest('logout');
      window.location.assign('/');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('账号操作失败，请重试。'));
      setBusy(false);
    }
  };

  const user = account?.user || null;
  const prices = account?.prices;
  const name = user?.email?.split('@')[0] || t('访客');
  const chatLimit = account?.chatLimit ?? 100;

  return <div className="account-page">
    <header className="account-topbar">
      <a className="account-brand" href="/"><BrandLogoSvg size={30} /><span>Olai</span></a>
      <nav className="account-topnav" aria-label={t('账号中心导航')}>
        <a href="/library">{t('我的库')}</a>
        <a href="/gallery">{t('作品广场')}</a>
        <a className="account-back" href="/" aria-label={t('返回工作台')}><ArrowLeft size={15} />{t('返回工作台')}</a>
      </nav>
    </header>

    <main className="account-main">
      <div className="account-heading">
        <h1>{t('账号中心')}</h1>
        <p>{t('管理你的账号、积分与每日额度。')}</p>
      </div>

      {account && error && <div className="account-error" role="alert" style={{ marginBottom: '16px' }}>
        <CircleAlert size={17} />
        <span>{t(error)}</span>
      </div>}

      {!account && !error && <div className="account-loading" aria-busy="true">
        <div className="account-skeleton" />
        <div className="account-skeleton short" />
        <div className="account-skeleton" />
      </div>}

      {error && !account && <div className="account-error" role="alert">
        <CircleAlert size={17} />
        <span>{t(error)}</span>
        <button type="button" className="secondary-button" onClick={() => void load()}>{t('重新加载')}</button>
      </div>}

      {account && !user && <div className="account-error" role="alert">
        <CircleAlert size={17} />
        <span>{t('登录状态已失效，请重新登录。')}</span>
        <a className="secondary-button" href="/login?next=%2Faccount">{t('去登录')}</a>
      </div>}

      {account && user && <div className="account-grid">
        <section className="account-card account-profile">
          <span className="account-avatar"><BrandLogoSvg size={42} /></span>
          <div className="account-identity">
            <h2>{name}<span className="account-badge">{t('已登录')}</span></h2>
            <p>{user.email}</p>
          </div>
          <div className="account-profile-actions">
            {account.admin && <a className="secondary-button" href="/admin">{t('进入管理后台')}</a>}
            <button type="button" className="danger-button" disabled={busy} onClick={() => void logout()}><LogOut size={15} />{busy ? t('请稍候…') : t('退出登录')}</button>
          </div>
        </section>

        <div className="account-stats">
          <section className="account-card account-stat">
            <span className="account-stat-label">{t('积分余额')}</span>
            <strong>{account.points ?? 0}</strong>
            <small>{t('积分可用于图片、视频与音乐生成')}</small>
          </section>
          <section className="account-card account-stat">
            <span className="account-stat-label">{t('图片 / 视频 / 音乐')}</span>
            <strong>{account.generationLimit}</strong>
            <small>{t('次 / 天，按北京时间零点重置')}</small>
          </section>
          <section className="account-card account-stat">
            <span className="account-stat-label">{t('对话')}</span>
            <strong>{chatLimit}</strong>
            <small>{t('条 / 天，与创作额度分开计算')}</small>
          </section>
        </div>

        <div className="account-columns">
          <div className="account-column">
            <section className="account-card">
              <div className="account-card-head"><h2>{t('积分价目')}</h2><span>{t('按生成档位计费')}</span></div>
              <dl className="account-rates">
                <div className="account-rate">
                  <dt>{t('图片（每次）')}</dt>
                  <dd>{prices ? Object.entries(prices.image).map(([quality, cost]) => `${quality} ${cost}`).join(' · ') : '—'}</dd>
                </div>
                <div className="account-rate">
                  <dt>{t('视频（每秒）')}</dt>
                  <dd>{prices ? Object.entries(prices.video).map(([resolution, cost]) => `${resolution} ${cost}`).join(' · ') : '—'}</dd>
                </div>
                <div className="account-rate">
                  <dt>{t('音乐（每分钟）')}</dt>
                  <dd>{prices ? prices.musicPerMinute : '—'}</dd>
                </div>
                <div className="account-rate">
                  <dt>{t('对话（每条）')}</dt>
                  <dd>{prices ? (prices.chatPerMessage > 0 ? prices.chatPerMessage : t('免费')) : '—'}</dd>
                </div>
              </dl>
              <p className="account-note" style={{ marginTop: '12px' }}>{t('歌曲封面使用图片额度；登录账号生成时按所选画质消耗积分。')}</p>
            </section>

            <AccountSyncCard syncing={syncing} note={syncNote} failures={failures} onSync={() => { if (userId) void sync(userId); }} />

            <section className="account-card">
              <div className="account-card-head"><h2>{t('额度说明')}</h2></div>
              <p className="account-note">{t('每天按北京时间零点重置额度。额度用完后仍可浏览作品广场与个人库，次日恢复。')}</p>
            </section>
          </div>

          <div className="account-column">
            <section className="account-card">
              <div className="account-card-head"><h2>{t('邀请好友')}</h2><span>{t('双方各得积分')}</span></div>
              <p className="account-note">{t('好友使用邀请码注册并完成首次生成后，双方都会获得积分。')}</p>
              {account.inviteCode
                ? <div className="account-code">
                    <code>{account.inviteCode}</code>
                    <button type="button" className="secondary-button" onClick={() => void copyInvite()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('已复制') : t('复制邀请码')}</button>
                  </div>
                : <p className="account-note" style={{ marginTop: '10px' }}>{t('邀请码生成中，请稍后刷新。')}</p>}
            </section>

            <section className="account-card">
              <div className="account-card-head"><h2>{t('快捷入口')}</h2></div>
              <div className="account-links">
                <a className="account-link" href="/library"><LayoutGrid size={16} />{t('我的库')}</a>
                <a className="account-link" href="/gallery"><Images size={16} />{t('作品广场')}</a>
                <a className="account-link" href="/"><Sparkles size={16} />{t('继续创作')}</a>
                {account.admin && <a className="account-link" href="/admin"><ShieldCheck size={16} />{t('管理后台')}</a>}
              </div>
            </section>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
