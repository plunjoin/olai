import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, ShieldCheck, X } from 'lucide-react';
import type { Model, Settings } from '../lib/types';
import StatusBeaconSvg from './svg/StatusBeaconSvg';
import Dialog from './ui/Dialog';
import BrandLogoSvg from './svg/BrandLogoSvg';

export default function SettingsDialog({ initial, serverKey, models, loadingModels, onClose, onSave, onRefresh }: {
  initial: Settings; serverKey: boolean; models: Model[]; loadingModels: boolean;
  onClose: () => void; onSave: (settings: Settings) => void; onRefresh: (key: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(s => ({ ...s, [key]: value }));
  return <Dialog labelledBy="settings-title" onClose={onClose} className="settings-modal"><div className="settings-dialog">
    <div className="modal-heading"><div className="settings-heading-brand"><BrandLogoSvg size={44} /><div><span className="eyebrow">YOUR OLAI SPACE</span><h2 id="settings-title">连接与创作偏好</h2></div></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><X size={20} /></button></div>
    <div className="settings-scroll">
      <div className="settings-section"><div className="section-title-row"><h3><KeyRound size={17} />连接创作服务</h3><StatusBeaconSvg connected={models.length > 0} loading={loadingModels} /></div><p className="muted">连接后，即可开始对话和创作。</p>
        <label className="field-label" htmlFor="api-key">API Key {serverKey && <span className="connected-inline">服务端已提供密钥</span>}</label><div className="password-field"><input id="api-key" type={showKey ? 'text' : 'password'} value={draft.key} placeholder={serverKey ? '可留空，使用服务端连接' : '填写你的服务密钥'} autoComplete="off" spellCheck={false} onChange={e => update('key', e.target.value)} /><button className="icon-button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        <label className="checkbox-label"><input type="checkbox" checked={draft.rememberKey} onChange={e => update('rememberKey', e.target.checked)} />在此浏览器记住密钥</label><p className="field-hint">默认保留在当前浏览器会话，勾选后会在此设备持久保存。</p>
        <button className="secondary-button" disabled={loadingModels} onClick={() => void onRefresh(draft.key)}>{loadingModels ? '正在连接…' : '检查连接'}</button>
      </div>
      <div className="settings-section"><h3>对话偏好</h3><label className="field-label">希望助手如何陪你对话<textarea rows={4} maxLength={10000} value={draft.systemPrompt} onChange={e => update('systemPrompt', e.target.value)} /></label><label className="field-label range-label">创造性 <span>{draft.temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={draft.temperature} onChange={e => update('temperature', Number(e.target.value))} /></label></div>
      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>留住每一步灵感</strong><p>会话、作品与关联歌词保存在当前浏览器，可随时下载。</p></div></div>
    </div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onSave({ ...draft, key: draft.key.trim() })}><Check size={16} />保存设置</button></div>
  </div></Dialog>;
}
