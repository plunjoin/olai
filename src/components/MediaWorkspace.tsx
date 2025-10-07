import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, LoaderCircle, Plus, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import type { Asset, MediaKind, SongDraft, SongSection } from '../lib/types';
import { newSong, SECTION_LABELS, SECTION_TYPES, songPrompt } from '../lib/music';
import { IMAGE_RATIOS, normalizeRatio } from '../lib/generation';
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
  onPromptSuggestion?: (prompt: string) => void;
  editRequest?: { asset: Asset; token: string };
  onEdit?: (asset: Asset) => void;
  onAlignLyrics?: (asset: Asset) => void;
  aligningIds?: string[];
  onDownloadCover?: (asset: Asset) => void;
  onRetryCover?: (asset: Asset) => void;
}

export default function MediaWorkspace({ kind, initialPrompt, assets, busy, onCompose, onGenerate, onDelete, onRetry, onDownload, embedded = false, controller, onComposerStateChange, panelHost, onPromptSuggestion, editRequest, onEdit, onAlignLyrics, aligningIds, onDownloadCover, onRetryCover }: MediaWorkspaceProps) {
  const [localPrompt, setPrompt] = useState(initialPrompt);
  const prompt = embedded ? initialPrompt : localPrompt;
  const [ratio, setRatio] = useState(kind === 'video' ? '16:9' : 'auto');
  const [customRatio, setCustomRatio] = useState('');
  const [quality, setQuality] = useState(kind === 'image' ? '1K' : '720p');
  const [thinking, setThinking] = useState(kind === 'video' ? 'high' : 'medium');
  const [duration, setDuration] = useState(4);
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
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error && embedded) errorNotice.current?.scrollIntoView({ block: 'nearest' }); }, [error, embedded]);
  const name = kind === 'image' ? '图像' : kind === 'video' ? '视频' : '音乐';
  const locked = busy || organizing;
  const styles = kind === 'music' ? ['自由创作', '流行', 'Lo-fi', '电子', '爵士', '氛围音乐'] : kind === 'image' ? ['自由创作', '摄影', '3D 艺术', '插画', '电影感'] : ['自由创作', '电影感', '自然风光', '产品展示', '动画'];
  const updateSection = (id: string, patch: Partial<SongSection>) => setSong(s => ({ ...s, sections: s.sections.map(section => section.id === id ? { ...section, ...patch } : section) }));
  const move = (index: number, offset: number) => setSong(s => { const sections = [...s.sections]; [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]]; return { ...s, sections }; });
  const organize = async (openEditor = true) => {
    setError(''); setOrganizing(true);
    try { const draft = await onCompose(prompt.trim(), style, song.instrumental); setSong(draft); setDraftPrompt(prompt.trim()); if (openEditor) setMode('composer'); return draft; }
    catch (e) { setError(e instanceof Error ? e.message : '歌曲整理失败，请重试。'); return undefined; }
    finally { setOrganizing(false); }
  };
  const create = async () => {
    if (locked || !hasInput) return;
    setError('');
    try {
      if (kind === 'music') {
        const draft = useDraft ? song : await organize(false);
        if (!draft) return;
        if (!draft.sections.length || !draft.sections.some(s => s.direction.trim() || (!draft.instrumental && s.lyrics.trim()))) throw new Error('请为至少一个段落填写歌词或编曲描述。');
        const finalSong = { ...draft, style: [draft.style, style].filter(Boolean).join('，') };
        onGenerate(songPrompt(finalSong), { song: JSON.stringify(finalSong), music_mode: useDraft ? 'composer' : 'inspiration', inspiration: prompt.trim(), generate_cover: generateCover ? 1 : 0 });
      } else {
        const aspect_ratio = normalizeRatio(ratio === 'custom' ? customRatio : ratio);
        onGenerate(`${prompt.trim()}${style ? `\n风格：${style}` : ''}`, kind === 'image' ? { aspect_ratio, image_size: quality, reasoning_effort: thinking, n: 1 } : { aspect_ratio, seconds: duration, resolution: quality, reasoning_effort: thinking });
      }
    } catch (e) { setError(e instanceof Error ? e.message : '请检查创作内容。'); }
  };
  const useDraft = mode === 'composer' && prompt.trim() === draftPrompt;
  const hasInput = kind === 'music' && useDraft ? song.sections.some(s => s.direction.trim() || (!song.instrumental && s.lyrics.trim())) : !!prompt.trim();
  useImperativeHandle(controller, () => ({ create: () => void create() }));
  useEffect(() => { onComposerStateChange?.({ locked, hasInput, composingSong: kind === 'music' && useDraft }); }, [locked, hasInput, useDraft, kind, onComposerStateChange]);
  return <div className={`media-workspace ${kind}-workspace ${embedded ? 'embedded-creation' : ''}`}>
    <div className="page-intro"><div><span className="eyebrow">A LITTLE IDEA. A NEW POSSIBILITY.</span><h1>{name}创作<span className="heading-spark">✦</span></h1><p>{kind === 'music' ? '从一个念头，到一首属于你的歌。' : kind === 'image' ? '把脑海里的色彩，变成眼前的惊喜。' : '让想象开始流动，让故事有了画面。'}</p></div><span className="workspace-step">01 描述灵感 <span>→</span> 02 收获作品</span></div>
    <div className="generation-layout">
      <CreationParameters embedded={embedded} host={panelHost} summary={kind === 'music' ? `${mode === 'composer' ? '段落编辑' : '灵感模式'} · ${song.instrumental ? '纯音乐' : '人声歌曲'}${style ? ` · ${style}` : ''}` : `${ratio === 'auto' ? '自动比例' : ratio === 'custom' ? customRatio || '自定义比例' : ratio} · ${quality}${kind === 'video' ? ` · ${duration} 秒` : ''}`}>
        <fieldset className="creation-fields" disabled={locked}>
          {kind === 'music' && <>
            <div className="music-mode-tabs" role="tablist" aria-label="音乐创作模式"><button role="tab" aria-selected={mode === 'inspiration'} className={mode === 'inspiration' ? 'selected' : ''} onClick={() => setMode('inspiration')}><Sparkles size={16} />灵感模式</button><button role="tab" aria-selected={mode === 'composer'} className={mode === 'composer' ? 'selected' : ''} onClick={() => { setDraftPrompt(prompt.trim()); setMode('composer'); }}><WandSparkles size={16} />Composer</button></div>
            <p className="field-hint mode-description">{mode === 'inspiration' ? '写下故事、心情或几句歌词，自动整理为完整歌曲段落。' : useDraft ? '编辑下方段落后直接生成；更换输入框中的灵感会重新整理歌曲。' : '灵感已修改，下次生成会按新描述重新整理歌曲。'}</p>
          </>}
          {!embedded && (kind !== 'music' || mode === 'inspiration') && <><div className="panel-title"><span><WandSparkles size={17} />描述你的灵感</span><span className="tiny-label">YOUR IDEA</span></div><textarea className="prompt-input" aria-label={`${name}描述`} placeholder={kind === 'music' ? '写一首关于夏天与重逢的歌。轻快的独立流行，温柔女声，副歌让人想跟着唱…' : kind === 'image' ? '明亮的橙色花朵、蓝色天空，阳光穿过透明玻璃，细腻的摄影质感…' : '镜头缓缓穿过花海，阳光洒在随风摇曳的花瓣上，轻盈而梦幻…'} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000} /><div className="prompt-counter">{prompt.length} / 10000</div></>}
          {kind === 'music' && <label className="checkbox-label"><input type="checkbox" checked={song.instrumental} onChange={e => setSong(s => ({ ...s, instrumental: e.target.checked }))} />纯音乐 · 无人声</label>}
          {kind === 'music' && <><label className="checkbox-label"><input type="checkbox" checked={generateCover} onChange={e => setGenerateCover(e.target.checked)} />生成封面</label><p className="field-hint">根据歌曲主题与风格绘制封面，和音乐一起保存。</p></>}
          {kind === 'music' && mode === 'composer' && <div className="song-composer">
            <label className="field-label">歌曲名称<input value={song.title} maxLength={100} placeholder="给这首歌起个名字" onChange={e => setSong(s => ({ ...s, title: e.target.value }))} /></label>
            <label className="field-label">整体音乐方向<textarea rows={2} value={song.style} maxLength={2000} placeholder="节奏、乐器、情绪、人声…" onChange={e => setSong(s => ({ ...s, style: e.target.value }))} /></label>
            <div className="section-sequence" aria-label="歌曲段落顺序">{song.sections.map((s, i) => <span key={s.id}>{i + 1}. {s.type}</span>)}</div>
            {song.sections.map((s, i) => <div className={`song-section section-${s.type}`} key={s.id}>
              <div className="song-section-header"><span className="section-number">{String(i + 1).padStart(2, '0')}</span><select aria-label={`第 ${i + 1} 段类型`} value={s.type} onChange={e => updateSection(s.id, { type: e.target.value as SongSection['type'] })}>{SECTION_TYPES.map(t => <option key={t} value={t}>{t} · {SECTION_LABELS[t]}</option>)}</select><div className="section-actions"><button className="icon-button" aria-label={`上移第 ${i + 1} 段`} disabled={locked || i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button className="icon-button" aria-label={`下移第 ${i + 1} 段`} disabled={locked || i === song.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><button className="icon-button" aria-label={`删除第 ${i + 1} 段`} disabled={locked || song.sections.length === 1} onClick={() => setSong(d => ({ ...d, sections: d.sections.filter(x => x.id !== s.id) }))}><Trash2 size={14} /></button></div></div>
              <input aria-label={`第 ${i + 1} 段编曲`} placeholder="编曲方向，如：钢琴渐入，节奏逐渐加强" value={s.direction} maxLength={2000} onChange={e => updateSection(s.id, { direction: e.target.value })} />
              {!song.instrumental && <textarea aria-label={`第 ${i + 1} 段歌词`} rows={3} placeholder="写下这一段的歌词…" value={s.lyrics} maxLength={6000} onChange={e => updateSection(s.id, { lyrics: e.target.value })} />}
            </div>)}
            <button className="secondary-button add-section" disabled={locked || song.sections.length >= 30} onClick={() => setSong(s => ({ ...s, sections: [...s.sections, { id: crypto.randomUUID(), type: 'verse', direction: '', lyrics: '' }] }))}><Plus size={16} />添加段落</button>
          </div>}
          <label className="field-label">创作风格</label><div className="style-options">{styles.map((s, i) => <button key={s} className={style === (i ? s : '') ? 'selected' : ''} onClick={() => setStyle(i ? s : '')}>{s}</button>)}</div>
          {kind !== 'music' && <>
            <div className="form-divider" />
            {kind === 'image' ? <><label className="field-label">画面比例</label><div className="aspect-options">{[...IMAGE_RATIOS, 'custom'].map(r => <button key={r} className={ratio === r ? 'selected' : ''} onClick={() => setRatio(r)}>{r === 'auto' ? 'Auto · 自动' : r === 'custom' ? '自定义' : r}</button>)}</div>{ratio === 'custom' && <label className="field-label">自定义比例<input aria-label="自定义图片比例" placeholder="例如 2.35:1" value={customRatio} onChange={e => setCustomRatio(e.target.value)} /></label>}<p className="field-hint">自动模式会根据你的描述决定画面构图。</p></> : null}
            <div className="settings-grid">
              {kind === 'video' && <><label className="field-label">视频时长<select aria-label="视频时长" value={duration} onChange={e => setDuration(Number(e.target.value))}>{[4,6,8].map(d => <option key={d} value={d}>{d} 秒</option>)}</select></label><label className="field-label">画面比例<select aria-label="画面比例" value={ratio} onChange={e => setRatio(e.target.value)}><option value="16:9">16:9 · 横屏</option><option value="9:16">9:16 · 竖屏</option></select></label></>}
              <label className="field-label">画质<select aria-label="画质" value={quality} onChange={e => setQuality(e.target.value)}>{(kind === 'image' ? ['1K','2K','4K'] : ['720p','1080p','4K']).map(q => <option key={q}>{q}</option>)}</select></label>
              <label className="field-label">联想等级<select aria-label="联想等级" value={thinking} onChange={e => setThinking(e.target.value)}><option value="minimal">Minimal · 轻度</option><option value="medium">Medium · 适中</option><option value="high">High · 丰富</option></select></label>
            </div>
          </>}
          {kind === 'music' && mode === 'inspiration' && <button className="secondary-button organize-button" disabled={locked || !prompt.trim()} onClick={() => void organize()}><WandSparkles size={16} />整理段落并编辑</button>}
        </fieldset>
        {!embedded && error && <p className="error-text" role="alert">{error}</p>}
        {!embedded && <button className="primary-button generate-button" disabled={locked || !hasInput} onClick={() => void create()}>{locked ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{organizing ? '正在编排歌曲…' : busy ? '正在生成…' : `生成${name}`}<ArrowUpRight size={17} /></button>}
        <p className="generation-note">{kind === 'music' ? '歌曲、段落与歌词一起保存。歌词可导出 TXT；LRC 时间为估算，方便后续校准。' : kind === 'image' ? '比例、画质与联想作为创作偏好，实际效果以生成结果为准。完成后自动收入作品库。' : '时长与画质组合以服务支持为准，联想等级作为创作偏好。完成后自动保存，可播放和下载。'}</p>
      </CreationParameters>
      {embedded && error && <p ref={errorNotice} className="error-text creation-error" role="alert">{error}</p>}
      <section className="generation-results"><div className="results-heading"><h2>创作结果 <span>{assets.length.toString().padStart(2, '0')}</span></h2><span>灵感在这里落地</span></div>{assets.length ? <div className={`results-grid ${kind === 'music' ? 'music-results' : ''}`}>{assets.map(asset => <AssetCard key={asset.id} asset={asset} onDelete={onDelete} onRetry={onRetry} onDownload={onDownload} onEdit={onEdit} onAlignLyrics={onAlignLyrics} aligning={aligningIds?.includes(asset.id)} onDownloadCover={onDownloadCover} onRetryCover={onRetryCover} />)}</div> : <div className={`generation-empty ${kind}-empty`}>
        <div className="welcome-symbol"><Companion size={180} animated interactive /></div>
        <span className="eyebrow">A LITTLE COMPANY. A LOT OF POSSIBILITY.</span>
        <h1>{kind === 'music' ? '嗨，我是小o。一起写首歌吧？' : kind === 'video' ? '嗨，我是小o。一起拍个故事吧？' : '嗨，我是小o。今天想画些什么？'}</h1>
        <p>{kind === 'music' ? '写下故事、情绪或几句歌词，小o 陪你谱成歌。' : kind === 'video' ? '描述场景、镜头和故事，小o 陪你把想象拍出来。' : '描述画面、颜色和风格，小o 陪你把灵感变成图像。'}</p>
        <div className="suggestion-grid">
          {(kind === 'music' ? [['写一首温柔的歌', '关于夏天、晚风和重逢的轻快流行歌。'], ['做一段氛围音乐', '没有人声，适合夜晚阅读的梦幻氛围音乐。']] : kind === 'video' ? [['拍一段电影感镜头', '镜头缓缓穿过花海，阳光落在随风摇曳的花瓣上。'], ['讲一个小故事', '一只小o 在星光下出发，穿过云层寻找新的朋友。']] : [['画一幅小o 插画', '蓝紫色星球小o 漂浮在星云与花朵之间，柔和插画风。'], ['做一张电影海报', '雨后的城市夜景，霓虹倒影，安静而有电影感。']]).map(([title, prompt], i) => <button key={title} onClick={() => onPromptSuggestion?.(prompt)}><span>0{i + 1}</span><strong>{title}</strong><p>{prompt}</p></button>)}
        </div>
      </div>}</section>
    </div>
  </div>;
}
