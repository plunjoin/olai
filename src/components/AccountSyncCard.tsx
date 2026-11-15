import { CloudUpload, RefreshCw } from 'lucide-react';
import { t } from '../lib/i18n';

/** 账号中心的本地数据同步卡片；单独抽出来便于静态渲染测试。 */
export default function AccountSyncCard({ syncing, note, failures, onSync }: { syncing: boolean; note: string; failures: string[]; onSync: () => void }) {
  return <section className="account-card">
    <div className="account-card-head"><h2>{t('本地数据')}</h2><span role={syncing ? 'status' : undefined}>{syncing ? t('正在同步…') : ''}</span></div>
    <p className="account-note">{t('游客会话与作品会同步到当前账号，未完成的内容仍保留在本地。聊天记录不会公开。')}</p>
    <div className="account-sync-actions">
      <button type="button" className="secondary-button" disabled={syncing} aria-busy={syncing} onClick={onSync}>
        {syncing ? <RefreshCw size={15} className="auth-spin" /> : <CloudUpload size={15} />}
        {syncing ? t('正在同步…') : t('同步本地数据')}
      </button>
    </div>
    {note && <p className="account-status" role="status">{note}</p>}
    {failures.length > 0 && <div className="account-failures" role="status">{failures.map((message, index) => <p key={index}>{t(message)}</p>)}</div>}
  </section>;
}
