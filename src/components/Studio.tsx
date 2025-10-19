import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, Command, Menu, MessageSquare, PanelLeftClose, Pencil, Plus, Search, Settings as SettingsIcon, ShieldCheck, Trash2, X } from 'lucide-react';
import { base64Blob, chat, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { downloadLrcBlob, generateLrcFromPrompt } from '../lib/lrc';
import { ensurePlayableAudioBlob } from '../lib/audio';
import { alignLyricsToAudio, readAudioDuration } from '../lib/lyricAlignment';
import { getAll, loadSettings, put, remove, saveSettings, storageMode } from '../lib/storage';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type MediaKind, type Model, type Settings, type View } from '../lib/types';
import { composeSong, parseSong, songLyrics, sungLines } from '../lib/music';
import { imageDimensions } from '../lib/generation';
import BrandLogoSvg from './svg/BrandLogoSvg';
import {
  ChatAgentSvg,
  CosmicVaultSvg
} from './svg/AnimatedIcons';
import StatusBeaconSvg from './svg/StatusBeaconSvg';
import ChatWorkspace from './ChatWorkspace';
import Library from './Library';
import SettingsDialog from './SettingsDialog';
import GlobalMediaPlayer from './GlobalMediaPlayer';
import Companion from './Companion';
import useDialogs from './ui/useDialogs';
import MoreMenu from './ui/MoreMenu';
import { PlayerProvider, revokeAssetMediaURL, usePlayer } from '../lib/playerContext';

const navigation = [
  { view: 'chat' as const, label: 'AI 对话', icon: ChatAgentSvg },
];
const modelKey = { image: 'imageModel', video: 'videoModel', music: 'musicModel' } as const;
const errorText = (error: unknown) => publicServiceError(error instanceof Error ? error.message : '发生未知错误，请重试。');
const uid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

const VALID_VIEWS: readonly View[] = ['home', 'chat', 'image', 'video', 'music', 'library'] as const;

function parseLocation(): { view: View; conversationId?: string } {
  if (typeof window === 'undefined') return { view: 'chat' };
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (VALID_VIEWS.includes(hash as View)) {
    return { view: hash === 'home' ? 'chat' : hash as View };
  }
  const parts = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'home') {
    return { view: 'chat' };
  }
  const [first, second] = parts;
  if (first === 'chat') {
    return { view: 'chat', conversationId: second ? decodeURIComponent(second) : undefined };
  }
  if (VALID_VIEWS.includes(first as View)) {
    return { view: first as View };
  }
  return { view: 'chat' };
}

function buildUrl(targetView: View, conversationId?: string): string {
  if (targetView === 'home') return '/';
  if (targetView === 'chat' && conversationId) return `/chat/${encodeURIComponent(conversationId)}`;
  if (targetView === 'chat') return '/';
  return `/${targetView}`;
}

function StudioInner({ serverKey = false }: { serverKey?: boolean }) {
  const { confirm, prompt, dialog } = useDialogs();
  const { activeMedia, close: closePlayer, updateLyrics, updateCover } = usePlayer();
  const [view, setView] = useState<View>(() => {
    if (typeof window !== 'undefined') return parseLocation().view;
    return 'chat';
  });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('olai.sidebar');
      if (saved !== null) return saved === 'true';
      return window.innerWidth > 768;
    }
    return true;
  });
  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('olai.sidebar', String(next)); } catch {}
      return next;
    });
  };
  const [conversations, setConversations] = useState<Conversation[]>([]); const [assets, setAssets] = useState<Asset[]>([]);
  const [musicEdit, setMusicEdit] = useState<{ asset: Asset; token: string }>();
  const [aligningIds, setAligningIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const loc = parseLocation();
      if (loc.conversationId) return loc.conversationId;
      return localStorage.getItem('olai.active') || localStorage.getItem('studio.active') || '';
    }
    return '';
  });
  const [ready, setReady] = useState(false); const [chatBusy, setChatBusy] = useState(false);
  const [models, setModels] = useState<Model[]>([]); const [modelsLoading, setModelsLoading] = useState(false); const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(''); const [sessionSearch, setSessionSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false);
  const assetsRef = useRef<Asset[]>([]); const conversationsRef = useRef<Conversation[]>([]); const settingsRef = useRef(settings);
  const chatController = useRef<AbortController | null>(null); const jobs = useRef(new Map<string, AbortController>()); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const persistError = (error: unknown) => notify(`本地保存失败：${errorText(error)}。请下载重要内容并检查浏览器存储空间。`);
  const saveConversation = (conversation: Conversation, persist = true) => {
    conversationsRef.current = [conversation, ...conversationsRef.current.filter(c => c.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    setConversations(conversationsRef.current);
    if (persist) void put('conversations', conversation).catch(persistError);
  };
  const saveAsset = async (asset: Asset) => {
    assetsRef.current = [asset, ...assetsRef.current.filter(a => a.id !== asset.id)].sort((a, b) => b.createdAt - a.createdAt);
    setAssets(assetsRef.current);
    try { await put('assets', asset); } catch (error) { persistError(error); }
  };
  const navigate = useCallback((next: View, convoId?: string, replace = false) => {
    if (next === 'home') next = 'chat';
    setView(next);
    if (next === 'chat' && convoId !== undefined) {
      setActiveId(convoId);
    }
    if (typeof window !== 'undefined') {
      const targetConvoId = next === 'chat' ? (convoId !== undefined ? convoId : activeId) : undefined;
      const targetUrl = buildUrl(next, targetConvoId);
      if (window.location.pathname !== targetUrl || window.location.hash) {
        if (replace) {
          window.history.replaceState(null, '', targetUrl);
        } else {
          window.history.pushState(null, '', targetUrl);
        }
      }
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    }
  }, [activeId]);
  useEffect(() => {
    const onLocationChange = () => {
      const loc = parseLocation();
      setView(loc.view);
      if (loc.view === 'chat' && loc.conversationId) {
        setActiveId(loc.conversationId);
      }
    };
    onLocationChange();
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);

    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.replace(/^#\/?/, '').trim();
      if (VALID_VIEWS.includes(hash as View)) {
        window.history.replaceState(null, '', buildUrl(hash as View));
      }
    }

    const readyTimer = setTimeout(() => setReady(true), 1500);
    void (async () => {
      try {
        const saved = loadSettings(); settingsRef.current = saved; setSettings(saved);
        const [chats, works] = await Promise.all([getAll<Conversation>('conversations'), getAll<Asset>('assets')]);
        const restored = (chats || []).map(c => ({
          ...c,
          messages: Array.isArray(c?.messages) ? c.messages.map(m => m.role === 'assistant' && !m.content && !m.error ? { ...m, interrupted: true } : m) : []
        })).sort((a, b) => b.updatedAt - a.updatedAt);
        conversationsRef.current = restored; setConversations(restored);
        const currentLoc = parseLocation();
        const routeConvoId = currentLoc.conversationId;
        const savedActive = localStorage.getItem('olai.active') || localStorage.getItem('studio.active') || '';
        const targetId = (routeConvoId && restored.some(c => c.id === routeConvoId))
          ? routeConvoId
          : (restored.some(c => c.id === savedActive) ? savedActive : (restored[0]?.id || ''));
        if (targetId) {
          setActiveId(targetId);
        } else if (routeConvoId) {
          window.history.replaceState(null, '', '/chat');
        }
        const recovered = (works || []).map(a => a && a.status === 'pending' && !(a.kind === 'video' && a.remoteId) ? { ...a, status: 'failed' as const, error: '上次请求被中断，请点击重试。' } : a).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
        assetsRef.current = recovered; setAssets(recovered);
        await Promise.all(recovered.filter(a => a.status === 'failed').map(a => put('assets', a)));
      } catch (error) { notify(`读取本地数据失败：${errorText(error)}`); }
      finally { clearTimeout(readyTimer); setReady(true); }
    })();
    return () => {
      clearTimeout(readyTimer);
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
      chatController.current?.abort();
      jobs.current.forEach(c => c.abort());
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => { if (activeId) { try { localStorage.setItem('olai.active', activeId); } catch { /* Session still works in memory. */ } } }, [activeId]);
  
  const refreshModels = async (key = settingsRef.current.key, announce = true) => {
    if (modelsLoading) return;
    setModelsLoading(true);
    try {
      const response = await request('models', key);
      const json = await response.json();
      if (!Array.isArray(json.data)) throw new Error('服务返回的模型列表格式不正确。');
      const available = json.data.filter((m: Model) => m.available !== false);
      setModels(available);
      setConnected(true);

      if (announce) notify('创作服务已连接。');
    } catch (error) {
      setConnected(false);
      notify(errorText(error));
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => { if (ready && (settings.key || serverKey)) void refreshModels(settings.key, false); }, [ready, settings.key, serverKey]);
  const requireConnection = () => { if (!settingsRef.current.key && !serverKey) { setSettingsOpen(true); notify('先连接你的 AI 服务，就可以开始创作。'); return false; } return true; };
  const changeSettings = (next: Settings, showToast = false) => {
    settingsRef.current = next; setSettings(next);
    try { saveSettings(next); if (showToast) { notify('设置已保存'); setSettingsOpen(false); } } catch (error) { persistError(error); }
  };
  const newConversation = useCallback(() => {
    if (chatController.current) { notify('请先停止当前回答，再创建会话。'); return; }
    const now = Date.now(); const conversation: Conversation = { id: uid(), title: '新的灵感', createdAt: now, updatedAt: now, messages: [], model: settingsRef.current.chatModel };
    saveConversation(conversation); setActiveId(conversation.id); navigate('chat', conversation.id);
  }, [notify, navigate]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newConversation();
      }
      if (e.key === 'Escape' && sidebarOpen && !document.querySelector('dialog[open]') && !document.querySelector('[role="menu"]')) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newConversation, sidebarOpen]);
  const openConversation = (id: string) => { setActiveId(id); navigate('chat', id); };
  const renameConversation = async (conversation: Conversation) => {
    const title = await prompt('给灵感起个名字', '一个容易记住的名字，让下次继续更轻松。', conversation.title);
    if (title?.trim()) saveConversation({ ...conversation, title: title.trim().slice(0, 100), updatedAt: Date.now() });
  };
  const deleteConversation = async (conversation: Conversation) => {
    if (chatBusy) { notify('请先停止回答，再删除会话。'); return; }
    if (!await confirm('删除这段会话？', `「${conversation.title}」和其中的消息将从此浏览器删除，此操作无法撤销。`)) return;
    if (chatController.current) { notify('请先停止回答，再删除会话。'); return; }
    try {
      await remove('conversations', conversation.id);
      conversationsRef.current = conversationsRef.current.filter(c => c.id !== conversation.id);
      setConversations(conversationsRef.current);
      if (activeId === conversation.id) {
        const remaining = conversationsRef.current;
        const nextId = remaining[0]?.id || '';
        setActiveId(nextId);
        navigate('chat', nextId, true);
      }
      notify('会话已删除');
    } catch (error) { persistError(error); }
  };
  const active = conversations.find(c => c.id === activeId);
  const sendMessage = async (text: string, retryId?: string) => {
    if (chatController.current || !requireConnection()) return;
    const config = { ...settingsRef.current }; const now = Date.now();
    let conversation = conversationsRef.current.find(c => c.id === activeId);
    if (!conversation) {
      conversation = { id: uid(), title: text.slice(0, 26), createdAt: now, updatedAt: now, messages: [], model: config.chatModel };
      setActiveId(conversation.id);
      navigate('chat', conversation.id, true);
    }
    let history = [...conversation.messages];
    if (retryId) { const index = history.findIndex(m => m.id === retryId); if (index < 0) return; history = history.slice(0, index); }
    else history.push({ id: uid(), role: 'user', content: text });
    const model = config.chatModel.trim();
    if (!model) { notify('对话服务暂不可用，请检查连接。'); return; }
    const assistant = { id: uid(), role: 'assistant' as const, content: '' };
    let running = { ...conversation, title: conversation.messages.length ? conversation.title : text.slice(0, 26) || conversation.title, model, updatedAt: now, messages: [...history, assistant] };
    const controller = new AbortController(); chatController.current = controller; setChatBusy(true); saveConversation(running);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await chat(config.key, model, history, config.systemPrompt, config.temperature, controller.signal, delta => {
        assistant.content += delta;
        running = { ...running, updatedAt: Date.now(), messages: [...history, { ...assistant }] };
        saveConversation(running, false);
        if (!saveTimer) saveTimer = setTimeout(() => { void put('conversations', running).catch(persistError); saveTimer = undefined; }, 500);
      });
      if (!assistant.content.trim()) throw new Error('暂未收到回答，请重新尝试。');
    } catch (error) {
      running = { ...running, messages: [...history, { ...assistant, ...(controller.signal.aborted ? { interrupted: true } : { error: errorText(error) }) }] };
    } finally {
      clearTimeout(saveTimer); saveConversation(running); chatController.current = null; setChatBusy(false);
    }
  };
  const pollVideo = async (original: Asset, key: string) => {
    if (!original.remoteId || jobs.current.has(original.id)) return;
    const controller = new AbortController(); jobs.current.set(original.id, controller);
    try {
      for (let attempt = 0; attempt < 240; attempt++) {
        const response = await request(`videos/${encodeURIComponent(original.remoteId)}`, key, { signal: controller.signal });
        const video = await response.json();
        if (video.status === 'failed') throw new Error(video.error?.message || video.error || '视频生成失败，请重试。');
        if (video.status === 'completed') {
          let blob: Blob;
          try { blob = await videoContent(original.remoteId, key, controller.signal); }
          catch (error) {
            if ((error as Error & { status?: number }).status !== 409) throw error;
            await delay(5000, controller.signal); continue;
          }
          await saveAsset({ ...original, status: 'completed', blob, url: undefined, error: undefined }); notify('你的视频已生成，去看看吧。'); return;
        }
        if (!['in_progress', 'queued', 'pending', 'processing'].includes(video.status)) throw new Error(`无法识别视频任务状态：${video.status || '空'}`);
        await delay(5000, controller.signal);
      }
      throw new Error('视频任务仍未完成；重新打开页面后可以继续查询。');
    } catch (error) {
      if (!controller.signal.aborted) await saveAsset({ ...original, status: 'failed', error: errorText(error) });
    } finally { jobs.current.delete(original.id); }
  };
  useEffect(() => {
    if (ready && (settings.key || serverKey)) for (const asset of assets) if (asset.kind === 'video' && asset.status === 'pending' && asset.remoteId && !jobs.current.has(asset.id)) void pollVideo(asset, settings.key);
  }, [ready, settings.key, serverKey, assets]);
  const generateMusicCover = async (original: Asset) => {
    const jobId = `cover:${original.id}`;
    if (jobs.current.has(jobId) || original.kind !== 'music' || original.status !== 'completed') return;
    const controller = new AbortController();
    jobs.current.set(jobId, controller);
    const config = { ...settingsRef.current };
    try {
      const response = await generateImage({ key: config.key, model: config.imageModel, mode: config.imageEngineMode, aspectRatio: '1:1', imageSize: '1K', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
        prompt: `为原创歌曲设计一张精美的方形专辑封面，以视觉画面表达歌曲主题与情绪，构图完整，适合音乐作品展示。只生成一张封面图片。\n歌曲：${original.song?.title || original.prompt.slice(0, 100)}\n音乐风格：${original.song?.style || '根据主题设计'}\n主题灵感：${original.options.inspiration || original.prompt.slice(0, 3000)}\n歌词意象：${(original.song ? sungLines(original.song) : original.lyrics || '').slice(0, 3000)}\n无需文字，不要水印。`,
      });
      let coverUrl: string;
      if (response.headers.get('content-type')?.includes('json')) {
        const output = mediaOutputs(await response.json(), 'image')[0];
        if (!output) throw new Error('服务没有返回封面图片。');
        if (output.base64 && output.mime.startsWith('image/')) coverUrl = `data:${output.mime};base64,${output.base64}`;
        else if (output.url) coverUrl = safeMediaURL(output.url);
        else throw new Error('服务没有返回有效封面图片。');
      } else {
        if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('服务没有返回有效封面图片。');
        const blob = await response.blob();
        if (!blob.size) throw new Error('服务返回了空封面图片。');
        coverUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
      }
      // Keep remote artwork available offline when the origin permits downloading it.
      if (/^https?:/.test(coverUrl)) {
        try {
          const downloaded = await fetch(coverUrl, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
          if (downloaded.ok && downloaded.headers.get('content-type')?.startsWith('image/')) {
            const blob = await downloaded.blob();
            coverUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
          }
        } catch { /* Retain the source URL when artwork cannot be downloaded. */ }
      }
      const current = assetsRef.current.find(a => a.id === original.id);
      if (!current || controller.signal.aborted) return;
      await saveAsset({ ...current, coverUrl, coverStatus: 'completed', coverError: undefined });
      updateCover(current.id, coverUrl);
      notify('歌曲封面已生成并保存。');
    } catch (error) {
      if (controller.signal.aborted) return;
      const current = assetsRef.current.find(a => a.id === original.id);
      if (current) await saveAsset({ ...current, coverStatus: 'failed', coverError: errorText(error) });
      notify('封面暂未生成，音乐已保存，可继续播放或下载。');
    } finally { jobs.current.delete(jobId); }
  };
  useEffect(() => {
    if (ready && (settings.key || serverKey)) for (const asset of assets) if (asset.kind === 'music' && asset.status === 'completed' && asset.coverStatus === 'pending') void generateMusicCover(asset);
  }, [ready, settings.key, serverKey, assets]);
  const saveCompletedAsset = async (asset: Asset) => {
    if (asset.kind === 'music' && asset.song && !asset.song.instrumental && asset.blob) {
      try {
        asset.audioDuration = await readAudioDuration(asset.blob);
        asset.lrc = generateLrcFromPrompt(sungLines(asset.song), asset.audioDuration, asset.song.title);
      } catch { /* Keep the clearly labelled estimate if metadata cannot be read. */ }
    }
    await saveAsset(asset);
  };
  const generate = async (kind: MediaKind, prompt: string, options: Record<string, string | number>, retry?: Asset) => {
    if (!requireConnection() || !prompt.trim()) return;
    if (assetsRef.current.some(a => a.kind === kind && a.status === 'pending' && a.id !== retry?.id)) { notify('同类型作品正在生成，请等待完成。'); return; }
    const config = { ...settingsRef.current }; const model = config[modelKey[kind]].trim();
    if (!model) { setSettingsOpen(true); notify(`创作服务暂不可用，请检查连接。`); return; }
    const asset: Asset = { id: retry?.id || uid(), kind, prompt, options, model, createdAt: Date.now(), status: 'pending' };
    await saveAsset(asset);
    try {
      if (kind === 'music' && typeof options.song === 'string') {
        asset.song = parseSong(options.song);
        asset.coverStatus = options.generate_cover === 1 ? 'pending' : undefined;
        asset.lyrics = songLyrics(asset.song);
        const lines = sungLines(asset.song);
        asset.lrc = lines ? generateLrcFromPrompt(lines, Number(options.duration) || 120, asset.song.title || '未命名歌曲') : undefined;
        asset.lrcSource = lines ? 'estimated' : undefined;
        await saveAsset(asset);
      }
      let response: Response;
      if (kind === 'video') {
        response = await generateVideo({ key: config.key, model, prompt, options });
      } else if (kind === 'image') {
        response = await generateImage({
          key: config.key,
          model,
          prompt,
          mode: config.imageEngineMode || 'auto',
          size: imageDimensions(String(options.aspect_ratio || 'auto'), String(options.image_size || '1K')),
          aspectRatio: String(options.aspect_ratio || 'auto'),
          imageSize: String(options.image_size || '1K'),
          reasoningEffort: String(options.reasoning_effort || 'medium'),
          n: typeof options.n === 'number' ? options.n : 1,
        });
      } else {
        let extra = {};
        try { extra = JSON.parse(config.musicExtra || '{}'); } catch {}
        response = await generateAudio({
          key: config.key,
          model,
          prompt,
          mode: config.audioEngineMode || 'auto',
          musicPath: config.musicPath || 'speech',
          duration: options.duration !== undefined ? Number(options.duration) : undefined,
          song: asset.song,
          voice: typeof options.voice === 'string' ? options.voice : 'alloy',
          speed: typeof options.speed === 'number' ? options.speed : 1.0,
          responseFormat: typeof options.response_format === 'string' ? options.response_format : 'mp3',
          extra,
        });
      }
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await response.json();
        if (kind === 'video') {
          if (json.status === 'failed') throw new Error('视频生成失败，请重试。');
          if (typeof json.id !== 'string' || !json.id || !['queued', 'pending', 'in_progress', 'processing', 'completed'].includes(json.status)) throw new Error('暂未收到视频任务，请重试或检查服务连接。');
          const task = { ...asset, remoteId: json.id }; await saveAsset(task); void pollVideo(task, config.key); return;
        }
        const outputs = mediaOutputs(json, kind);
        if (!outputs.length) throw new Error(kind === 'music' ? '暂未收到音乐文件，请重试或检查服务连接。' : '暂未收到图片，请重试或检查服务连接。');
        for (let i = 0; i < outputs.length; i++) {
          const output = outputs[i]; let blob: Blob | undefined; let url: string | undefined;
          if (output.base64) blob = base64Blob(output.base64, output.mime);
          else if (output.url) {
            const mediaUrl = safeMediaURL(output.url);
            url = mediaUrl;
            try { const media = await fetch(mediaUrl, { signal: AbortSignal.timeout(20_000) }); if (media.ok) { const downloaded = await media.blob(); if (downloaded.size && (downloaded.type.startsWith('image/') || downloaded.type.startsWith('audio/') || downloaded.type.startsWith('video/') || downloaded.type === 'application/octet-stream')) { blob = kind === 'music' ? await ensurePlayableAudioBlob(downloaded) : downloaded; url = undefined; } } } catch { /* Retain remote URL when cross-origin download is unavailable. */ }
          }
          const lrc = asset.lrc;
          await saveCompletedAsset({ ...asset, id: i ? uid() : asset.id, status: 'completed', blob, url, lrc });
        }
      } else {
        if (!contentType.startsWith(kind === 'image' ? 'image/' : kind === 'video' ? 'video/' : 'audio/') && !contentType.includes('octet-stream')) throw new Error('服务返回了不支持的媒体格式，请检查接口设置。');
        let blob = await response.blob(); if (!blob.size) throw new Error('服务返回了空文件。');
        if (kind === 'music') {
          blob = await ensurePlayableAudioBlob(blob);
        }
        const lrc = asset.lrc;
        await saveCompletedAsset({ ...asset, status: 'completed', blob, lrc });
      }
      notify('创作完成，已加入你的作品库。');
    } catch (error) { await saveAsset({ ...asset, status: 'failed', coverStatus: undefined, error: errorText(error) }); notify(errorText(error)); }
  };
  const deleteAsset = async (id: string) => {
    if (!await confirm('删除这件作品？', '作品及关联歌词将从此浏览器删除。建议先下载备份，此操作无法撤销。')) return;
    try {
      jobs.current.get(`lyrics:${id}`)?.abort();
      jobs.current.get(`cover:${id}`)?.abort();
      if (activeMedia?.id === id) {
        closePlayer();
      }
      revokeAssetMediaURL(id);
      await remove('assets', id);
      assetsRef.current = assetsRef.current.filter(a => a.id !== id);
      setAssets(assetsRef.current);
      notify('作品已删除');
    } catch (error) { persistError(error); }
  };
  const downloadAsset = async (asset: Asset) => {
    const extension = asset.blob?.type.includes('jpeg') ? 'jpg' : asset.blob?.type.includes('webp') ? 'webp' : asset.blob?.type.includes('wav') ? 'wav' : asset.kind === 'image' ? 'png' : asset.kind === 'video' ? 'mp4' : 'mp3';
    const name = `olai-${asset.kind}-${asset.id.slice(0, 8)}.${extension}`;
    if (asset.blob) { downloadBlob(asset.blob, name); }
    else if (asset.url) {
      try { const response = await fetch(safeMediaURL(asset.url), { signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(); downloadBlob(await response.blob(), name); }
      catch { const a = document.createElement('a'); a.href = safeMediaURL(asset.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.download = name; a.click(); notify('已打开原始媒体链接，可在新页面保存。'); }
    }
    if (asset.kind === 'music' && asset.lyrics) downloadLrcBlob(asset.lyrics, `olai-music-${asset.id.slice(0, 8)}.txt`);
    if (asset.kind === 'music' && asset.lrc) {
      downloadLrcBlob(asset.lrc, `olai-music-${asset.id.slice(0, 8)}.lrc`);
    }
    if (asset.kind === 'music' && asset.coverUrl) void downloadCover(asset);
  };
  const downloadCover = async (asset: Asset) => {
    if (!asset.coverUrl) return;
    try {
      const response = await fetch(safeMediaURL(asset.coverUrl), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const extension = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png';
      downloadBlob(blob, `olai-cover-${asset.id.slice(0, 8)}.${extension}`);
    } catch { notify('封面下载失败，请检查原图片链接是否仍可用。'); }
  };
  const exportConversation = () => {
    if (!active) return;
    downloadBlob(new Blob([JSON.stringify({ ...active, model: undefined }, null, 2)], { type: 'application/json' }), `olai-chat-${active.id.slice(0, 8)}.json`); notify('会话已导出为 JSON');
  };
  const retryAsset = (asset: Asset) => { navigate(asset.kind); void generate(asset.kind, asset.prompt, asset.options, asset); };
  const editMusic = (asset: Asset) => {
    if (!asset.song || assetsRef.current.some(a => a.kind === 'music' && a.status === 'pending')) { notify('请等待当前歌曲生成完成后再编辑。'); return; }
    setMusicEdit({ asset, token: uid() });
    navigate('music');
    notify('已载入歌曲段落，修改后生成新作品。');
  };
  const retryCover = (asset: Asset) => {
    if (asset.status !== 'completed' || asset.kind !== 'music' || asset.coverStatus === 'pending' || !requireConnection()) return;
    void saveAsset({ ...asset, options: { ...asset.options, generate_cover: 1 }, coverStatus: 'pending', coverError: undefined });
  };
  const alignMusicLyrics = async (asset: Asset) => {
    const jobId = `lyrics:${asset.id}`;
    if (jobs.current.has(jobId) || !requireConnection()) return;
    const controller = new AbortController();
    jobs.current.set(jobId, controller);
    setAligningIds(ids => [...ids, asset.id]);
    try {
      const result = await alignLyricsToAudio(asset, settingsRef.current.key, settingsRef.current.chatModel, AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]));
      const current = assetsRef.current.find(a => a.id === asset.id);
      if (!current || controller.signal.aborted) return;
      await saveAsset({ ...current, lrc: result.lrc, lrcSource: 'audio', audioDuration: result.duration, lrcError: undefined });
      updateLyrics(asset.id, result.lrc, 'audio');
      notify('歌词已按实际音频校准，可试听检查或下载 LRC。');
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = errorText(error);
      const message = `歌词校准未完成：${detail}${detail.includes('原歌词') ? '' : '。原歌词时间轴已保留。'}`;
      const current = assetsRef.current.find(a => a.id === asset.id);
      if (current) await saveAsset({ ...current, lrcError: message });
      notify(message);
    } finally {
      jobs.current.delete(jobId);
      setAligningIds(ids => ids.filter(id => id !== asset.id));
    }
  };
  const label = view === 'library' ? '我的作品' : 'AI 对话';
  const mediaKind = view === 'image' || view === 'video' || view === 'music' ? view : null;
  const recent = conversations.filter(c => c.title.toLowerCase().includes(sessionSearch.toLowerCase()));

  return <div className="studio-shell">
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
      <div className="sidebar-drawer-header">
        <button className="brand" onClick={() => navigate('chat')} aria-label="小o 首页">
          <BrandLogoSvg size={43} />
          <span className="brand-wordmark"><img src="/brand/olai-wordmark.png" alt="olai" width="585" height="240" /><small>ONLINE AI COMPANION</small></span>
        </button>
      </div>
      <span className="nav-caption">陪伴与灵感</span>
      <nav aria-label="工作室导航">
        {navigation.map(({ view: target, label, icon: IconComponent }) => (
          <button
            key={target}
            className={`nav-item ${view !== 'library' ? 'active' : ''}`}
            onClick={() => navigate(target)}
            aria-current={view !== 'library' ? 'page' : undefined}
          >
            <span className="nav-icon-box">
              <IconComponent size={19} active={view !== 'library'} />
            </span>
            {label}
            {view !== 'library' && <span className="nav-active-dot" />}
          </button>
        ))}
        <div className="nav-separator" />
        <button
          className={`nav-item ${view === 'library' ? 'active' : ''}`}
          onClick={() => navigate('library')}
          aria-current={view === 'library' ? 'page' : undefined}
        >
          <span className="nav-icon-box">
            <CosmicVaultSvg size={19} active={view === 'library'} />
          </span>
          我的作品
          <span className="count-badge">{assets.filter(a => a.status === 'completed').length}</span>
        </button>
      </nav>
      <div className="recent-heading"><span>History</span><button className="icon-button" aria-label="搜索会话" onClick={() => setSearchOpen(!searchOpen)}><Search size={14} /></button></div>
      {searchOpen && <input className="session-search" aria-label="搜索会话标题" placeholder="搜索会话…" value={sessionSearch} onChange={e => setSessionSearch(e.target.value)} autoFocus />}
      <div className="recent-sessions">{recent.length ? recent.map(c => <div key={c.id} className={`session-row ${view === 'chat' && activeId === c.id ? 'selected' : ''}`}>
        <button className="session-link" onClick={() => openConversation(c.id)} title={c.title}><span>{c.title}</span></button><div className="session-actions"><MoreMenu label={`更多会话操作：${c.title}`} items={[{ label: '重命名会话', icon: <Pencil size={15} />, onClick: () => void renameConversation(c) }, { label: '删除会话', icon: <Trash2 size={15} />, danger: true, disabled: chatBusy, onClick: () => void deleteConversation(c) }]} /></div></div>) : <div className="recent-empty"><MessageSquare size={20} strokeWidth={1.5} /><p>{sessionSearch ? '没有匹配的会话' : '还没有开始的对话'}</p><small>{sessionSearch ? '换个关键词试试' : '和小o聊聊，灵感会留在这里'}</small></div>}</div>
      <div className="sidebar-bottom">
        <div className="local-storage-note">
          <ShieldCheck size={15} />
          <div>
            创作数据，本地安全
            <small>{ready && storageMode === 'localstorage' ? '本地缓存持久化' : '隐私驻留于浏览器'}</small>
          </div>
        </div>
        <button className="profile-button" onClick={() => { setSettingsOpen(true); if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarOpen(false); }}>
          <span className="profile-avatar"><BrandLogoSvg size={30} /></span>
          <span>我的小o<small>连接与创作偏好</small></span>
          <SettingsIcon size={16} />
        </button>
      </div>
    </aside>
    <main className={`main-shell ${view !== 'library' ? 'chat-main' : ''}`}>
      <header className="topbar">
        <div className="breadcrumbs">
          <button
            className="icon-button mobile-menu sidebar-toggle-button"
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={19} /> : <Menu size={20} />}
          </button>
          <span className="topbar-brand">Olai 空间</span>
          <span className="breadcrumb-slash">/</span>
          <span>{label}</span>
        </div>
        <div className="topbar-actions">
          <StatusBeaconSvg connected={connected} modelCount={models.length} loading={modelsLoading} />
          <button className="topbar-settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={15} />
            <span>{settings.key || serverKey ? '创作设置' : '连接服务'}</span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>
      {!ready ? (
        <div className="loading-workspace">
          <Companion size={100} animated />
          <span className="loading-track"><i /></span>
          <p>正在准备你的创作空间…</p>
        </div>
      ) : (
        <>
          {view !== 'library' && (
            <ChatWorkspace
              conversation={active}
              busy={chatBusy}
              onSend={text => void sendMessage(text)}
              onStop={() => chatController.current?.abort()}
              onNew={newConversation}
              onRetry={id => void sendMessage('', id)}
              onExport={exportConversation}
              notify={notify}
              kind={mediaKind}
              onModeChange={kind => navigate(kind || 'chat')}
              media={{
                assets: assets.filter(a => a.kind === mediaKind),
                busy: assets.some(a => a.kind === mediaKind && a.status === 'pending'),
                onCompose: async (prompt, style, instrumental) => {
                  if (!requireConnection()) throw new Error('请先连接创作服务，再整理歌曲。');
                  return composeSong(settingsRef.current.key, settingsRef.current.chatModel, prompt, style, instrumental);
                },
                onGenerate: (prompt, options) => { if (mediaKind) void generate(mediaKind, prompt, options); },
                onDelete: id => void deleteAsset(id),
                onRetry: retryAsset,
                onDownload: asset => void downloadAsset(asset),
                onEdit: editMusic,
                editRequest: musicEdit,
                onAlignLyrics: asset => void alignMusicLyrics(asset),
                aligningIds,
                onDownloadCover: asset => void downloadCover(asset),
                onRetryCover: retryCover,
              }}
            />
          )}
          {view === 'library' && (
            <Library
              assets={assets}
              onNavigate={navigate}
              onDelete={id => void deleteAsset(id)}
              onRetry={retryAsset}
              onEdit={editMusic}
              onAlignLyrics={asset => void alignMusicLyrics(asset)}
              aligningIds={aligningIds}
              onDownloadCover={asset => void downloadCover(asset)}
              onRetryCover={retryCover}
              onDownload={asset => void downloadAsset(asset)}
            />
          )}
        </>
      )}
    </main>
    {settingsOpen && (
      <SettingsDialog
        initial={settings}
        serverKey={serverKey}
        models={models}
        loadingModels={modelsLoading}
        onClose={closeSettings}
        onSave={next => changeSettings(next, true)}
        onRefresh={refreshModels}
      />
    )}
    {toast && (
      <div className="toast" role="status">
        <CircleAlert size={17} />
        <span>{toast}</span>
        <button aria-label="关闭通知" onClick={() => setToast('')}><X size={15} /></button>
      </div>
    )}
    {dialog}
    <GlobalMediaPlayer onAlignLyrics={id => { const asset = assetsRef.current.find(a => a.id === id); if (asset) void alignMusicLyrics(asset); }} aligningIds={aligningIds} />
  </div>;
}

export default function Studio({ serverKey = false }: { serverKey?: boolean }) {
  return (
    <PlayerProvider>
      <StudioInner serverKey={serverKey} />
    </PlayerProvider>
  );
}
