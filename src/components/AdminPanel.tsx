import { useCallback, useEffect, useMemo, useState } from 'react';
import { intlLocale, t, tIn } from '../lib/i18n';
import type { ModelPrices } from '../lib/types';

const TABS = [
  ['overview', t('概览')],
  ['users', t('用户')],
  ['invites', t('邀请')],
  ['content', t('生成与媒体')],
  ['models', t('模型与定价')],
  ['settings', t('系统设置')],
  ['logs', t('操作日志')],
] as const;
type Tab = typeof TABS[number][0];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as any)?.error?.message || t('请求失败，请稍后重试。'));
  return data as T;
}

const when = (value: number | null | undefined) => value ? new Date(value).toLocaleString(intlLocale(), { hour12: false }) : '—';
const bytes = (value: number) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};
const REASONS: Record<string, string> = {
  signup: t('注册赠送'), spend: t('生成消耗'), refund: t('失败退款'), invite: t('邀请奖励'),
  'invite-bonus': t('被邀请奖励'), 'admin-adjust': t('管理员调整'),
};

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) { setData(null); setError(''); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api<T>(path).then(result => { if (alive) { setData(result); setError(''); } })
      .catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : t('加载失败。')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, version]);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  return { data, error, loading, reload };
}

function Feedback({ message }: { message: { tone: 'ok' | 'error'; text: string } | null }) {
  if (!message) return null;
  return <p className="adm-feedback" data-tone={message.tone} role="status">{t(message.text)}</p>;
}

function Loading() { return <p className="adm-note"><span className="adm-spinner" /> {t('加载中…')}</p>; }
function Failure({ error, retry }: { error: string; retry: () => void }) {
  if (!error) return null;
  return <div className="adm-feedback" data-tone="error" role="alert">{t(error)} <button type="button" className="adm-btn adm-btn-sm" onClick={retry}>{t('重试')}</button></div>;
}

export default function AdminPanel({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="adm-shell">
      <header className="adm-header">
        <div className="adm-brand">
          <span className="adm-brand-mark">O</span>
          <span>{t('Olai 管理后台')}<small>ADMIN CONSOLE</small></span>
        </div>
        <div className="adm-header-right">
          <span>{email}</span>
          <a className="adm-link" href="/">{t('返回站点')}</a>
        </div>
      </header>
      <nav className="adm-tabs" role="tablist" aria-label={t('管理后台分区')}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" className="adm-tab" aria-selected={tab === key}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      <main className="adm-main">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <UsersTab />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'logs' && <LogsTab />}
      </main>
    </div>
  );
}

/* ---------------------------------- 概览 ---------------------------------- */

interface OverviewData {
  users: { total: number; today: number; week: number };
  points: { circulating: number; issued: number; spent: number };
  today: { generations: number; points: number };
  invites: { total: number; rewarded: number };
  media: { count: number; bytes: number };
  records: number;
  series: { day: string; points: number; generations: number }[];
  recentUsers: { id: string; email: string; createdAt: number; balance: number }[];
}

function Overview() {
  const { data, error, loading, reload } = useLoad<OverviewData>('/api/admin/overview');
  const peak = useMemo(() => Math.max(1, ...(data?.series ?? []).map(row => row.points)), [data]);
  return (
    <>
      <Failure error={error} retry={reload} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="adm-stack">
          <div className="adm-stats">
            <Stat label={t('账号总数')} value={data.users.total} hint={t('今日 +{today} · 近 7 天 +{week}', { today: data.users.today, week: data.users.week })} />
            <Stat label={t('流通积分')} value={data.points.circulating} hint={t('累计发放 {issued}', { issued: data.points.issued })} />
            <Stat label={t('今日消耗')} value={data.today.points} hint={t('{n} 次生成', { n: data.today.generations })} />
            <Stat label={t('累计消耗')} value={data.points.spent} hint={t('登录账号的积分扣费')} />
            <Stat label={t('邀请关系')} value={data.invites.total} hint={t('已发放 {n}', { n: data.invites.rewarded })} />
            <Stat label={t('媒体对象')} value={data.media.count} hint={bytes(data.media.bytes)} />
          </div>
          <section className="adm-card">
            <div className="adm-card-head">
              <div>
                <div className="adm-card-title">{t('近 14 天积分消耗')}</div>
                <div className="adm-card-sub">{t('柱高表示当日生成消耗的积分；游客生成不计入积分账本。')}</div>
              </div>
              <span className="adm-badge" data-tone="info">{t('作品记录 {n}', { n: data.records })}</span>
            </div>
            {data.series.some(row => row.points > 0) ? (
              <div className="adm-chart" role="img" aria-label={t('近 14 天积分消耗柱状图')}>
                {data.series.map(row => (
                  <div key={row.day} className="adm-bar-wrap" title={t('{day}：{points} 积分 / {count} 次', { day: row.day, points: row.points, count: row.generations })}>
                    <div className="adm-bar" data-empty={row.points === 0} style={{ height: `${Math.max(2, row.points / peak * 118)}px` }} />
                    <span className="adm-bar-label">{row.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="adm-empty">{t('最近 14 天还没有登录账号的生成消耗。')}</div>}
          </section>
          <section className="adm-card">
            <div className="adm-card-head"><div className="adm-card-title">{t('最新账号')}</div></div>
            <UserTable rows={data.recentUsers} />
          </section>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="adm-stat">
      <div className="adm-stat-value">{value.toLocaleString(intlLocale())}</div>
      <div className="adm-stat-label">{label}</div>
      {hint ? <div className="adm-stat-hint">{hint}</div> : null}
    </div>
  );
}

/* ---------------------------------- 用户 ---------------------------------- */

interface UserRow { id: string; email: string; createdAt: number; balance: number; bannedAt: number | null; banReason: string | null }
interface UsersData { users: UserRow[]; total: number; nextPage: number | null }

function UserTable({ rows }: { rows: { id: string; email: string; createdAt: number; balance: number }[] }) {
  if (!rows.length) return <div className="adm-empty">{t('暂无账号。')}</div>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th>{t('邮箱')}</th><th>{t('注册时间')}</th><th className="num">{t('积分')}</th></tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.email}</td>
              <td className="muted">{when(row.createdAt)}</td>
              <td className="num">{row.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTab() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const path = `/api/admin/users?page=${page}&q=${encodeURIComponent(query)}`;
  const { data, error, loading, reload } = useLoad<UsersData>(path);

  return (
    <div className="adm-split">
      <section className="adm-card">
        <form className="adm-toolbar" onSubmit={event => { event.preventDefault(); setSelected(null); setPage(1); setQuery(input.trim()); }}>
          <input className="adm-input" value={input} onChange={event => setInput(event.target.value)}
            placeholder={t('搜索邮箱或账号 ID')} aria-label={t('搜索账号')} />
          <button type="submit" className="adm-btn">{t('搜索')}</button>
          {input || query ? <button type="button" className="adm-btn" onClick={() => { setInput(''); setQuery(''); setPage(1); }}>{t('清除')}</button> : null}
          <span className="adm-card-sub">{t('共 {n} 个账号', { n: data?.total ?? '—' })}</span>
        </form>
        <Failure error={error} retry={reload} />
        {loading && !data ? <Loading /> : null}
        {data && !data.users.length ? <div className="adm-empty">{t('没有匹配的账号。')}</div> : null}
        {data?.users.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>{t('邮箱')}</th><th>{t('注册时间')}</th><th className="num">{t('积分')}</th><th>{t('状态')}</th></tr></thead>
              <tbody>
                {data.users.map(row => (
                  <tr key={row.id} className={`adm-clickable ${selected === row.id ? 'adm-row-active' : ''}`}
                    onClick={() => setSelected(row.id)}>
                    <td>{row.email}<div className="adm-mono muted">{row.id}</div></td>
                    <td className="muted">{when(row.createdAt)}</td>
                    <td className="num">{row.balance}</td>
                    <td>{row.bannedAt
                      ? <span className="adm-badge" data-tone="danger">{t('已停用')}</span>
                      : <span className="adm-badge" data-tone="ok">{t('正常')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="adm-pagination">
          <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t('上一页')}</button>
          <span>{t('第 {page} 页', { page })}</span>
          <button type="button" className="adm-btn adm-btn-sm" disabled={!data?.nextPage}
            onClick={() => setPage(data?.nextPage ?? page)}>{t('下一页')}</button>
        </div>
      </section>
      {selected
        ? <UserDetail id={selected} onChanged={reload} onClose={() => setSelected(null)} />
        : <section className="adm-card"><div className="adm-empty">{t('选择左侧账号查看积分流水、邀请关系与封禁操作。')}</div></section>}
    </div>
  );
}

interface DetailData {
  user: { id: string; email: string; createdAt: number; balance: number; banned: { reason: string; bannedAt: number } | null };
  oauth: { provider: string; createdAt: number }[];
  stats: { spendCount: number; spendPoints: number; mediaCount: number; mediaBytes: number; recordCount: number };
  ledger: { delta: number; reason: string; refId: string; createdAt: number }[];
  invites: { email: string; code: string; createdAt: number; rewardedAt: number | null; rewarded: boolean }[];
  invitedBy: { email: string; code: string; createdAt: number; rewardedAt: number | null } | null;
}

function UserDetail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { data, error, loading, reload } = useLoad<DetailData>(`/api/admin/users/${id}`);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [banReason, setBanReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => { setDelta(''); setNote(''); setBanReason(''); setMessage(null); }, [id]);

  async function adjust(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ balance: number }>(`/api/admin/users/${id}/points`, {
        method: 'POST', body: JSON.stringify({ delta: Number(delta), note }),
      });
      setMessage({ tone: 'ok', text: t('已调整，当前余额 {balance}。', { balance: result.balance }) });
      setDelta(''); setNote('');
      reload(); onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('调整失败。') });
    } finally { setBusy(false); }
  }

  async function toggleBan(banned: boolean) {
    if (banned && !banReason.trim()) { setMessage({ tone: 'error', text: t('请填写停用原因。') }); return; }
    if (!window.confirm(banned ? t('停用后该账号会立即退出登录，且无法再登录。确认停用？') : t('确认恢复该账号？'))) return;
    setBusy(true); setMessage(null);
    try {
      await api(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned, reason: banReason }) });
      setMessage({ tone: 'ok', text: banned ? t('账号已停用。') : t('账号已恢复。') });
      setBanReason('');
      reload(); onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('操作失败。') });
    } finally { setBusy(false); }
  }

  if (loading && !data) return <section className="adm-card"><Loading /></section>;
  return (
    <div className="adm-stack">
      <section className="adm-card">
        <div className="adm-card-head">
          <div className="adm-card-title">{t('账号详情')}</div>
          <button type="button" className="adm-btn adm-btn-sm" onClick={onClose}>{t('收起')}</button>
        </div>
        <Failure error={error} retry={reload} />
        {data ? (
          <>
            <dl className="adm-kv">
              <dt>{t('邮箱')}</dt><dd>{data.user.email}</dd>
              <dt>{t('账号 ID')}</dt><dd className="adm-mono">{data.user.id}</dd>
              <dt>{t('注册时间')}</dt><dd>{when(data.user.createdAt)}</dd>
              <dt>{t('当前积分')}</dt><dd><strong>{data.user.balance}</strong></dd>
              <dt>{t('状态')}</dt><dd>{data.user.banned
                ? <span className="adm-badge" data-tone="danger">{t('已停用 · {reason}', { reason: data.user.banned.reason })}</span>
                : <span className="adm-badge" data-tone="ok">{t('正常')}</span>}</dd>
              <dt>{t('累计消耗')}</dt><dd>{t('{points} 积分 / {count} 次', { points: data.stats.spendPoints, count: data.stats.spendCount })}</dd>
              <dt>{t('媒体与作品')}</dt><dd>{t('{media} 个对象 · {bytes} · {records} 条作品', { media: data.stats.mediaCount, bytes: bytes(data.stats.mediaBytes), records: data.stats.recordCount })}</dd>
              <dt>{t('第三方绑定')}</dt><dd>{data.oauth.length ? data.oauth.map(item => item.provider).join(t('、')) : t('无')}</dd>
              <dt>{t('邀请人')}</dt><dd>{data.invitedBy ? (data.invitedBy.rewardedAt ? t('{email}（已发放奖励）', { email: data.invitedBy.email }) : t('{email}（待发放）', { email: data.invitedBy.email })) : t('无')}</dd>
            </dl>
            <Feedback message={message} />
            <form className="adm-form" onSubmit={adjust} style={{ marginTop: 16 }}>
              <div className="adm-form-inline">
                <label className="adm-field" style={{ flex: '0 0 130px' }}>
                  <span>{t('调整积分')}</span>
                  <input className="adm-input" type="number" step="1" min="-1000000" max="1000000" required
                    value={delta} onChange={event => setDelta(event.target.value)} placeholder={t('如 100 或 -50')} />
                </label>
                <label className="adm-field" style={{ flex: '1 1 180px' }}>
                  <span>{t('原因（写入审计日志）')}</span>
                  <input className="adm-input" value={note} maxLength={200} required
                    onChange={event => setNote(event.target.value)} placeholder={t('例如：活动补偿 / 违规扣回')} />
                </label>
                <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !delta}>{t('调整')}</button>
              </div>
              <p className="adm-note">{t('扣减不会让余额变成负数；每次调整都会写入积分流水与操作日志。')}</p>
            </form>
            <div className="adm-form-inline" style={{ marginTop: 12 }}>
              {!data.user.banned ? (
                <>
                  <label className="adm-field" style={{ flex: '1 1 220px' }}>
                    <span>{t('停用原因')}</span>
                    <input className="adm-input" value={banReason} maxLength={200}
                      onChange={event => setBanReason(event.target.value)} placeholder={t('例如：批量注册 / 违规内容')} />
                  </label>
                  <button type="button" className="adm-btn adm-btn-danger" disabled={busy} onClick={() => toggleBan(true)}>{t('停用账号')}</button>
                </>
              ) : (
                <button type="button" className="adm-btn" disabled={busy} onClick={() => toggleBan(false)}>{t('恢复账号')}</button>
              )}
            </div>
          </>
        ) : null}
      </section>

      {data ? (
        <section className="adm-card">
          <div className="adm-card-head"><div className="adm-card-title">{t('最近积分流水')}</div></div>
          {data.ledger.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>{t('时间')}</th><th>{t('类型')}</th><th className="num">{t('变动')}</th></tr></thead>
                <tbody>
                  {data.ledger.map(row => (
                    <tr key={`${row.refId}-${row.createdAt}`}>
                      <td className="muted">{when(row.createdAt)}</td>
                      <td>{REASONS[row.reason] || row.reason}</td>
                      <td className="num" style={{ color: row.delta > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {row.delta > 0 ? '+' : ''}{row.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="adm-empty">{t('暂无流水。')}</div>}
        </section>
      ) : null}

      {data?.invites.length ? (
        <section className="adm-card">
          <div className="adm-card-head"><div className="adm-card-title">{t('邀请记录')}</div></div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>{t('被邀请人')}</th><th>{t('邀请码')}</th><th>{t('时间')}</th><th>{t('奖励')}</th></tr></thead>
              <tbody>
                {data.invites.map(row => (
                  <tr key={row.email + row.createdAt}>
                    <td>{row.email || '—'}</td>
                    <td className="adm-mono">{row.code}</td>
                    <td className="muted">{when(row.createdAt)}</td>
                    <td>{row.rewarded
                      ? <span className="adm-badge" data-tone="ok">{t('已发放')}</span>
                      : <span className="adm-badge" data-tone="warn">{t('待首次生成')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------------------------- 邀请 ---------------------------------- */

interface InvitesData {
  invites: { id: string; code: string; createdAt: number; rewardedAt: number | null; inviterEmail: string; inviteeEmail: string }[];
  top: { inviterId: string; email: string; total: number; rewarded: number }[];
  total: number; nextPage: number | null;
}

function InvitesTab() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<InvitesData>(`/api/admin/invites?page=${page}`);
  return (
    <div className="adm-stack">
      <Failure error={error} retry={reload} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <section className="adm-card">
            <div className="adm-card-head">
              <div className="adm-card-title">{t('邀请排行榜')}</div>
              <span className="adm-card-sub">{t('共 {n} 条邀请关系', { n: data.total })}</span>
            </div>
            {data.top.length ? (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>{t('邀请人')}</th><th className="num">{t('邀请人数')}</th><th className="num">{t('已发放奖励')}</th></tr></thead>
                  <tbody>
                    {data.top.map(row => (
                      <tr key={row.inviterId}>
                        <td>{row.email || row.inviterId}</td>
                        <td className="num">{row.total}</td>
                        <td className="num">{row.rewarded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="adm-empty">{t('还没有邀请记录。')}</div>}
          </section>
          <section className="adm-card">
            <div className="adm-card-head"><div className="adm-card-title">{t('邀请明细')}</div></div>
            {data.invites.length ? (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>{t('邀请人')}</th><th>{t('被邀请人')}</th><th>{t('邀请码')}</th><th>{t('时间')}</th><th>{t('状态')}</th></tr></thead>
                  <tbody>
                    {data.invites.map(row => (
                      <tr key={row.id}>
                        <td>{row.inviterEmail || '—'}</td>
                        <td>{row.inviteeEmail || '—'}</td>
                        <td className="adm-mono">{row.code}</td>
                        <td className="muted">{when(row.createdAt)}</td>
                        <td>{row.rewardedAt
                          ? <span className="adm-badge" data-tone="ok">{t('已发放')}</span>
                          : <span className="adm-badge" data-tone="warn">{t('待首次生成')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="adm-empty">{t('还没有邀请记录。')}</div>}
            <div className="adm-pagination">
              <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t('上一页')}</button>
              <span>{t('第 {page} 页 · 共 {n} 条', { page, n: data.total })}</span>
              <button type="button" className="adm-btn adm-btn-sm" disabled={!data.nextPage} onClick={() => setPage(data.nextPage ?? page)}>{t('下一页')}</button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------- 生成与媒体 ------------------------------- */

interface GenerationsData {
  spends: { id: string; email: string; delta: number; refId: string; createdAt: number }[];
  totals: { generations: number; points: number; records: number };
  records: { key: string; email: string; recordId: string; updatedAt: number }[];
  nextPage: number | null;
}

interface MediaData {
  media: { id: string; owner: string; ownerEmail: string; mime: string; size: number; createdAt: number }[];
  total: number; bytes: number; nextPage: number | null;
}

function ContentTab() {
  return (
    <div className="adm-stack">
      <GenerationSection />
      <MediaSection />
    </div>
  );
}

function GenerationSection() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<GenerationsData>(`/api/admin/generations?page=${page}`);
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <div>
          <div className="adm-card-title">{t('生成消耗与作品')}</div>
          <div className="adm-card-sub">{t('仅统计登录账号；游客生成不写入积分账本。')}</div>
        </div>
        {data ? <span className="adm-badge" data-tone="info">
          {t('{gen} 次生成 · {points} 积分 · {records} 条作品', { gen: data.totals.generations, points: data.totals.points, records: data.totals.records })}
        </span> : null}
      </div>
      <Failure error={error} retry={reload} />
      {loading && !data ? <Loading /> : null}
      {data?.spends.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t('时间')}</th><th>{t('账号')}</th><th className="num">{t('消耗')}</th><th>{t('生成编号')}</th></tr></thead>
            <tbody>
              {data.spends.map(row => (
                <tr key={row.id}>
                  <td className="muted">{when(row.createdAt)}</td>
                  <td>{row.email}</td>
                  <td className="num">{-row.delta}</td>
                  <td className="adm-mono muted">{row.refId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="adm-empty">{t('暂无生成消耗记录。')}</div>}
      {data ? (
        <div className="adm-pagination">
          <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t('上一页')}</button>
          <span>{t('第 {page} 页', { page })}</span>
          <button type="button" className="adm-btn adm-btn-sm" disabled={!data.nextPage} onClick={() => setPage(data.nextPage ?? page)}>{t('下一页')}</button>
        </div>
      ) : null}
      {data?.records.length ? (
        <>
          <div className="adm-card-head" style={{ marginTop: 20 }}><div className="adm-card-title">{t('最近作品记录')}</div></div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>{t('账号')}</th><th>{t('作品编号')}</th><th>{t('更新时间')}</th></tr></thead>
              <tbody>
                {data.records.map(row => (
                  <tr key={row.key}>
                    <td>{row.email}</td>
                    <td className="adm-mono">{row.recordId}</td>
                    <td className="muted">{when(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function MediaSection() {
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useLoad<MediaData>(`/api/admin/media?page=${page}&q=${encodeURIComponent(query)}`);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');

  async function remove(id: string) {
    if (!window.confirm(t('删除后对象存储中的文件也会被移除，作品中的引用将无法再打开。确认删除？'))) return;
    setBusy(id); setMessage(null);
    try {
      await api(`/api/admin/media/${id}`, { method: 'DELETE' });
      setMessage({ tone: 'ok', text: t('媒体已删除。') });
      reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('删除失败。') });
    } finally { setBusy(''); }
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <div>
          <div className="adm-card-title">{t('媒体对象')}</div>
          <div className="adm-card-sub">{t('共 {n} 个 · 占用 {size}', { n: data?.total ?? '—', size: bytes(data?.bytes ?? 0) })}</div>
        </div>
        <form className="adm-form-inline" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(input.trim()); }}>
          <input className="adm-input" value={input} onChange={event => setInput(event.target.value)}
            placeholder={t('搜索账号、类型或媒体 ID')} aria-label={t('搜索媒体')} />
          <button type="submit" className="adm-btn adm-btn-sm">{t('搜索')}</button>
        </form>
      </div>
      <Feedback message={message} />
      <Failure error={error} retry={reload} />
      {loading && !data ? <Loading /> : null}
      {data?.media.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t('媒体 ID')}</th><th>{t('归属')}</th><th>{t('类型')}</th><th className="num">{t('大小')}</th><th>{t('时间')}</th><th /></tr></thead>
            <tbody>
              {data.media.map(row => (
                <tr key={row.id}>
                  <td className="adm-mono">{row.id.slice(0, 8)}…</td>
                  <td>{row.ownerEmail || row.owner}</td>
                  <td className="muted">{row.mime}</td>
                  <td className="num">{bytes(row.size)}</td>
                  <td className="muted">{when(row.createdAt)}</td>
                  <td><button type="button" className="adm-btn adm-btn-sm adm-btn-danger"
                    disabled={busy === row.id} onClick={() => remove(row.id)}>{t('删除')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="adm-empty">{t('没有匹配的媒体对象。')}</div>}
      {data ? (
        <div className="adm-pagination">
          <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t('上一页')}</button>
          <span>{t('第 {page} 页', { page })}</span>
          <button type="button" className="adm-btn adm-btn-sm" disabled={!data.nextPage} onClick={() => setPage(data.nextPage ?? page)}>{t('下一页')}</button>
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------- 模型定价 -------------------------------- */

type ModelKindName = 'chat' | 'image' | 'video' | 'music';
interface AdminModel {
  publicId: string; upstreamId: string; alias: string; kind: ModelKindName;
  enabled: boolean; prices: ModelPrices; updatedAt: number;
}
interface ModelsData {
  kinds: ModelKindName[];
  defaults: Record<string, ModelPrices>;
  models: AdminModel[];
}
type ModelDraft = Pick<AdminModel, 'upstreamId' | 'alias' | 'kind' | 'enabled' | 'prices'>;

const KIND_NAMES: Record<string, string> = {
  chat: t('对话'), image: t('图像'), video: t('视频'), music: t('音乐'),
};

function PriceFields({ row, onChange }: {
  row: ModelDraft;
  onChange: (group: string, key: string, value: number) => void;
}) {
  const prices = row.prices as Record<string, Record<string, number>>;
  if (row.kind === 'image' || row.kind === 'video') {
    const tiers = row.kind === 'image' ? ['1K', '2K', '4K'] : ['360p', '720p', '1080p', '4k'];
    const bucket = prices[row.kind] ?? {};
    return (
      <div className="adm-price-grid">
        {tiers.map(tier => (
          <label key={tier}>
            <span>{tier}{row.kind === 'video' ? t(' / 秒') : ''}</span>
            <input className="adm-input" type="number" min={0} max={1000000} step={1} value={bucket[tier] ?? 0}
              aria-label={t('{tier} 价格', { tier })} onChange={event => onChange(row.kind, tier, Number(event.target.value))} />
          </label>
        ))}
      </div>
    );
  }
  const unit = row.kind === 'music' ? 'perMinute' : 'perMessage';
  const bucket = prices[row.kind] ?? {};
  return (
    <label className="adm-price-unit">
      <span>{row.kind === 'music' ? t('每分钟') : t('每条消息')}</span>
      <input className="adm-input" type="number" min={0} max={1000000} step={1} value={bucket[unit] ?? 0}
        aria-label={t('{kind}价格', { kind: row.kind === 'music' ? t('每分钟') : t('每条消息') })}
        onChange={event => onChange(row.kind, unit, Number(event.target.value))} />
    </label>
  );
}

function ModelsTab() {
  const { data, error, loading, reload } = useLoad<ModelsData>('/api/admin/models');
  const [draft, setDraft] = useState<ModelDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [addition, setAddition] = useState({ upstreamId: '', alias: '', kind: 'chat' as ModelKindName });

  useEffect(() => {
    setDraft((data?.models ?? []).map(({ upstreamId, alias, kind, enabled, prices }) => ({ upstreamId, alias, kind, enabled, prices })));
    setDirty(false);
  }, [data]);

  function patch(index: number, update: Partial<ModelDraft>) {
    setDraft(rows => rows.map((row, i) => i === index ? { ...row, ...update } : row));
    setDirty(true);
  }

  function changeKind(index: number, kind: ModelKindName) {
    patch(index, { kind, prices: data?.defaults?.[kind] ?? {} });
  }

  function changePrice(index: number, group: string, key: string, value: number) {
    const row = draft[index];
    if (!row) return;
    const prices = row.prices as Record<string, Record<string, number>>;
    patch(index, {
      prices: {
        ...row.prices,
        [group]: { ...(prices[group] ?? {}), [key]: Math.max(0, Math.min(1000000, Math.trunc(Number.isFinite(value) ? value : 0))) },
      },
    });
  }

  async function save() {
    setBusy('save'); setMessage(null);
    try {
      await api('/api/admin/models', { method: 'PUT', body: JSON.stringify({ models: draft }) });
      setDirty(false);
      setMessage({ tone: 'ok', text: t('模型列表已保存。') });
      reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('保存失败。') });
    } finally { setBusy(''); }
  }

  async function sync() {
    if (dirty && !window.confirm(t('同步会刷新列表，未保存的修改会丢失。继续？'))) return;
    setBusy('sync'); setMessage(null);
    try {
      const result = await api<ModelsData & { sync: { added: number; upstream: number } }>('/api/admin/models', { method: 'POST' });
      setMessage({ tone: 'ok', text: t('已同步 {n} 个上游模型，其中新增 {added} 个。', { n: result.sync.upstream, added: result.sync.added }) });
      reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('同步失败。') });
    } finally { setBusy(''); }
  }

  function add() {
    const upstreamId = addition.upstreamId.trim();
    const alias = addition.alias.trim();
    if (!upstreamId || !alias) { setMessage({ tone: 'error', text: t('请填写上游模型 ID 与别名。') }); return; }
    if (draft.some(row => row.upstreamId === upstreamId)) { setMessage({ tone: 'error', text: t('该模型已在列表中。') }); return; }
    setDraft(rows => [...rows, { upstreamId, alias, kind: addition.kind, enabled: true, prices: data?.defaults?.[addition.kind] ?? {} }]);
    setAddition({ upstreamId: '', alias: '', kind: 'chat' });
    setDirty(true); setMessage(null);
  }

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <div className="adm-card-head">
          <div>
            <div className="adm-card-title">{t('模型定价')}</div>
            <div className="adm-card-sub">{t('从模型网关同步后，可为每个模型单独设置别名与积分价格；用户只会看到别名与价格，上游模型 ID 不会下发到浏览器。')}</div>
          </div>
          <div className="adm-form-inline">
            <button type="button" className="adm-btn" disabled={!!busy} onClick={() => void sync()}>
              {busy === 'sync' ? t('同步中…') : t('同步网关')}
            </button>
            <button type="button" className="adm-btn adm-btn-primary" disabled={!!busy || !dirty} onClick={() => void save()}>
              {busy === 'save' ? t('保存中…') : t('保存修改')}
            </button>
          </div>
        </div>
        <Feedback message={message} />
        <Failure error={error} retry={reload} />
        {loading && !data ? <Loading /> : null}
        {!loading && !draft.length ? (
          <div className="adm-empty">{t('还没有模型目录。点击“同步网关”从上游拉取，或在下方手动添加。')}</div>
        ) : null}
        {draft.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table adm-models">
              <thead><tr><th>{t('启用')}</th><th>{t('别名')}</th><th>{t('类型')}</th><th>{t('积分价格')}</th><th>{t('上游模型 ID')}</th></tr></thead>
              <tbody>
                {draft.map((row, index) => (
                  <tr key={row.upstreamId}>
                    <td>
                      <input type="checkbox" className="adm-check" checked={row.enabled}
                        aria-label={t('启用 {name}', { name: row.alias })}
                        onChange={event => patch(index, { enabled: event.target.checked })} />
                    </td>
                    <td>
                      <input className="adm-input" value={row.alias} maxLength={60} aria-label={t('模型别名')}
                        onChange={event => patch(index, { alias: event.target.value })} />
                    </td>
                    <td>
                      <select className="adm-select" value={row.kind} aria-label={t('模型类型')}
                        onChange={event => changeKind(index, event.target.value as ModelKindName)}>
                        {(data?.kinds ?? []).map(kind => <option key={kind} value={kind}>{KIND_NAMES[kind] ?? kind}</option>)}
                      </select>
                    </td>
                    <td><PriceFields row={row} onChange={(group, key, value) => changePrice(index, group, key, value)} /></td>
                    <td className="adm-mono muted">{row.upstreamId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="adm-card-head" style={{ marginTop: 20 }}><div className="adm-card-title">{t('手动添加模型')}</div></div>
        <form className="adm-form-inline" onSubmit={event => { event.preventDefault(); add(); }}>
          <input className="adm-input" value={addition.upstreamId} maxLength={200} placeholder={t('上游模型 ID')}
            aria-label={t('上游模型 ID')} onChange={event => setAddition(current => ({ ...current, upstreamId: event.target.value }))} />
          <input className="adm-input" value={addition.alias} maxLength={60} placeholder={t('显示别名')}
            aria-label={t('显示别名')} onChange={event => setAddition(current => ({ ...current, alias: event.target.value }))} />
          <select className="adm-select" value={addition.kind} aria-label={t('模型类型')}
            onChange={event => setAddition(current => ({ ...current, kind: event.target.value as ModelKindName }))}>
            {(data?.kinds ?? ['chat', 'image', 'video', 'music'] as ModelKindName[]).map(kind => <option key={kind} value={kind}>{KIND_NAMES[kind] ?? kind}</option>)}
          </select>
          <button type="submit" className="adm-btn">{t('添加')}</button>
        </form>
        <p className="adm-note">{t('新增模型默认沿用当前全局档位价；保存后立即生效。停用的模型不再出现在用户端，但仍保留价格配置。')}</p>
      </section>
    </div>
  );
}

/* --------------------------------- 系统设置 -------------------------------- */

interface SettingItem {
  key: string; group: string; label: string; help?: string;
  type: 'int' | 'bool' | 'text' | 'csv' | 'url' | 'enum' | 'secret';
  default: string; min?: number; max?: number; choices?: string[];
  secret?: boolean; restart?: boolean;
  value?: string; configured: boolean; source: 'database' | 'env' | 'default';
}
interface SettingsData { groups: string[]; settings: SettingItem[] }

const SOURCE_LABEL = { database: t('后台配置'), env: '.env', default: t('默认值') } as const;

function SettingsTab() {
  const { data, error, loading, reload } = useLoad<SettingsData>('/api/admin/settings');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => { setDraft({}); setTouched(new Set()); }, [data]);

  function change(key: string, value: string) {
    setDraft(current => ({ ...current, [key]: value }));
    setTouched(current => new Set(current).add(key));
  }

  async function save() {
    if (!data) return;
    const values: Record<string, string> = {};
    for (const key of touched) {
      const def = data.settings.find(item => item.key === key);
      if (!def) continue;
      const value = draft[key] ?? '';
      if (def.secret && !value.trim()) continue;
      values[key] = value;
    }
    if (!Object.keys(values).length) { setMessage({ tone: 'error', text: t('没有需要保存的修改。') }); return; }
    setBusy(true); setMessage(null);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
      setMessage({ tone: 'ok', text: t('已保存 {n} 项配置，立即生效。', { n: Object.keys(values).length }) });
      setTouched(new Set()); setDraft({});
      reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('保存失败。') });
    } finally { setBusy(false); }
  }

  async function reset(key: string) {
    if (!window.confirm(t('恢复为 .env 或内置默认值？'))) return;
    setBusy(true); setMessage(null);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ reset: [key] }) });
      setMessage({ tone: 'ok', text: t('已恢复默认配置。') });
      setTouched(current => { const next = new Set(current); next.delete(key); return next; });
      setDraft(current => { const next = { ...current }; delete next[key]; return next; });
      reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('恢复失败。') });
    } finally { setBusy(false); }
  }

  if (loading && !data) return <Loading />;
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <div>
          <div className="adm-card-title">{t('系统设置')}</div>
          <div className="adm-card-sub">{t('这里修改的配置保存在数据库中，立即生效；.env 中的同名变量作为默认值。')}</div>
        </div>
        <span className="adm-badge">{t('{n} 项待保存', { n: touched.size })}</span>
      </div>
      <Feedback message={message} />
      <Failure error={error} retry={reload} />
      <p className="adm-note" style={{ marginBottom: 8 }}>
        {t('端口、数据库地址、首次管理员白名单等启动变量仍由 ')}<span className="adm-mono">.env</span>{t(' 控制；密钥类配置只显示是否已设置，留空表示保持原值。')}
      </p>
      {data ? data.groups.map(group => {
        const items = data.settings.filter(item => item.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="adm-setting-group">
            <h3>{t(group)}</h3>
            {items.map(item => (
              <SettingRow key={item.key} item={item} value={draft[item.key]} touched={touched.has(item.key)}
                onChange={value => change(item.key, value)} onReset={() => reset(item.key)} busy={busy} />
            ))}
          </div>
        );
      }) : null}
      <div className="adm-settings-bar">
        <span className="adm-note">{t('保存后本进程立即生效；多实例部署最多 10 秒同步。')}</span>
        <div className="adm-form-inline">
          <button type="button" className="adm-btn" disabled={busy || !touched.size}
            onClick={() => { setDraft({}); setTouched(new Set()); setMessage(null); }}>{t('放弃修改')}</button>
          <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !touched.size} onClick={save}>
            {busy ? t('保存中…') : t('保存修改')}
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingRow({ item, value, touched, onChange, onReset, busy }: {
  item: SettingItem; value: string | undefined; touched: boolean;
  onChange: (value: string) => void; onReset: () => void; busy: boolean;
}) {
  const current = value ?? item.value ?? item.default;
  const secretPlaceholder = item.configured ? t('已配置，留空表示不修改') : t('未配置');
  return (
    <div className="adm-setting">
      <div>
        <div className="adm-setting-label">
          {t(item.label)}
          <span className="adm-badge" data-tone={item.source === 'database' ? 'info' : undefined}>
            {SOURCE_LABEL[item.source]}
          </span>
          {item.source === 'database'
            ? <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={onReset}>{t('恢复默认')}</button>
            : null}
          {touched ? <span className="adm-badge" data-tone="warn">{t('未保存')}</span> : null}
        </div>
        <div className="adm-setting-help">{t(item.help || item.key)}{item.restart ? t(' · 修改后需要重新构建前端') : ''}</div>
      </div>
      <div className="adm-setting-control">
        {item.type === 'bool' ? (
          <select className="adm-select" value={current === 'true' ? 'true' : 'false'} onChange={event => onChange(event.target.value)}>
            <option value="true">{t('开启')}</option><option value="false">{tIn('admin', '关闭')}</option>
          </select>
        ) : item.type === 'enum' ? (
          <select className="adm-select" value={current} onChange={event => onChange(event.target.value)}>
            {(item.choices ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        ) : item.type === 'secret' ? (
          <input className="adm-input" type="password" autoComplete="new-password" placeholder={secretPlaceholder}
            value={value ?? ''} onChange={event => onChange(event.target.value)} />
        ) : item.type === 'int' ? (
          <input className="adm-input" type="number" min={item.min} max={item.max} value={current}
            onChange={event => onChange(event.target.value)} />
        ) : item.key === 'AI_SYSTEM_PROMPT' ? (
          <textarea className="adm-textarea" value={current} maxLength={item.max}
            onChange={event => onChange(event.target.value)} />
        ) : (
          <input className="adm-input" value={current} maxLength={item.max}
            onChange={event => onChange(event.target.value)} />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- 操作日志 -------------------------------- */

interface LogsData {
  logs: { id: string; adminEmail: string; action: string; target: string; detail: string; ip: string; createdAt: number }[];
  total: number; nextPage: number | null;
}

const ACTIONS: Record<string, string> = {
  'points.adjust': t('调整积分'), 'user.ban': t('停用账号'), 'user.unban': t('恢复账号'),
  'settings.update': t('修改设置'), 'media.delete': t('删除媒体'),
  'models.update': t('修改模型'), 'models.sync': t('同步模型'),
};

function LogsTab() {
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useLoad<LogsData>(`/api/admin/logs?page=${page}&q=${encodeURIComponent(query)}`);
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <div className="adm-card-title">{t('操作日志')}</div>
        <form className="adm-form-inline" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(input.trim()); }}>
          <input className="adm-input" value={input} onChange={event => setInput(event.target.value)}
            placeholder={t('搜索操作、管理员或目标')} aria-label={t('搜索日志')} />
          <button type="submit" className="adm-btn adm-btn-sm">{t('搜索')}</button>
        </form>
      </div>
      <Failure error={error} retry={reload} />
      {loading && !data ? <Loading /> : null}
      {data?.logs.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t('时间')}</th><th>{t('管理员')}</th><th>{t('操作')}</th><th>{t('目标')}</th><th>{t('详情')}</th><th>IP</th></tr></thead>
            <tbody>
              {data.logs.map(row => (
                <tr key={row.id}>
                  <td className="muted">{when(row.createdAt)}</td>
                  <td>{row.adminEmail}</td>
                  <td>{ACTIONS[row.action] || row.action}</td>
                  <td className="adm-mono muted">{row.target}</td>
                  <td className="muted" style={{ maxWidth: 280, wordBreak: 'break-all' }}>{row.detail}</td>
                  <td className="adm-mono muted">{row.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="adm-empty">{t('暂无操作日志。')}</div>}
      <div className="adm-pagination">
        <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>{t('上一页')}</button>
        <span>{t('第 {page} 页 · 共 {n} 条', { page, n: data?.total ?? '—' })}</span>
        <button type="button" className="adm-btn adm-btn-sm" disabled={!data?.nextPage} onClick={() => setPage(data?.nextPage ?? page)}>{t('下一页')}</button>
      </div>
    </section>
  );
}
