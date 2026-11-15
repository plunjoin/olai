import { useState } from 'react';
import { Check, Languages, ShieldCheck, X } from 'lucide-react';
import type { Settings } from '../lib/types';
import { getLocalePreference, LOCALES, matchLocale, setLocalePreference, t, type LocalePreference } from '../lib/i18n';
import Dialog from './ui/Dialog';
import BrandLogoSvg from './svg/BrandLogoSvg';

export default function SettingsDialog({ initial, loading, onClose, onSave, onRefresh, cloudStorage = false }: {
  cloudStorage?: boolean; initial: Settings; loading: boolean;
  onClose: () => void; onSave: (settings: Settings) => void; onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [preference, setPreference] = useState<LocalePreference>(() => getLocalePreference());
  const deviceTags = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? [...navigator.languages] : [navigator.language]);
  const deviceLabel = LOCALES.find(item => item.code === matchLocale(deviceTags))?.label ?? '';
  const options: { value: LocalePreference; label: string }[] = [
    { value: 'auto', label: t('跟随设备（{language}）', { language: deviceLabel }) },
    ...LOCALES.map(item => ({ value: item.code as LocalePreference, label: item.label })),
  ];
  return <Dialog labelledBy="settings-title" onClose={onClose} className="settings-modal"><div className="settings-dialog">
    <div className="modal-heading"><div className="settings-heading-brand"><BrandLogoSvg size={44} /><h2 id="settings-title">{t('创作偏好')}</h2></div><button className="icon-button" aria-label={t('关闭设置')} onClick={onClose}><X size={20} /></button></div>
    <div className="settings-scroll">
      <div className="settings-section"><h3>{t('创作服务')}</h3><p className="muted">{t('连接由服务端统一管理，无需在浏览器配置。')}</p><button className="secondary-button" disabled={loading} onClick={() => void onRefresh()}>{loading ? t('正在检查…') : t('检查连接')}</button></div>
      <div className="settings-section"><h3>{t('对话偏好')}</h3><label className="field-label range-label">{t('创造性')} <span>{draft.temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={draft.temperature} onChange={e => setDraft({ ...draft, temperature: Number(e.target.value) })} /></label></div>
      <div className="settings-section">
        <h3><Languages size={16} />{t('语言')}</h3>
        <p className="muted">{t('默认跟随设备语言，也可以固定为某一种。')}</p>
        <div className="language-options" role="radiogroup" aria-label={t('语言')}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preference === option.value}
              className={`language-option ${preference === option.value ? 'is-selected' : ''}`}
              onClick={() => { setPreference(option.value); setLocalePreference(option.value); }}
            >
              <span>{option.label}</span>
              {preference === option.value && <Check size={15} />}
            </button>
          ))}
        </div>
      </div>
      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>{t('留住每一步灵感')}</strong><p>{t('会话、作品与关联歌词保存在{target}，可随时下载。', { target: cloudStorage ? t('你的账号') : t('当前浏览器') })}</p></div></div>
    </div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>{t('取消')}</button><button className="primary-button" onClick={() => onSave(draft)}><Check size={16} />{t('保存设置')}</button></div>
  </div></Dialog>;
}
