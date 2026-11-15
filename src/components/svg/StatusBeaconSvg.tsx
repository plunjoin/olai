import { LoaderCircle } from 'lucide-react';
import { t } from '../../lib/i18n';
export default function StatusBeaconSvg({ connected, loading = false }: { connected: boolean; loading?: boolean }) {
  return <span className={`status-beacon-container ${connected ? 'is-connected' : ''}`} role="status" title={connected ? t('已连接创作服务') : t('创作服务尚未连接，请检查服务状态')}>
    {loading ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <span className="service-dot" />}
    <span className="status-beacon-text">{loading ? t('正在连接…') : connected ? t('创作服务已连接') : t('等待连接')}</span>
  </span>;
}
