import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Download, Image, LoaderCircle, Music2, PanelRightClose, Plus, RefreshCw, SlidersHorizontal, Sparkles, Square, UserRound, Video, X } from 'lucide-react';
import type { Conversation, MediaKind, Message, PublicModel } from '../lib/types';
import Markdown from './Markdown';
import { publicServiceError } from '../lib/api';
import ThinkingOrbSvg from './svg/ThinkingOrbSvg';
import Companion from './Companion';
import BrandLogoSvg from './svg/BrandLogoSvg';
import MoreMenu from './ui/MoreMenu';
import MediaWorkspace, { type MediaComposerState, type MediaWorkspaceHandle, type MediaWorkspaceProps } from './MediaWorkspace';
import { t } from '../lib/i18n';

export default function ChatWorkspace({
  cloudStorage = false,
  conversation,
  busy,
  onSend,
  onStop,
  onRetry,
  onExport,
  notify,
  kind,
  onModeChange,
  media,
  draftRequest,
  onDraftConsumed,
  models = [],
  modelId = '',
  onModelChange,
}: {
  cloudStorage?: boolean;
  conversation?: Conversation;
  busy: boolean;
  models?: PublicModel[];
  modelId?: string;
  onModelChange?: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: (id: string) => void;
  onExport: () => void;
  notify: (text: string) => void;
  kind: MediaKind | null;
  onModeChange: (kind: MediaKind | null) => void;
  draftRequest?: { token: string; prompt: string; options: Record<string, string | number> } | null;
  onDraftConsumed?: () => void;
  media: Omit<MediaWorkspaceProps, 'kind' | 'initialPrompt' | 'embedded' | 'controller' | 'onComposerStateChange' | 'parameterRequest'>;
}) {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState('');
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const panelId = useId();
  const panelToggle = useRef<HTMLButtonElement>(null);
  const [parametersOpen, setParametersOpen] = useState(() => {
    try {
      const saved = sessionStorage.getItem('olai.creation-parameters-open');
      if (saved !== null) return saved === 'true';
    } catch { /* Use the viewport default without storage. */ }
    return typeof window === 'undefined' || window.innerWidth > 900;
  });
  const [narrow, setNarrow] = useState(false);
  const changeParameters = (open: boolean) => {
    setParametersOpen(open);
    try { sessionStorage.setItem('olai.creation-parameters-open', String(open)); } catch { /* The sidebar also works without storage. */ }
    if (!open) panelToggle.current?.focus();
  };
  const mediaController = useRef<MediaWorkspaceHandle>(null);
  const [mediaState, setMediaState] = useState<MediaComposerState>({ locked: false, hasInput: false, composingSong: false });
  const modeName = kind === 'image' ? t('图像') : kind === 'video' ? t('视频') : t('音乐');
  const mediaLocked = !!kind && (media.busy || mediaState.locked);
  const ModeIcon = kind === 'image' ? Image : kind === 'video' ? Video : Music2;
  const messages = conversation?.messages || [];

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (mediaState.composingSong) changeParameters(true);
  }, [mediaState.composingSong]);

  useEffect(() => {
    if (!kind && follow && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, follow, kind]);

  useEffect(() => {
    setInput('');
    setFollow(true);
    composer.current?.focus();
  }, [conversation?.id]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
    composer.current?.focus();
  }, [kind]);

  const adjustHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  useEffect(() => {
    if (!draftRequest) return;
    setInput(draftRequest.prompt);
    changeParameters(true);
    requestAnimationFrame(() => { composer.current?.focus(); adjustHeight(composer.current); });
    onDraftConsumed?.();
  }, [draftRequest?.token]);

  useEffect(() => {
    if (kind !== 'music' || !media.editRequest) return;
    const { asset } = media.editRequest;
    setInput(typeof asset.options.inspiration === 'string' ? asset.options.inspiration : '');
    changeParameters(true);
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [media.editRequest?.token, kind]);

  const send = () => {
    if (kind) { if (!busy && !mediaLocked) mediaController.current?.create(); return; }
    if (!input.trim() || busy) return;
    onSend(input.trim());
    setInput('');
    if (composer.current) composer.current.style.height = 'auto';
    setFollow(true);
  };

  const copy = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      notify(t('复制失败，请手动选择文本复制。'));
    }
  };

  const suggestions = [
    [t('日常闲聊与倾诉'), t('今天有点累，想找你聊聊天，听听你轻松温暖的话语。')],
    [t('写点有意思的'), t('为一家独立咖啡馆写 3 条有温度的品牌文案，简短而有记忆点。')],
    [t('一起想个点子'), t('我想做一个周末创意项目，请帮我想 5 个有趣而且可以在两天内完成的点子。')],
    [t('把复杂变简单'), t('用生动的语言和一个生活中的例子，向我解释什么是机器学习。')],
  ];

  return (
    <div className="chat-workspace" onKeyDown={e => {
      if (e.key === 'Escape' && kind && parametersOpen) { e.preventDefault(); e.stopPropagation(); changeParameters(false); }
    }}>
      {/* 顶部高级控制条 */}
      <div className="workspace-toolbar">
        <div className="toolbar-left">
          <h1 className="workspace-label">{kind ? modeName : t('AI 对话')}</h1>
        </div>
        <div className="toolbar-right">
          {!kind && <MoreMenu label={t('更多对话操作')} items={[{ label: t('导出当前会话'), icon: <Download size={16} />, disabled: !messages.length, onClick: onExport }]} />}
          {kind && <button ref={panelToggle} className={`icon-button parameters-sidebar-toggle ${parametersOpen ? 'is-active' : ''}`} type="button" aria-label={parametersOpen ? t('收起创作参数') : t('展开创作参数')} title={parametersOpen ? t('收起创作参数') : t('展开创作参数')} aria-expanded={parametersOpen} aria-controls={panelId} onClick={() => changeParameters(!parametersOpen)}>{parametersOpen ? <PanelRightClose size={19} /> : <SlidersHorizontal size={16} />}</button>}
        </div>
      </div>

      {/* 消息滚动区 */}
      <div className={`chat-body ${kind && parametersOpen ? 'has-parameters' : ''}`}>
      <div className="chat-primary" inert={!!kind && parametersOpen && narrow}>
      <div className="chat-stage">
      <div
        className="chat-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
        }}
      >
        {kind ? <MediaWorkspace key={kind} {...media} kind={kind} initialPrompt={input} embedded controller={mediaController} onComposerStateChange={setMediaState} panelHost={panelHost} parameterRequest={draftRequest} onPromptSuggestion={prompt => { setInput(prompt); setTimeout(() => { composer.current?.focus(); adjustHeight(composer.current); }, 0); }} /> : !messages.length ? (
          <div className="chat-welcome">
            <div className="welcome-symbol">
              <Companion size={120} interactive />
            </div>
            <h2>{t('从一个想法开始')}</h2>
            <p>{t('和小o聊聊，或从左侧选择一种创作方式')}</p>
            <div className="suggestion-grid">
              {suggestions.map(([title, prompt]) => (
                <button
                  key={title}
                  onClick={() => {
                    setInput(prompt);
                    setTimeout(() => {
                      composer.current?.focus();
                      adjustHeight(composer.current);
                    }, 0);
                  }}
                >
                  <strong>{title}</strong>
                  <p>{prompt}</p>
                  <ArrowUp size={16} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((message, i) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-avatar">
                  {message.role === 'user' ? (
                    <UserRound size={17} />
                  ) : (
                    <BrandLogoSvg size={32} />
                  )}
                </div>
                <div className="message-main">
                  <div className="message-name">
                    {message.role === 'user' ? t('你') : t('小o')}
                    <span>{message.role === 'assistant' ? t('灵感伙伴') : ''}</span>
                  </div>
                  {message.content ? (
                    <Markdown text={message.content} />
                  ) : busy && i === messages.length - 1 ? (
                    <ThinkingOrbSvg size={26} label={t('小o 正在思考与生成回复…')} />
                  ) : null}
                  {message.error && (
                    <div className="message-error" role="alert">
                      {t(publicServiceError(message.error))}
                    </div>
                  )}
                  {message.interrupted && (
                    <span className="interrupted-label">{t('生成已停止，可重新生成')}</span>
                  )}
                  {message.role === 'assistant' && (!busy || i < messages.length - 1) && (
                    <div className="message-actions">
                      <button
                        onClick={() => void copy(message)}
                        disabled={!message.content}
                        aria-label={t('复制回答')}
                      >
                        {copied === message.id ? <Check size={14} /> : <Copy size={14} />}
                        {copied === message.id ? t('已复制') : t('复制')}
                      </button>
                      <button onClick={() => onRetry(message.id)} disabled={busy}>
                        <RefreshCw size={14} />{t('重新生成')}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      </div>
      {/* 底部输入框 */}
      <div className="composer-area">
        <div className="composer">
          {kind && <div className="composer-mode-heading"><ModeIcon size={14} /><span>{t('{mode}创作', { mode: modeName })}</span><small>{mediaState.composingSong ? t('在创作参数中编辑段落，再点击生成') : t('描述想法，小o帮你完成')}</small><button className="icon-button" aria-label={t('返回 AI 对话')} disabled={mediaLocked} onClick={() => onModeChange(null)}><X size={14} /></button></div>}
          <textarea
            ref={composer}
            value={input}
            aria-label={kind ? t('{mode}描述', { mode: modeName }) : t('对话内容')}
            placeholder={mediaState.composingSong && kind === 'music' ? t('歌曲使用上方编辑的段落与歌词，可直接点击生成…') : kind === 'image' ? t('描述想画的画面、颜色与风格…') : kind === 'video' ? t('描述场景、镜头和故事…') : kind === 'music' ? t('写下故事、情绪或几句歌词，小o陪你谱成歌…') : t('和小o说说你的想法…')}
            maxLength={10000}
            disabled={mediaLocked}
            rows={2}
            onChange={e => {
              setInput(e.target.value);
              adjustHeight(e.target);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-bottom">
            <div className="composer-tools">
              <MoreMenu label={t('选择创作方式')} className="creation-plus" disabled={mediaLocked || busy} triggerIcon={<Plus size={20} />} items={[{ label: t('图片'), icon: <Image size={16} />, onClick: () => onModeChange('image') }, { label: t('音乐'), icon: <Music2 size={16} />, onClick: () => onModeChange('music') }, { label: t('视频'), icon: <Video size={16} />, onClick: () => onModeChange('video') }]} />
              {!kind && models.length > 0 && (
                <select className="model-select" aria-label={t('切换对话模型')} value={modelId}
                  onChange={event => onModelChange?.(event.target.value)}>
                  <option value="">{t('默认模型')}</option>
                  {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              )}

            </div>
            {kind ? <button className="primary-button composer-generate" aria-label={t('生成{mode}', { mode: modeName })} disabled={busy || mediaLocked || !mediaState.hasInput} onClick={send}>{mediaLocked ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{mediaLocked ? t('正在创作…') : t('生成{mode}', { mode: modeName })}</button> : busy ? (
              <button className="send-button stop" aria-label={t('停止生成')} onClick={onStop}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label={t('发送消息')}
                disabled={!input.trim()}
                onClick={send}
              >
                <ArrowUp size={21} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">
          <span>{t('Enter 发送 · Shift + Enter 换行')}</span>
          <span>{t('留住每一步灵感 · 个人学习开发 · {storage}', { storage: cloudStorage ? t('账号保存') : t('本地保存') })}</span>
        </div>
      </div>
      </div>
      <button className={`parameters-sidebar-backdrop ${kind && parametersOpen ? 'is-open' : ''}`} type="button" aria-label={t('关闭创作参数')} aria-hidden={!kind || !parametersOpen} inert={!kind || !parametersOpen} tabIndex={-1} onClick={() => changeParameters(false)} />
      <aside ref={setPanelHost} id={panelId} className={`creation-sidebar ${kind && parametersOpen ? 'is-open' : ''}`} aria-label={t('创作参数')} aria-hidden={!kind || !parametersOpen} inert={!kind || !parametersOpen} />
      </div>
    </div>
  );
}
