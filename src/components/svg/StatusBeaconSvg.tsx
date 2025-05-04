import { LoaderCircle } from 'lucide-react';
export default function StatusBeaconSvg({ connected, loading = false, modelCount = 0 }: { connected: boolean; loading?: boolean; modelCount?: number }) {
  return <span className={`status-beacon-container ${connected ? 'is-connected' : ''}`} role="status" title={connected ? `已连接创作服务 · ${modelCount} 个可用模型` : '在设置中连接你的创作服务'}>
    {loading ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <span className="service-dot" />}
    <span className="status-beacon-text">{loading ? '正在连接…' : connected ? '创作服务已连接' : '等待连接'}</span>
  </span>;
}
