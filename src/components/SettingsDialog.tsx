import { useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { Settings } from '../lib/types';
import Dialog from './ui/Dialog';
import BrandLogoSvg from './svg/BrandLogoSvg';

export default function SettingsDialog({ initial, loading, onClose, onSave, onRefresh, cloudStorage = false }: {
  cloudStorage?: boolean; initial: Settings; loading: boolean;
  onClose: () => void; onSave: (settings: Settings) => void; onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  return <Dialog labelledBy="settings-title" onClose={onClose} className="settings-modal"><div className="settings-dialog">
    <div className="modal-heading"><div className="settings-heading-brand"><BrandLogoSvg size={44} /><h2 id="settings-title">创作偏好</h2></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><X size={20} /></button></div>
    <div className="settings-scroll">
      <div className="settings-section"><h3>创作服务</h3><p className="muted">连接由服务端统一管理，无需在浏览器配置。</p><button className="secondary-button" disabled={loading} onClick={() => void onRefresh()}>{loading ? '正在检查…' : '检查连接'}</button></div>
      <div className="settings-section"><h3>对话偏好</h3><label className="field-label range-label">创造性 <span>{draft.temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={draft.temperature} onChange={e => setDraft({ ...draft, temperature: Number(e.target.value) })} /></label></div>
      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>留住每一步灵感</strong><p>会话、作品与关联歌词保存在{cloudStorage ? '你的账号' : '当前浏览器'}，可随时下载。</p></div></div>
    </div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onSave(draft)}><Check size={16} />保存设置</button></div>
  </div></Dialog>;
}
