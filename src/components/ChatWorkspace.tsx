import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Download, Image, LoaderCircle, Music2, PanelRightClose, Plus, RefreshCw, SlidersHorizontal, Sparkles, Square, UserRound, Video, X } from 'lucide-react';
import type { Conversation, MediaKind, Message } from '../lib/types';
import Markdown from './Markdown';
import { publicServiceError } from '../lib/api';
import ThinkingOrbSvg from './svg/ThinkingOrbSvg';
import { ChatAgentSvg } from './svg/AnimatedIcons';
import Companion from './Companion';
import BrandLogoSvg from './svg/BrandLogoSvg';
import MoreMenu from './ui/MoreMenu';
import MediaWorkspace, { type MediaComposerState, type MediaWorkspaceHandle, type MediaWorkspaceProps } from './MediaWorkspace';

export default function ChatWorkspace({
  conversation,
  busy,
  onSend,
  onStop,
  onNew,
  onRetry,
  onExport,
  notify,
  kind,
  onModeChange,
  media,
}: {
  conversation?: Conversation;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNew: () => void;
  onRetry: (id: string) => void;
  onExport: () => void;
  notify: (text: string) => void;
  kind: MediaKind | null;
  onModeChange: (kind: MediaKind | null) => void;
  media: Omit<MediaWorkspaceProps, 'kind' | 'initialPrompt' | 'embedded' | 'controller' | 'onComposerStateChange'>;
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
  const modeName = kind === 'image' ? '图像' : kind === 'video' ? '视频' : '音乐';
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
      notify('复制失败，请手动选择文本复制。');
    }
  };

  const suggestions = [
    ['日常闲聊与倾诉', '今天有点累，想找你聊聊天，听听你轻松温暖的话语。'],
    ['写点有意思的', '为一家独立咖啡馆写 3 条有温度的品牌文案，简短而有记忆点。'],
    ['一起想个点子', '我想做一个周末创意项目，请帮我想 5 个有趣而且可以在两天内完成的点子。'],
    ['把复杂变简单', '用生动的语言和一个生活中的例子，向我解释什么是机器学习。'],
  ];

  return (
    <div className="chat-workspace" onKeyDown={e => {
      if (e.key === 'Escape' && kind && parametersOpen) { e.preventDefault(); e.stopPropagation(); changeParameters(false); }
    }}>
      {/* 顶部高级控制条 */}
      <div className="workspace-toolbar">
        <div className="toolbar-left">
          <span className="workspace-label">
            <ChatAgentSvg size={18} active={true} />
            <span>AI 对话</span>
          </span>
          <span className="toolbar-divider" />
          {/* 高级动态模型选择器 */}

          <span className="stream-badge">
            <span className="stream-dot" />
            随时陪你聊
          </span>
        </div>
        <div className="toolbar-right">
          <MoreMenu label="更多对话操作" items={[{ label: '导出当前会话', icon: <Download size={16} />, disabled: !messages.length, onClick: onExport }]} />
          <button className="secondary-button small" disabled={busy} onClick={onNew}>
            <Plus size={15} />新会话
          </button>
          {kind && <button ref={panelToggle} className={`icon-button parameters-sidebar-toggle ${parametersOpen ? 'is-active' : ''}`} type="button" aria-label={parametersOpen ? '收起创作参数' : '展开创作参数'} title={parametersOpen ? '收起创作参数' : '展开创作参数'} aria-expanded={parametersOpen} aria-controls={panelId} onClick={() => changeParameters(!parametersOpen)}>{parametersOpen ? <PanelRightClose size={19} /> : <SlidersHorizontal size={16} />}</button>}
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
        {kind ? <MediaWorkspace key={kind} {...media} kind={kind} initialPrompt={input} embedded controller={mediaController} onComposerStateChange={setMediaState} panelHost={panelHost} onPromptSuggestion={prompt => { setInput(prompt); setTimeout(() => { composer.current?.focus(); adjustHeight(composer.current); }, 0); }} /> : !messages.length ? (
          <div className="chat-welcome">
            <div className="welcome-symbol">
              <Companion size={180} animated interactive />
            </div>
            <span className="eyebrow">A LITTLE COMPANY. A LOT OF POSSIBILITY.</span>
            <h1>嗨，我是小o。今天想聊些什么？</h1>
            <p>聊聊心事，碰撞灵感。点输入框下的 +，一起画画、写歌、拍个故事。</p>
            <div className="suggestion-grid">
              {suggestions.map(([title, prompt], i) => (
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
                  <span>0{i + 1}</span>
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
                    {message.role === 'user' ? '你' : '小o'}
                    <span>{message.role === 'assistant' ? '灵感伙伴' : ''}</span>
                  </div>
                  {message.content ? (
                    <Markdown text={message.content} />
                  ) : busy && i === messages.length - 1 ? (
                    <ThinkingOrbSvg size={26} label="小o 正在思考与生成回复…" />
                  ) : null}
                  {message.error && (
                    <div className="message-error" role="alert">
                      {publicServiceError(message.error)}
                    </div>
                  )}
                  {message.interrupted && (
                    <span className="interrupted-label">生成已停止，可重新生成</span>
                  )}
                  {message.role === 'assistant' && (!busy || i < messages.length - 1) && (
                    <div className="message-actions">
                      <button
                        onClick={() => void copy(message)}
                        disabled={!message.content}
                        aria-label="复制回答"
                      >
                        {copied === message.id ? <Check size={14} /> : <Copy size={14} />}
                        {copied === message.id ? '已复制' : '复制'}
                      </button>
                      <button onClick={() => onRetry(message.id)} disabled={busy}>
                        <RefreshCw size={14} />重新生成
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
          {kind && <div className="composer-mode-heading"><ModeIcon size={14} /><span>{modeName}创作</span><small>{mediaState.composingSong ? '在创作参数中编辑段落，再点击生成' : '描述想法，小o帮你完成'}</small><button className="icon-button" aria-label="返回 AI 对话" disabled={mediaLocked} onClick={() => onModeChange(null)}><X size={14} /></button></div>}
          <textarea
            ref={composer}
            value={input}
            aria-label={kind ? `${modeName}描述` : '对话内容'}
            placeholder={mediaState.composingSong && kind === 'music' ? '歌曲使用上方编辑的段落与歌词，可直接点击生成…' : kind === 'image' ? '描述想画的画面、颜色与风格…' : kind === 'video' ? '描述场景、镜头和故事…' : kind === 'music' ? '写下故事、情绪或几句歌词，小o陪你谱成歌…' : '和小o说说你的想法…'}
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
            <div className="composer-tools"><MoreMenu label="选择创作方式" className="creation-plus" disabled={mediaLocked || busy} triggerIcon={<Plus size={20} />} items={[{ label: '图片', icon: <Image size={16} />, onClick: () => onModeChange('image') }, { label: '音乐', icon: <Music2 size={16} />, onClick: () => onModeChange('music') }, { label: '视频', icon: <Video size={16} />, onClick: () => onModeChange('video') }]} /><span><Sparkles size={14} />{kind ? `一起创作${modeName}` : '让好奇心带路'}</span></div>
            {kind ? <button className="primary-button composer-generate" aria-label={`生成${modeName}`} disabled={busy || mediaLocked || !mediaState.hasInput} onClick={send}>{mediaLocked ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{mediaLocked ? '正在创作…' : `生成${modeName}`}</button> : busy ? (
              <button className="send-button stop" aria-label="停止生成" onClick={onStop}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="发送消息"
                disabled={!input.trim()}
                onClick={send}
              >
                <ArrowUp size={21} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">
          <span>Enter 发送 · Shift + Enter 换行</span>
          <span>留住每一步灵感 · 本地保存</span>
        </div>
      </div>
      </div>
      <button className={`parameters-sidebar-backdrop ${kind && parametersOpen ? 'is-open' : ''}`} type="button" aria-label="关闭创作参数" aria-hidden={!kind || !parametersOpen} inert={!kind || !parametersOpen} tabIndex={-1} onClick={() => changeParameters(false)} />
      <aside ref={setPanelHost} id={panelId} className={`creation-sidebar ${kind && parametersOpen ? 'is-open' : ''}`} aria-label="创作参数" aria-hidden={!kind || !parametersOpen} inert={!kind || !parametersOpen} />
      </div>
    </div>
  );
}
