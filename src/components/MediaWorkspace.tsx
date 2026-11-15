import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, LoaderCircle, Plus, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import type { Asset, ImageEngineMode, MediaKind, PublicModel, SongDraft, SongSection } from '../lib/types';
import { t } from '../lib/i18n';
import { modelPriceLabel } from '../lib/modelPrices';
import { newSong, SECTION_LABELS, SECTION_TYPES } from '../lib/music';
import { IMAGE_RATIOS, normalizeRatio } from '../lib/generation';
import type { VideoEngineMode } from '../lib/video';
import AssetCard from './AssetCard';
import Companion from './Companion';
import CreationParameters from './ui/CreationParameters';

export type MediaComposerState = { locked: boolean; hasInput: boolean; composingSong: boolean };
export type MediaWorkspaceHandle = { create: () => void };
export interface MediaWorkspaceProps {
  kind: MediaKind; initialPrompt: string; assets: Asset[]; busy: boolean;
  onCompose: (prompt: string, style: string, instrumental: boolean) => Promise<SongDraft>;
  onGenerate: (prompt: string, options: Record<string, string | number>) => void;
  onDelete: (id: string) => void; onRetry: (asset: Asset) => void; onDownload: (asset: Asset) => void;
  embedded?: boolean; controller?: Ref<MediaWorkspaceHandle>; onComposerStateChange?: (state: MediaComposerState) => void;
  panelHost?: HTMLElement | null;
  imageEngineMode?: ImageEngineMode;
  videoEngineMode?: VideoEngineMode;
  onPromptSuggestion?: (prompt: string) => void;
  editRequest?: { asset: Asset; token: string };
  onEdit?: (asset: Asset) => void;
  onAlignLyrics?: (asset: Asset) => void;
  aligningIds?: string[];
  onDownloadCover?: (asset: Asset) => void;
  onRetryCover?: (asset: Asset) => void;
  parameterRequest?: { token: string; options: Record<string, string | number> } | null;
  models?: PublicModel[];
  modelId?: string;
  onModelChange?: (id: string) => void;
}

export default function MediaWorkspace({ kind, initialPrompt, assets, busy, onCompose, onGenerate, onDelete, onRetry, onDownload, embedded = false, controller, onComposerStateChange, panelHost, imageEngineMode, videoEngineMode = 'chat', onPromptSuggestion, editRequest, onEdit, onAlignLyrics, aligningIds, onDownloadCover, onRetryCover, parameterRequest, models = [], modelId = '', onModelChange }: MediaWorkspaceProps) {
  const [localPrompt, setPrompt] = useState(initialPrompt);
  const prompt = embedded ? initialPrompt : localPrompt;
  const [ratio, setRatio] = useState(kind === 'video' ? '16:9' : 'auto');
  const [customRatio, setCustomRatio] = useState('');
  const [quality, setQuality] = useState(kind === 'image' ? '1K' : '720p');
  const [thinking, setThinking] = useState(kind === 'video' ? 'high' : 'medium');
  const [duration, setDuration] = useState(4);
  const minimumDuration = videoEngineMode === 'task' ? 4 : 3;
  const maximumDuration = videoEngineMode === 'task' ? 8 : 10;
  const [style, setStyle] = useState('');
  const [mode, setMode] = useState<'composer' | 'inspiration'>('inspiration');
  const [song, setSong] = useState<SongDraft>(newSong);
  const [generateCover, setGenerateCover] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(initialPrompt.trim());
  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (kind !== 'music' || !editRequest?.asset.song) return;
    const source = editRequest.asset;
    setSong(structuredClone(source.song!));
    setStyle('');
    setGenerateCover(source.options.generate_cover === 1);
    setDraftPrompt(typeof source.options.inspiration === 'string' ? source.options.inspiration.trim() : '');
    setMode('composer');
    setError('');
  }, [editRequest?.token, kind]);
  useEffect(() => {
    const options = parameterRequest?.options;
    if (!options || kind === 'music') return;
    const nextRatio = typeof options.aspect_ratio === 'string' ? options.aspect_ratio : '';
    if (nextRatio) {
      if (kind === 'image' && !IMAGE_RATIOS.includes(nextRatio)) { setCustomRatio(nextRatio); setRatio('custom'); }
      else if (kind === 'image' || ['16:9', '9:16'].includes(nextRatio)) setRatio(nextRatio);
    }
    const nextQuality = String(kind === 'image' ? options.image_size : options.resolution || '');
    if ((kind === 'image' ? ['1K', '2K', '4K'] : ['720p', '1080p', '4K']).includes(nextQuality)) setQuality(nextQuality);
    if (kind === 'video' && typeof options.duration === 'number' && Number.isFinite(options.duration)) {
      setDuration(Math.min(maximumDuration, Math.max(minimumDuration, Math.round(options.duration))));
    }
  }, [parameterRequest?.token, kind]);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error && embedded) errorNotice.current?.scrollIntoView({ block: 'nearest' }); }, [error, embedded]);
  const name = kind === 'image' ? t('图像') : kind === 'video' ? t('视频') : t('音乐');
  const locked = busy || organizing;
  const selectedModel = modelId ? models.find(model => model.id === modelId) : undefined;
  const styles = kind === 'music' ? [t('自由创作'), t('流行'), 'Lo-fi', t('电子'), t('爵士'), t('氛围音乐')] : kind === 'image' ? [t('自由创作'), t('摄影'), t('3D 艺术'), t('插画'), t('电影感')] : [t('自由创作'), t('电影感'), t('自然风光'), t('产品展示'), t('动画')];
  const updateSection = (id: string, patch: Partial<SongSection>) => setSong(s => ({ ...s, sections: s.sections.map(section => section.id === id ? { ...section, ...patch } : section) }));
  const move = (index: number, offset: number) => setSong(s => { const sections = [...s.sections]; [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]]; return { ...s, sections }; });
  const organize = async (openEditor = true) => {
    setError(''); setOrganizing(true);
    try { const draft = await onCompose(prompt.trim(), style, song.instrumental); setSong(draft); setDraftPrompt(prompt.trim()); if (openEditor) setMode('composer'); return draft; }
    catch (e) { setError(e instanceof Error ? e.message : t('歌曲整理失败，请重试。')); return undefined; }
    finally { setOrganizing(false); }
  };
  const create = async () => {
    if (locked || !hasInput) return;
    setError('');
    try {
      if (kind === 'music') {
        const draft = useDraft ? song : await organize(false);
        if (!draft) return;
        if (!draft.sections.length || !draft.sections.some(s => s.direction.trim() || (!draft.instrumental && s.lyrics.trim()))) throw new Error(t('请为至少一个段落填写歌词或编曲描述。'));
        const finalSong = { ...draft, style: [draft.style, style].filter(Boolean).join('，') };
        onGenerate(prompt.trim() || finalSong.title || finalSong.style || t('原创音乐'), { song: JSON.stringify(finalSong), music_mode: useDraft ? 'composer' : 'inspiration', inspiration: prompt.trim(), generate_cover: generateCover ? 1 : 0 });
      } else {
        const aspect_ratio = normalizeRatio(ratio === 'custom' ? customRatio : ratio);
        onGenerate(`${prompt.trim()}${style ? `\n风格：${style}` : ''}`, kind === 'image' ? { aspect_ratio, image_size: quality, reasoning_effort: thinking, n: 1 } : { aspect_ratio, seconds: duration, resolution: quality, reasoning_effort: thinking });
      }
    } catch (e) { setError(e instanceof Error ? e.message : t('请检查创作内容。')); }
  };
  const useDraft = mode === 'composer' && prompt.trim() === draftPrompt;
  const hasInput = kind === 'music' && useDraft ? song.sections.some(s => s.direction.trim() || (!song.instrumental && s.lyrics.trim())) : !!prompt.trim();
  useImperativeHandle(controller, () => ({ create: () => void create() }));
  useEffect(() => { onComposerStateChange?.({ locked, hasInput, composingSong: kind === 'music' && useDraft }); }, [locked, hasInput, useDraft, kind, onComposerStateChange]);
  return <div className={`media-workspace ${kind}-workspace ${embedded ? 'embedded-creation' : ''}`}>
    <div className="page-intro"><div><span className="eyebrow">A LITTLE IDEA. A NEW POSSIBILITY.</span><h1>{t('{mode}创作', { mode: name })}<span className="heading-spark">✦</span></h1><p>{kind === 'music' ? t('从一个念头，到一首属于你的歌。') : kind === 'image' ? t('把脑海里的色彩，变成眼前的惊喜。') : t('让想象开始流动，让故事有了画面。')}</p></div><span className="workspace-step">{t('01 描述灵感')} <span>→</span> {t('02 收获作品')}</span></div>
    <div className="generation-layout">
      <CreationParameters embedded={embedded} host={panelHost} summary={kind === 'music' ? t('{mode} · {vocal}{style}', { mode: mode === 'composer' ? t('段落编辑') : t('灵感模式'), vocal: song.instrumental ? t('纯音乐') : t('人声歌曲'), style: style ? ` · ${style}` : '' }) : t('{ratio} · {quality}{duration}', { ratio: ratio === 'auto' ? t('自动比例') : ratio === 'custom' ? customRatio || t('自定义比例') : ratio, quality, duration: kind === 'video' ? ` · ${t('{n} 秒', { n: duration })}` : '' })}>
        <fieldset className="creation-fields" disabled={locked}>
          {models.length > 0 && <>
            <label className="field-label">{t('生成模型')}
              <select aria-label={t('选择生成模型')} value={modelId} onChange={event => onModelChange?.(event.target.value)}>
                <option value="">{t('默认模型')}</option>
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
            {selectedModel ? <p className="field-hint">{modelPriceLabel(selectedModel)}</p> : null}
          </>}
          {kind === 'music' && <>
            <div className="music-mode-tabs" role="tablist" aria-label={t('音乐创作模式')}><button role="tab" aria-selected={mode === 'inspiration'} className={mode === 'inspiration' ? 'selected' : ''} onClick={() => setMode('inspiration')}><Sparkles size={16} />{t('灵感模式')}</button><button role="tab" aria-selected={mode === 'composer'} className={mode === 'composer' ? 'selected' : ''} onClick={() => { setDraftPrompt(prompt.trim()); setMode('composer'); }}><WandSparkles size={16} />Composer</button></div>
            <p className="field-hint mode-description">{mode === 'inspiration' ? t('写下故事、心情或几句歌词，自动整理为完整歌曲段落。') : useDraft ? t('编辑下方段落后直接生成；更换输入框中的灵感会重新整理歌曲。') : t('灵感已修改，下次生成会按新描述重新整理歌曲。')}</p>
          </>}
          {!embedded && (kind !== 'music' || mode === 'inspiration') && <><div className="panel-title"><span><WandSparkles size={17} />{t('描述你的灵感')}</span><span className="tiny-label">YOUR IDEA</span></div><textarea className="prompt-input" aria-label={t('{mode}描述', { mode: name })} placeholder={kind === 'music' ? t('写一首关于夏天与重逢的歌。轻快的独立流行，温柔女声，副歌让人想跟着唱…') : kind === 'image' ? t('明亮的橙色花朵、蓝色天空，阳光穿过透明玻璃，细腻的摄影质感…') : t('镜头缓缓穿过花海，阳光洒在随风摇曳的花瓣上，轻盈而梦幻…')} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000} /><div className="prompt-counter">{prompt.length} / 10000</div></>}
          {kind === 'music' && <label className="checkbox-label"><input type="checkbox" checked={song.instrumental} onChange={e => setSong(s => ({ ...s, instrumental: e.target.checked }))} />{t('纯音乐 · 无人声')}</label>}
          {kind === 'music' && <><label className="checkbox-label"><input type="checkbox" checked={generateCover} onChange={e => setGenerateCover(e.target.checked)} />{t('生成封面')}</label><p className="field-hint">{t('根据歌曲主题与风格绘制封面，和音乐一起保存。')}</p></>}
          {kind === 'music' && mode === 'composer' && <div className="song-composer">
            <label className="field-label">{t('歌曲名称')}<input value={song.title} maxLength={100} placeholder={t('给这首歌起个名字')} onChange={e => setSong(s => ({ ...s, title: e.target.value }))} /></label>
            <label className="field-label">{t('整体音乐方向')}<textarea rows={2} value={song.style} maxLength={2000} placeholder={t('节奏、乐器、情绪、人声…')} onChange={e => setSong(s => ({ ...s, style: e.target.value }))} /></label>
            <div className="section-sequence" aria-label={t('歌曲段落顺序')}>{song.sections.map((s, i) => <span key={s.id}>{i + 1}. {s.type}</span>)}</div>
            {song.sections.map((s, i) => <div className={`song-section section-${s.type}`} key={s.id}>
              <div className="song-section-header"><span className="section-number">{String(i + 1).padStart(2, '0')}</span><select aria-label={t('第 {n} 段类型', { n: i + 1 })} value={s.type} onChange={e => updateSection(s.id, { type: e.target.value as SongSection['type'] })}>{SECTION_TYPES.map(t => <option key={t} value={t}>{t} · {SECTION_LABELS[t]}</option>)}</select><div className="section-actions"><button className="icon-button" aria-label={t('上移第 {n} 段', { n: i + 1 })} disabled={locked || i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button className="icon-button" aria-label={t('下移第 {n} 段', { n: i + 1 })} disabled={locked || i === song.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><button className="icon-button" aria-label={t('删除第 {n} 段', { n: i + 1 })} disabled={locked || song.sections.length === 1} onClick={() => setSong(d => ({ ...d, sections: d.sections.filter(x => x.id !== s.id) }))}><Trash2 size={14} /></button></div></div>
              <input aria-label={t('第 {n} 段编曲', { n: i + 1 })} placeholder={t('编曲方向，如：钢琴渐入，节奏逐渐加强')} value={s.direction} maxLength={2000} onChange={e => updateSection(s.id, { direction: e.target.value })} />
              {!song.instrumental && <textarea aria-label={t('第 {n} 段歌词', { n: i + 1 })} rows={3} placeholder={t('写下这一段的歌词…')} value={s.lyrics} maxLength={6000} onChange={e => updateSection(s.id, { lyrics: e.target.value })} />}
            </div>)}
            <button className="secondary-button add-section" disabled={locked || song.sections.length >= 30} onClick={() => setSong(s => ({ ...s, sections: [...s.sections, { id: crypto.randomUUID(), type: 'verse', direction: '', lyrics: '' }] }))}><Plus size={16} />{t('添加段落')}</button>
          </div>}
          <label className="field-label">{t('创作风格')}</label><div className="style-options">{styles.map((s, i) => <button key={s} className={style === (i ? s : '') ? 'selected' : ''} onClick={() => setStyle(i ? s : '')}>{s}</button>)}</div>
          {kind !== 'music' && <>
            <div className="form-divider" />
            {kind === 'image' ? <><label className="field-label">{t('画面比例')}</label><div className="aspect-options">{[...IMAGE_RATIOS, 'custom'].map(r => <button key={r} className={ratio === r ? 'selected' : ''} onClick={() => setRatio(r)}>{r === 'auto' ? t('Auto · 自动') : r === 'custom' ? t('自定义') : r}</button>)}</div>{ratio === 'custom' && <label className="field-label">{t('自定义比例')}<input aria-label={t('自定义图片比例')} placeholder={t('例如 2.35:1')} value={customRatio} onChange={e => setCustomRatio(e.target.value)} /></label>}<p className="field-hint">{t('自动模式会根据你的描述决定画面构图。')}</p></> : null}
            <div className="settings-grid">
              {kind === 'video' && <><label className="field-label video-duration"><span className="video-duration-heading">{t('视频时长')}<output>{t('{n} 秒', { n: duration })}</output></span><input type="range" aria-label={t('视频时长')} aria-valuetext={t('{n} 秒', { n: duration })} min={minimumDuration} max={maximumDuration} step={1} value={duration} onChange={e => setDuration(Number(e.target.value))} /><span className="video-duration-limits" aria-hidden="true"><span>{t('{n} 秒', { n: minimumDuration })}</span><span>{t('{n} 秒', { n: maximumDuration })}</span></span></label><label className="field-label">{t('画面比例')}<select aria-label={t('画面比例')} value={ratio} onChange={e => setRatio(e.target.value)}><option value="16:9">{t('16:9 · 横屏')}</option><option value="9:16">{t('9:16 · 竖屏')}</option></select></label></>}
              <label className="field-label">{kind === 'image' ? t('目标分辨率') : t('画质')}<select aria-label={t('画质')} value={quality} onChange={e => setQuality(e.target.value)}>{(kind === 'image' ? ['1K','2K','4K'] : ['720p','1080p','4K']).map(q => <option key={q}>{q}</option>)}</select></label>
              <label className="field-label">{t('联想等级')}<select aria-label={t('联想等级')} value={thinking} onChange={e => setThinking(e.target.value)}><option value="minimal">{t('Minimal · 轻度')}</option><option value="medium">{t('Medium · 适中')}</option><option value="high">{t('High · 丰富')}</option></select></label>
            </div>
            {kind === 'image' && <p className="field-hint">{imageEngineMode === 'interactions' ? t('按所选分辨率请求生成，实际像素见作品卡片。自定义比例作为构图偏好。') : imageEngineMode === 'upstream' ? t('按服务支持的尺寸请求生成，实际像素见作品卡片。') : t('当前服务仅将分辨率作为创作偏好，选择 4K 不保证输出 4K。实际像素见作品卡片。')}</p>}
          </>}
          {kind === 'music' && mode === 'inspiration' && <button className="secondary-button organize-button" disabled={locked || !prompt.trim()} onClick={() => void organize()}><WandSparkles size={16} />{t('整理段落并编辑')}</button>}
        </fieldset>
        {!embedded && error && <p className="error-text" role="alert">{error}</p>}
        {!embedded && <button className="primary-button generate-button" disabled={locked || !hasInput} onClick={() => void create()}>{locked ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{organizing ? t('正在编排歌曲…') : busy ? t('正在生成…') : t('生成{mode}', { mode: name })}<ArrowUpRight size={17} /></button>}
        <p className="generation-note">{kind === 'music' ? t('歌曲、段落与歌词一起保存。歌词可导出 TXT；LRC 时间为估算，方便后续校准。') : kind === 'image' ? t('作品卡片显示实际像素，未达到目标分辨率时会提示。原图自动收入作品库，可下载。') : videoEngineMode === 'chat' ? t('时长、比例和画质作为创作偏好，实际效果以返回视频为准。完成后自动保存，可播放和下载。') : t('时长与画质组合以服务支持为准，联想等级作为创作偏好。完成后自动保存，可播放和下载。')}</p>
      </CreationParameters>
      {embedded && error && <p ref={errorNotice} className="error-text creation-error" role="alert">{error}</p>}
      <section className={`generation-results ${kind}-results-panel`}>
        <div className="results-heading">
          <div className="results-heading-main">
            <h2>{t('创作结果')}</h2>
            <span className="results-count">{assets.length}</span>
          </div>
          <span className="results-heading-note">{assets.length ? t('共 {n} 件{mode}', { n: assets.length, mode: name }) : t('生成后会出现在这里')}</span>
        </div>
        {assets.length ? (
          <div className={`results-grid ${kind}-results`}>
            {assets.map(asset => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onDelete={onDelete}
                onRetry={onRetry}
                onDownload={onDownload}
                onEdit={onEdit}
                onAlignLyrics={onAlignLyrics}
                aligning={aligningIds?.includes(asset.id)}
                onDownloadCover={onDownloadCover}
                onRetryCover={onRetryCover}
              />
            ))}
          </div>
        ) : (
          <div className={`generation-empty ${kind}-empty`}>
            <div className="welcome-symbol"><Companion size={embedded ? 104 : 140} interactive /></div>
            <h2>{kind === 'music' ? t('把心情写成一首歌') : kind === 'video' ? t('让脑海里的故事动起来') : t('把想象变成画面')}</h2>
            <p>{kind === 'music' ? t('写下故事、情绪或几句歌词，小o 陪你谱成歌。') : kind === 'video' ? t('描述场景、镜头和故事，小o 陪你把想象拍出来。') : t('描述画面、颜色和风格，小o 陪你把灵感变成图像。')}</p>
            <div className="suggestion-grid">
              {(kind === 'music'
                ? [[t('写一首温柔的歌'), t('关于夏天、晚风和重逢的轻快流行歌。')], [t('做一段氛围音乐'), t('没有人声，适合夜晚阅读的梦幻氛围音乐。')]]
                : kind === 'video'
                  ? [[t('拍一段电影感镜头'), t('镜头缓缓穿过花海，阳光落在随风摇曳的花瓣上。')], [t('讲一个小故事'), t('一只小o 在星光下出发，穿过云层寻找新的朋友。')]]
                  : [[t('画一幅小o 插画'), t('蓝紫色星球小o 漂浮在星云与花朵之间，柔和插画风。')], [t('做一张电影海报'), t('雨后的城市夜景，霓虹倒影，安静而有电影感。')]]
              ).map(([title, prompt]) => (
                <button key={title} type="button" onClick={() => onPromptSuggestion?.(prompt)}>
                  <strong>{title}</strong>
                  <p>{prompt}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  </div>;
}
