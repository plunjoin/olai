import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Clock3, Command, Ellipsis, Film, Globe, LayoutGrid, MessageSquare, PanelLeft, PanelLeftClose, Pencil, Search, Settings as SettingsIcon, SquarePen, Trash2, UserRound, X } from 'lucide-react';
import GithubSvg from './svg/GithubSvg';
import { base64Blob, chat, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { downloadLrcBlob, generateLrcFromPrompt } from '../lib/lrc';
import { ensurePlayableAudioBlob } from '../lib/audio';
import { alignLyricsToAudio, readAudioDuration } from '../lib/lyricAlignment';
import { getAll, initializeStorage, loadSettings, put, remove, saveSettings, syncGuestRecords } from '../lib/storage';
import { isStoredMedia, registerStoredBlob } from '../lib/mediaStorage';
import type { AccountState } from '../lib/account';
import AccountDialog from './AccountDialog';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type ImageEngineMode, type MediaKind, type Settings, type View } from '../lib/types';
import { composeSong, parseSong, songLyrics, sungLines } from '../lib/music';
import { imageDimensions } from '../lib/generation';
import { imageResolutionWarning, readImageResolution } from '../lib/imageResolution';
import { captureVideoCover } from '../lib/videoCover';
import { galleryReuseOptions } from '../lib/galleryDetail';
import type { VideoEngineMode } from '../lib/video';
import BrandLogoSvg from './svg/BrandLogoSvg';
import { CosmicVaultSvg } from './svg/AnimatedIcons';
import StatusBeaconSvg from './svg/StatusBeaconSvg';
import ChatWorkspace from './ChatWorkspace';
import Library from './Library';
import Gallery from './Gallery';
import SettingsDialog from './SettingsDialog';
import GlobalMediaPlayer from './GlobalMediaPlayer';
import Companion from './Companion';
import VideoWorkflowWorkspace from './VideoWorkflowWorkspace';
import useDialogs from './ui/useDialogs';
import MoreMenu from './ui/MoreMenu';
import { PlayerProvider, revokeAssetMediaURL, usePlayer } from '../lib/playerContext';

const navigation = [
  { view: 'workflow' as const, label: '短片工坊', icon: Film, badge: 'Beta' },
];
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

const VALID_VIEWS: readonly View[] = ['home', 'chat', 'image', 'video', 'music', 'library', 'gallery', 'workflow'] as const;

// 短片工坊（视频工作流）为封闭内测，默认关闭；关闭时任何入口都回落到 AI 对话。
function gateView(view: View, shortFilm: boolean): View {
  return view === 'workflow' && !shortFilm ? 'chat' : view;
}

function parseLocation(shortFilm = true): { view: View; conversationId?: string } {
  if (typeof window === 'undefined') return { view: 'chat' };
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (VALID_VIEWS.includes(hash as View)) {
    return { view: gateView(hash === 'home' ? 'chat' : hash as View, shortFilm) };
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
    return { view: gateView(first as View, shortFilm) };
  }
  return { view: 'chat' };
}

function buildUrl(targetView: View, conversationId?: string): string {
  if (targetView === 'home') return '/';
  if (targetView === 'chat' && conversationId) return `/chat/${encodeURIComponent(conversationId)}`;
  if (targetView === 'chat') return '/';
  return `/${targetView}`;
}

function StudioInner({ serviceReady = false, imageEngineMode, videoEngineMode, shortFilm = false }: { serviceReady?: boolean; imageEngineMode?: ImageEngineMode; videoEngineMode?: VideoEngineMode; shortFilm?: boolean }) {
  const { confirm, prompt, dialog } = useDialogs();
  const { activeMedia, close: closePlayer, updateLyrics, updateCover } = usePlayer();
  const [view, setView] = useState<View>(() => {
    if (typeof window !== 'undefined') return parseLocation(shortFilm).view;
    return 'chat';
  });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [account, setAccount] = useState<AccountState>({ user: null, generationLimit: 1 });
  const [accountOpen, setAccountOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFailures, setSyncFailures] = useState<string[]>([]);
  const syncingRef = useRef(false);
  const importedRef = useRef({ conversations: new Set<string>(), assets: new Set<string>() });
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
      try { localStorage.setItem('olai.sidebar', String(next)); } catch { }
      return next;
    });
  };
  const [conversations, setConversations] = useState<Conversation[]>([]); const [assets, setAssets] = useState<Asset[]>([]);
  const [musicEdit, setMusicEdit] = useState<{ asset: Asset; token: string }>();
  const [creationDraft, setCreationDraft] = useState<{ token: string; prompt: string; options: Record<string, string | number> } | null>(null);
  const [aligningIds, setAligningIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const loc = parseLocation(shortFilm);
      if (loc.conversationId) return loc.conversationId;
      return localStorage.getItem('olai.active') || localStorage.getItem('studio.active') || '';
    }
    return '';
  });
  const [ready, setReady] = useState(false); const [chatBusy, setChatBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false); const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(''); const [sessionSearch, setSessionSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const assetsRef = useRef<Asset[]>([]); const conversationsRef = useRef<Conversation[]>([]); const settingsRef = useRef(settings);
  const chatController = useRef<AbortController | null>(null); const jobs = useRef(new Map<string, AbortController>()); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Existing videos get one frame-capture attempt per session.
  const videoCoverAttempts = useRef(new Set<string>());
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const persistError = (error: unknown) => notify(`保存失败：${errorText(error)}。请下载重要内容备份。`);
  const runGuestSync = async (userId: string) => {
    if (syncingRef.current) return;
    syncingRef.current = true; setSyncing(true);
    // Merge only newly imported records; keep edits and deletions made while uploading.
    const knownChats = new Set(conversationsRef.current.map(c => c.id));
    const knownAssets = new Set(assetsRef.current.map(a => a.id));
    const chatSnapshots = new Map(conversationsRef.current.map(c => [c.id, c]));
    const assetSnapshots = new Map(assetsRef.current.map(a => [a.id, a]));
    try {
      const report = await syncGuestRecords(userId);
      setSyncFailures(report.failures);
      if (!report.failures.length) notify('本地数据与云端附件已同步。');
      for (const id of report.synced.conversations) importedRef.current.conversations.add(id);
      for (const id of report.synced.assets) importedRef.current.assets.add(id);
      if (importedRef.current.conversations.size || importedRef.current.assets.size) {
        const [chats, works] = await Promise.all([getAll<Conversation>('conversations'), getAll<Asset>('assets')]);
        const newChats = chats.filter(c => importedRef.current.conversations.has(c.id) && !knownChats.has(c.id) && !conversationsRef.current.some(current => current.id === c.id));
        conversationsRef.current = [...conversationsRef.current.map(c => importedRef.current.conversations.has(c.id) && chatSnapshots.get(c.id) === c ? chats.find(row => row.id === c.id) || c : c), ...newChats].sort((a, b) => b.updatedAt - a.updatedAt);
        setConversations(conversationsRef.current);
        const newWorks = works.filter(a => importedRef.current.assets.has(a.id) && !knownAssets.has(a.id) && !assetsRef.current.some(current => current.id === a.id));
        const recovered = newWorks.map(a => a.status === 'pending' && !(a.kind === 'video' && a.remoteId) ? { ...a, status: 'failed' as const, error: '上次请求被中断，请点击重试。' } : a);
        assetsRef.current = [...assetsRef.current.map(a => importedRef.current.assets.has(a.id) && assetSnapshots.get(a.id) === a ? works.find(row => row.id === a.id) || a : a), ...recovered].sort((a, b) => b.createdAt - a.createdAt);
        setAssets(assetsRef.current);
        importedRef.current.conversations.clear(); importedRef.current.assets.clear();
        for (const asset of recovered) if (asset.status === 'failed') void put('assets', asset).catch(persistError);
      }
    } catch (error) {
      setSyncFailures(previous => [...previous, `游客记录后台同步未完成，本地内容已保留。${error instanceof Error ? error.message : '请重试。'}`]);
    } finally { syncingRef.current = false; setSyncing(false); }
  };
  const openAccount = () => {
    if (!ready) return;
    if (chatController.current || assetsRef.current.some(a => a.status === 'pending') || jobs.current.size || aligningIds.length) { notify('请先等待创作完成或停止当前回答，再切换账号。'); return; }
    setAccountOpen(true);
  };
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
    next = gateView(next, shortFilm);
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
  }, [activeId, shortFilm]);
  useEffect(() => {
    const onLocationChange = () => {
      const loc = parseLocation(shortFilm);
      setView(loc.view);
      if (loc.view === 'chat' && loc.conversationId) {
        setActiveId(loc.conversationId);
      }
      // 封闭内测关闭时，把遗留的 /workflow 地址归一化回首页，避免地址栏停在未开放的路由上。
      if (!shortFilm) {
        const first = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
        const hash = window.location.hash.replace(/^#\/?/, '').trim();
        if (first === 'workflow' || hash === 'workflow') window.history.replaceState(null, '', buildUrl('chat'));
      }
    };
    onLocationChange();
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);

    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.replace(/^#\/?/, '').trim();
      if (VALID_VIEWS.includes(hash as View)) {
        window.history.replaceState(null, '', buildUrl(gateView(hash as View, shortFilm)));
      }
    }

    void (async () => {
      try {
        const saved = loadSettings(); settingsRef.current = saved; setSettings(saved);
        let accountState: AccountState = { user: null, generationLimit: 1 };
        try {
          accountState = await initializeStorage();
        } catch (accountError) {
          console.warn('账号状态初始化失败，切换为本地模式:', accountError);
          notify(`账号服务未就绪，已切换为本地离线模式（${errorText(accountError)}）`);
        }
        setAccount(accountState);
        const [chats, works] = await Promise.all([getAll<Conversation>('conversations'), getAll<Asset>('assets')]);
        const restored = (chats || []).map(c => ({
          ...c,
          messages: Array.isArray(c?.messages) ? c.messages.map(m => m.role === 'assistant' && !m.content && !m.error ? { ...m, interrupted: true } : m) : []
        })).sort((a, b) => b.updatedAt - a.updatedAt);
        conversationsRef.current = restored; setConversations(restored);
        const currentLoc = parseLocation(shortFilm);
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
        setReady(true);
        if (accountState.user) void runGuestSync(accountState.user.id);
      } catch (error) { const message = `读取数据失败：${errorText(error)}`; setLoadError(message); notify(message); }
    })();
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
      chatController.current?.abort();
      jobs.current.forEach(c => c.abort());
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => { if (activeId) { try { localStorage.setItem('olai.active', activeId); } catch { /* Session still works in memory. */ } } }, [activeId]);

  const changeSettings = (next: Settings, showToast = false) => {
    settingsRef.current = next; setSettings(next);
    try { saveSettings(next); if (showToast) { notify('设置已保存'); setSettingsOpen(false); } } catch (error) { persistError(error); }
  };
  const refreshConnection = async (announce = true) => {
    if (modelsLoading) return;
    setModelsLoading(true);
    try {
      const response = await request('status');
      const status = await response.json();
      setConnected(status.ready === true);
      if (announce) notify(status.ready ? '创作服务已连接。' : '创作服务尚未就绪，请联系服务提供方。');
    } catch (error) { setConnected(false); notify(errorText(error)); }
    finally { setModelsLoading(false); }
  };
  useEffect(() => { if (ready) void refreshConnection(false); }, [ready]);
  const requireConnection = () => { if (!serviceReady) { notify('创作服务尚未就绪，请联系服务提供方。'); return false; } return true; };
  const newConversation = useCallback(() => {
    if (chatController.current) { notify('请先停止当前回答，再创建会话。'); return; }
    const now = Date.now(); const conversation: Conversation = { id: uid(), title: '新的灵感', createdAt: now, updatedAt: now, messages: [] };
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
    if (!await confirm('删除这段会话？', `「${conversation.title}」和其中的消息将从${account.user ? '你的账号' : '此浏览器'}删除，此操作无法撤销。`)) return;
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
      conversation = { id: uid(), title: text.slice(0, 26), createdAt: now, updatedAt: now, messages: [] };
      setActiveId(conversation.id);
      navigate('chat', conversation.id, true);
    }
    let history = [...conversation.messages];
    if (retryId) { const index = history.findIndex(m => m.id === retryId); if (index < 0) return; history = history.slice(0, index); }
    else history.push({ id: uid(), role: 'user', content: text });
    const assistant = { id: uid(), role: 'assistant' as const, content: '' };
    let running = { ...conversation, title: conversation.messages.length ? conversation.title : text.slice(0, 26) || conversation.title, updatedAt: now, messages: [...history, assistant] };
    const controller = new AbortController(); chatController.current = controller; setChatBusy(true); saveConversation(running);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await chat(history, config.temperature, controller.signal, delta => {
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
  const pollVideo = async (original: Asset) => {
    if (!original.remoteId || jobs.current.has(original.id)) return;
    const controller = new AbortController(); jobs.current.set(original.id, controller);
    try {
      for (let attempt = 0; attempt < 240; attempt++) {
        const response = await request(`videos/${encodeURIComponent(original.remoteId)}`, { signal: controller.signal });
        const video = await response.json();
        if (video.status === 'failed') throw new Error(video.error?.message || video.error || '视频生成失败，请重试。');
        if (video.status === 'completed') {
          let blob: Blob;
          try { blob = await videoContent(original.remoteId, controller.signal); }
          catch (error) {
            if ((error as Error & { status?: number }).status !== 409) throw error;
            await delay(5000, controller.signal); continue;
          }
          await saveCompletedAsset({ ...original, status: 'completed', blob, url: undefined, error: undefined }); notify('你的视频已生成，去看看吧。'); return;
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
    if (ready && serviceReady) for (const asset of assets) if (asset.kind === 'video' && asset.status === 'pending' && asset.remoteId && !jobs.current.has(asset.id)) void pollVideo(asset);
  }, [ready, serviceReady, assets]);
  const generateMusicCover = async (original: Asset) => {
    const jobId = `cover:${original.id}`;
    if (jobs.current.has(jobId) || original.kind !== 'music' || original.status !== 'completed') return;
    const controller = new AbortController();
    jobs.current.set(jobId, controller);
    try {
      const response = await request('generate/image', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), body: JSON.stringify({ action: 'cover', song: original.song, prompt: original.prompt, inspiration: original.options.inspiration, lyrics: original.lyrics }) });
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
      if (/^https?:/.test(coverUrl) && !isStoredMedia(coverUrl)) {
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
    if (ready && serviceReady) for (const asset of assets) if (asset.kind === 'music' && asset.status === 'completed' && asset.coverStatus === 'pending') void generateMusicCover(asset);
  }, [ready, serviceReady, assets]);
  const captureStoredVideoCover = async (original: Asset) => {
    const jobId = `videocover:${original.id}`;
    if (jobs.current.has(jobId) || videoCoverAttempts.current.has(original.id)) return;
    if (original.kind !== 'video' || original.status !== 'completed' || original.coverUrl) return;
    const source = original.blob || original.url;
    if (!source) return;
    videoCoverAttempts.current.add(original.id);
    const controller = new AbortController();
    jobs.current.set(jobId, controller);
    try {
      const coverUrl = await captureVideoCover(source);
      if (controller.signal.aborted) return;
      const current = assetsRef.current.find(asset => asset.id === original.id);
      if (!current || current.coverUrl) return;
      await saveAsset({ ...current, coverUrl, coverStatus: 'completed', coverError: undefined });
    } catch { /* Keep the gradient poster; the next session tries once more. */ }
    finally { jobs.current.delete(jobId); }
  };
  useEffect(() => {
    if (!ready || !serviceReady) return;
    const target = assets.find(asset =>
      asset.kind === 'video' && asset.status === 'completed' && !asset.coverUrl
      && (asset.blob || asset.url) && !videoCoverAttempts.current.has(asset.id));
    if (target) void captureStoredVideoCover(target);
  }, [ready, serviceReady, assets]);
  const saveCompletedAsset = async (asset: Asset) => {
    let resolutionWarning: string | undefined;
    if (asset.kind === 'image' && (asset.blob || asset.url)) {
      try {
        const resolution = await readImageResolution(asset.blob || asset.url!);
        asset.imageWidth = resolution.width;
        asset.imageHeight = resolution.height;
        resolutionWarning = imageResolutionWarning(resolution, asset.options.image_size);
      } catch { /* Keep the original image when its dimensions cannot be read. */ }
    }
    if (asset.kind === 'music' && asset.song && !asset.song.instrumental && asset.blob) {
      try {
        asset.audioDuration = await readAudioDuration(asset.blob);
        asset.lrc = generateLrcFromPrompt(sungLines(asset.song), asset.audioDuration, asset.song.title);
      } catch { /* Keep the clearly labelled estimate if metadata cannot be read. */ }
    }
    // Videos get a real frame as their card cover; the gradient stays as a fallback.
    if (asset.kind === 'video' && (asset.blob || asset.url)) {
      try {
        asset.coverUrl = await captureVideoCover(asset.blob || asset.url!);
        asset.coverStatus = 'completed';
        asset.coverError = undefined;
      } catch { /* Keep the gradient poster when the frame cannot be read. */ }
    }
    await saveAsset(asset);
    return resolutionWarning;
  };
  const generate = async (kind: MediaKind, prompt: string, options: Record<string, string | number>, retry?: Asset) => {
    if (!requireConnection() || !prompt.trim()) return;
    if (assetsRef.current.some(a => a.kind === kind && a.status === 'pending' && a.id !== retry?.id)) { notify('同类型作品正在生成，请等待完成。'); return; }
    const config = { ...settingsRef.current };
    const asset: Asset = { id: retry?.id || uid(), kind, prompt, options, createdAt: Date.now(), status: 'pending' };
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
        response = await generateVideo({ prompt, options, mode: videoEngineMode });
      } else if (kind === 'image') {
        response = await generateImage({
          prompt,
          mode: imageEngineMode || config.imageEngineMode || 'auto',
          size: imageDimensions(String(options.aspect_ratio || 'auto'), String(options.image_size || '1K')),
          aspectRatio: String(options.aspect_ratio || 'auto'),
          imageSize: String(options.image_size || '1K'),
          reasoningEffort: String(options.reasoning_effort || 'medium'),
          n: typeof options.n === 'number' ? options.n : 1,
        });
      } else {
        let extra = {};
        try { extra = JSON.parse(config.musicExtra || '{}'); } catch { }
        response = await generateAudio({
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
      let resolutionWarning: string | undefined;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await response.json();
        if (kind === 'video' && json.status === 'failed') throw new Error(json.errors?.[0]?.message || '视频生成失败，请重试。');
        if (kind === 'video' && videoEngineMode === 'task') {
          if (typeof json.id !== 'string' || !json.id || !['queued', 'pending', 'in_progress', 'processing', 'completed'].includes(json.status)) throw new Error('暂未收到视频任务，请重试或检查服务连接。');
          const task = { ...asset, remoteId: json.id }; await saveAsset(task); void pollVideo(task); return;
        }
        const outputs = mediaOutputs(json, kind);
        if (!outputs.length) throw new Error(kind === 'music' ? '暂未收到音乐文件，请重试或检查服务连接。' : kind === 'video' ? '暂未收到视频文件，请重试或检查服务连接。' : '暂未收到图片，请重试或检查服务连接。');
        for (let i = 0; i < outputs.length; i++) {
          const output = outputs[i]; let blob: Blob | undefined; let url: string | undefined;
          if (output.base64) blob = base64Blob(output.base64, output.mime);
          else if (output.url) {
            const mediaUrl = safeMediaURL(output.url);
            url = mediaUrl;
            try { const media = await fetch(mediaUrl, { signal: AbortSignal.timeout(20_000) }); if (media.ok) { const downloaded = await media.blob(); if (downloaded.size && (downloaded.type.startsWith('image/') || downloaded.type.startsWith('audio/') || downloaded.type.startsWith('video/') || downloaded.type === 'application/octet-stream')) { blob = kind === 'music' ? await ensurePlayableAudioBlob(downloaded) : downloaded; if (isStoredMedia(output.url)) registerStoredBlob(blob, output.url); else url = undefined; } } } catch { /* Retain remote URL when cross-origin download is unavailable. */ }
          }
          const lrc = asset.lrc;
          const warning = await saveCompletedAsset({ ...asset, id: i ? uid() : asset.id, status: 'completed', blob, url, lrc });
          resolutionWarning ||= warning;
        }
      } else {
        if (!contentType.startsWith(kind === 'image' ? 'image/' : kind === 'video' ? 'video/' : 'audio/') && !contentType.includes('octet-stream')) throw new Error('服务返回了不支持的媒体格式，请检查接口设置。');
        let blob = await response.blob(); if (!blob.size) throw new Error('服务返回了空文件。');
        if (kind === 'music') {
          blob = await ensurePlayableAudioBlob(blob);
        }
        const lrc = asset.lrc;
        resolutionWarning = await saveCompletedAsset({ ...asset, status: 'completed', blob, lrc });
      }
      notify(resolutionWarning ? `${resolutionWarning} 原图已保存到作品库。` : '创作完成，已加入你的作品库。');
    } catch (error) { await saveAsset({ ...asset, status: 'failed', coverStatus: undefined, error: errorText(error) }); notify(errorText(error)); }
  };
  const deleteAsset = async (id: string) => {
    if (!await confirm('删除这件作品？', `作品及关联歌词将从${account.user ? '你的账号' : '此浏览器'}删除。建议先下载备份，此操作无法撤销。`)) return;
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
  const reuseGalleryAsset = (asset: Asset, prompt: string) => {
    setCreationDraft({ token: uid(), prompt, options: galleryReuseOptions(asset) });
    navigate(asset.kind);
    notify('已载入作品参数，可直接生成。');
  };
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
      const result = await alignLyricsToAudio(asset, AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]));
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
  const label = view === 'gallery' ? '作品广场' : view === 'library' ? '我的库' : view === 'workflow' ? '短片工坊' : 'AI 对话';
  const mediaKind = view === 'image' || view === 'video' || view === 'music' ? view : null;
  const recent = conversations.filter(c => c.title.toLowerCase().includes(sessionSearch.toLowerCase()));
  const HISTORY_PREVIEW = 5;
  const visibleRecent = historyExpanded || sessionSearch || searchOpen ? recent : recent.slice(0, HISTORY_PREVIEW);
  const hasMoreHistory = !historyExpanded && !sessionSearch && !searchOpen && recent.length > HISTORY_PREVIEW;
  const completedAssets = assets.filter(a => a.status === 'completed').length;
  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarOpen(false);
  };
  const focusHistorySearch = () => {
    setSidebarOpen(true);
    setSearchOpen(true);
    try { localStorage.setItem('olai.sidebar', 'true'); } catch { /* ignore */ }
  };
  const chatActive = view === 'chat' || view === 'image' || view === 'video' || view === 'music';
  const profileName = account.user?.email?.split('@')[0] || '访客';
  const profileMeta = account.user ? '已同步' : `各 ${account.generationLimit} 次 / 天 · 对话 ${account.chatLimit ?? 100} 条`;

  return <div className="studio-shell">
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`} aria-label="侧边栏">
      {/* 折叠轨：仅图标导航 */}
      <div className="sidebar-rail" aria-hidden={sidebarOpen}>
        <button type="button" className="rail-btn rail-open" onClick={toggleSidebar} aria-label="打开边栏">
          <PanelLeft size={20} />
          <span className="rail-tip" aria-hidden="true">打开边栏</span>
        </button>
        <button type="button" className="rail-btn rail-brand" onClick={() => navigate('chat')} aria-label="小o 首页">
          <BrandLogoSvg size={28} />
          <span className="rail-tip" aria-hidden="true">小o</span>
        </button>
        <nav className="rail-nav" aria-label="快捷导航">
          <button type="button" className="rail-btn" onClick={newConversation} disabled={chatBusy} aria-label="发起新对话">
            <SquarePen size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">{chatBusy ? '请先停止当前回答' : '发起新对话'}</span>
          </button>
          <button type="button" className="rail-btn" onClick={focusHistorySearch} aria-label="搜索会话">
            <Search size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">搜索会话</span>
          </button>
          <button type="button" className={`rail-btn ${view === 'gallery' ? 'active' : ''}`} onClick={() => navigate('gallery')} aria-label="作品广场" aria-current={view === 'gallery' ? 'page' : undefined}>
            <Globe size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">作品广场</span>
          </button>
          <button
            type="button"
            className={`rail-btn ${view === 'library' ? 'active' : ''}`}
            onClick={() => navigate('library')}
            aria-label="我的库"
            aria-current={view === 'library' ? 'page' : undefined}
          >
            <LayoutGrid size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">我的库</span>
          </button>
          <button type="button" className={`rail-btn ${chatActive ? 'active' : ''}`} onClick={() => { setSidebarOpen(true); navigate('chat'); }} aria-label="最近">
            <Clock3 size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">最近</span>
          </button>
          {(shortFilm ? navigation : []).map(({ view: target, label: itemLabel, icon: IconComponent }) => (
            <button
              key={target}
              type="button"
              className={`rail-btn ${view === target ? 'active' : ''}`}
              onClick={() => navigate(target)}
              aria-label={itemLabel}
              aria-current={view === target ? 'page' : undefined}
            >
              <IconComponent size={20} strokeWidth={1.75} />
              <span className="rail-tip" aria-hidden="true">{itemLabel}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button type="button" className="rail-btn" onClick={() => setSettingsOpen(true)} aria-label="创作设置">
            <SettingsIcon size={20} strokeWidth={1.75} />
            <span className="rail-tip" aria-hidden="true">创作设置</span>
          </button>
          <button type="button" className="rail-avatar" disabled={!ready} onClick={openAccount} aria-label={account.user ? `我的账号 · ${profileName}` : '登录 / 注册'}>
            <span className="rail-avatar-media"><BrandLogoSvg size={26} /></span>
            <span className="rail-tip" aria-hidden="true">{account.user ? `我的账号 · ${profileName}` : '登录 / 注册'}</span>
          </button>
        </div>
      </div>

      {/* 展开面板 */}
      <div className="sidebar-panel">
        <div className="sidebar-drawer-header">
          <button className="brand" onClick={() => navigate('chat')} aria-label="小o 首页">
            <BrandLogoSvg size={32} />
            <span className="brand-wordmark"><img src="/brand/olai-wordmark.png" alt="olai" width="585" height="240" /></span>
          </button>
          <div className="sidebar-header-actions">
            <button type="button" className="icon-button" aria-label="搜索会话" aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>
              <Search size={18} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-button sidebar-panel-toggle"
              aria-label="收起侧边栏"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
              title="收起侧边栏"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        <nav aria-label="主导航">
          <button
            type="button"
            className="nav-item nav-new-chat"
            onClick={newConversation}
            disabled={chatBusy}
            title={chatBusy ? '请先停止当前回答，再发起新对话' : '发起新对话'}
          >
            <span className="nav-icon-box"><SquarePen size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">发起新对话</span>
          </button>

          <button
            type="button"
            className={`nav-item ${view === 'gallery' ? 'active' : ''}`}
            onClick={() => { navigate('gallery'); closeSidebarOnMobile(); }}
            aria-current={view === 'gallery' ? 'page' : undefined}
          >
            <span className="nav-icon-box"><Globe size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">作品广场</span>
          </button>

          <button
            type="button"
            className={`nav-item ${view === 'library' ? 'active' : ''}`}
            onClick={() => { navigate('library'); closeSidebarOnMobile(); }}
            aria-current={view === 'library' ? 'page' : undefined}
          >
            <span className="nav-icon-box"><LayoutGrid size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">我的库</span>
            {completedAssets > 0 && <span className="count-badge">{completedAssets}</span>}
          </button>

          <button
            type="button"
            className={`nav-item ${chatActive ? 'active' : ''}`}
            onClick={() => { navigate('chat'); closeSidebarOnMobile(); }}
            aria-current={chatActive ? 'page' : undefined}
          >
            <span className="nav-icon-box"><Clock3 size={18} strokeWidth={1.75} /></span>
            <span className="nav-label">最近</span>
          </button>

          {(shortFilm ? navigation : []).map(({ view: target, label: itemLabel, icon: IconComponent, badge }) => (
            <button
              key={target}
              type="button"
              className={`nav-item ${view === target ? 'active' : ''}`}
              onClick={() => { navigate(target); closeSidebarOnMobile(); }}
              aria-current={view === target ? 'page' : undefined}
            >
              <span className="nav-icon-box"><IconComponent size={18} strokeWidth={1.75} /></span>
              <span className="nav-label">{itemLabel}</span>
              {badge && <span className="nav-new">{badge}</span>}
            </button>
          ))}

          <MoreMenu
            label="更多"
            className="sidebar-more-trigger nav-more"
            triggerIcon={<><span className="nav-icon-box"><Ellipsis size={18} strokeWidth={1.75} /></span><span className="nav-label sidebar-more-label">更多</span></>}
            items={[
              { label: 'AI 对话', icon: <MessageSquare size={15} />, onClick: () => { navigate('chat'); closeSidebarOnMobile(); } },
              { label: '创作设置', icon: <SettingsIcon size={15} />, onClick: () => { setSettingsOpen(true); closeSidebarOnMobile(); } },
              { label: account.user ? '我的账号' : '登录 / 注册', icon: <UserRound size={15} />, disabled: !ready, onClick: () => { openAccount(); closeSidebarOnMobile(); } },
            ]}
          />
        </nav>

        <div className="history-section">
          <button type="button" className="history-section-toggle" onClick={() => setHistoryExpanded(v => !v)} aria-expanded={historyExpanded}>
            <span>全部</span>
            <ChevronRight size={16} className={historyExpanded ? 'is-open' : ''} />
          </button>
          {searchOpen && (
            <input
              className="session-search"
              aria-label="搜索会话标题"
              placeholder="搜索会话…"
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              autoFocus
            />
          )}
          <div className="recent-sessions">
            {visibleRecent.length ? visibleRecent.map(c => (
              <div key={c.id} className={`session-row ${view === 'chat' && activeId === c.id ? 'selected' : ''}`}>
                <button type="button" className="session-link" onClick={() => { openConversation(c.id); closeSidebarOnMobile(); }} title={c.title}>
                  <span>{c.title}</span>
                </button>
                <div className="session-actions">
                  <MoreMenu
                    label={`更多会话操作：${c.title}`}
                    items={[
                      { label: '重命名会话', icon: <Pencil size={15} />, onClick: () => void renameConversation(c) },
                      { label: '删除会话', icon: <Trash2 size={15} />, danger: true, disabled: chatBusy, onClick: () => void deleteConversation(c) },
                    ]}
                  />
                </div>
              </div>
            )) : (
              <div className="recent-empty">
                <MessageSquare size={20} strokeWidth={1.5} />
                <p>{sessionSearch ? '没有匹配的会话' : '还没有开始的对话'}</p>
                <small>{sessionSearch ? '换个关键词试试' : '和小o聊聊，灵感会留在这里'}</small>
              </div>
            )}
            {hasMoreHistory && (
              <button type="button" className="history-more" onClick={() => setHistoryExpanded(true)}>
                显示更多
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button
            type="button"
            className="profile-button"
            disabled={!ready}
            onClick={() => { openAccount(); closeSidebarOnMobile(); }}
          >
            <span className="profile-avatar"><BrandLogoSvg size={28} /></span>
            <span>
              {profileName}
              <small>{profileMeta}</small>
            </span>
          </button>
          <button
            type="button"
            className="icon-button profile-settings"
            aria-label="创作设置"
            title="创作设置"
            onClick={() => { setSettingsOpen(true); closeSidebarOnMobile(); }}
          >
            <SettingsIcon size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
    <main className={`main-shell ${view !== 'library' && view !== 'gallery' && view !== 'workflow' ? 'chat-main' : ''}`}>
      <header className="topbar">
        <div className="breadcrumbs">
          <button
            className="icon-button mobile-menu sidebar-toggle-button"
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeft size={20} />}
          </button>
          <span className="topbar-brand">Olai 空间</span>
          <span className="breadcrumb-slash">/</span>
          <span>{label}</span>
        </div>
        <div className="topbar-actions">
          <a
            className="topbar-github"
            href="https://github.com/plunjoin/olai"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub: plunjoin/olai"
            aria-label="GitHub: plunjoin/olai"
          >
            <GithubSvg size={16} />
          </a>
          <button className="topbar-settings" disabled={!ready} onClick={openAccount}><span>{account.user ? '我的账号' : '登录 / 注册'}</span></button>
          <StatusBeaconSvg connected={connected} loading={modelsLoading} />
          <button className="topbar-settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={15} />
            <span>创作设置</span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>
      {/* 广场只依赖公开接口，不必等待账号与个人记录加载完成。 */}
      {!ready && view !== 'gallery' ? (
        <div className="loading-workspace">
          <Companion size={100} animated />
          <span className="loading-track"><i /></span>
          <p>{loadError || '正在准备你的创作空间…'}</p>
          {loadError && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="secondary-button" onClick={() => window.location.reload()}>重新加载</button>
              <button className="secondary-button" onClick={() => { setReady(true); setLoadError(''); }}>以游客模式进入</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {account.user && (syncing || syncFailures.length > 0) && <div className="guest-sync-notice" role="status">
            <span>{syncing ? '正在后台同步游客记录，可继续创作。' : `${syncFailures.length} 条游客记录同步未完成，内容仍保留在本地，可继续创作。`}</span>
            {syncFailures.length > 0 && <button className="secondary-button" disabled={syncing} onClick={() => void runGuestSync(account.user!.id)}>重试同步</button>}
          </div>}
          {view !== 'library' && view !== 'gallery' && view !== 'workflow' && (
            <ChatWorkspace
              cloudStorage={!!account.user}
              conversation={active}
              busy={chatBusy}
              onSend={text => void sendMessage(text)}
              onStop={() => chatController.current?.abort()}
              onRetry={id => void sendMessage('', id)}
              onExport={exportConversation}
              notify={notify}
              kind={mediaKind}
              draftRequest={creationDraft}
              onDraftConsumed={() => setCreationDraft(null)}
              onModeChange={kind => navigate(kind || 'chat')}
              media={{
                imageEngineMode: imageEngineMode || settings.imageEngineMode,
                videoEngineMode,
                assets: assets.filter(a => a.kind === mediaKind),
                busy: assets.some(a => a.kind === mediaKind && a.status === 'pending'),
                onCompose: async (prompt, style, instrumental) => {
                  if (!requireConnection()) throw new Error('请先连接创作服务，再整理歌曲。');
                  return composeSong(prompt, style, instrumental);
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
          {view === 'gallery' && <Gallery onNavigate={navigate} onDownload={asset => void downloadAsset(asset)} onReuse={reuseGalleryAsset} />}
          {view === 'library' && (
            <Library
              assets={assets}
              cloudStorage={!!account.user}
              onLogin={openAccount}
              onNavigate={navigate}
              onDelete={id => void deleteAsset(id)}
              onRetry={retryAsset}
              onEdit={editMusic}
              onAlignLyrics={asset => void alignMusicLyrics(asset)}
              aligningIds={aligningIds}
              onDownloadCover={asset => void downloadCover(asset)}
              onRetryCover={retryCover}
              onDownload={asset => void downloadAsset(asset)}
              onReuse={reuseGalleryAsset}
            />
          )}
          {view === 'workflow' && shortFilm && (
            <VideoWorkflowWorkspace
              videoEngineMode={videoEngineMode}
              generationLimit={account.generationLimit}
              onRequestQuota={async (kind, count) => {
                const confirmed = await confirm(
                  '确认生成',
                  `生成 ${count} 个${kind === 'image' ? '关键帧' : kind === 'video' ? '视频' : '配乐'}将消耗 ${count} 次${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音乐'}额度。今日剩余：${account.generationLimit} 次。\n\n是否继续？`,
                  '开始生成'
                );
                return confirmed;
              }}
              onError={notify}
            />
          )}
        </>
      )}
    </main>
    {settingsOpen && (
      <SettingsDialog
        cloudStorage={!!account.user}
        initial={settings}
        loading={modelsLoading}
        onClose={closeSettings}
        onSave={next => changeSettings(next, true)}
        onRefresh={() => refreshConnection()}
      />
    )}
    {accountOpen && <AccountDialog account={account} syncing={syncing} syncFailures={syncFailures} onRetrySync={() => { if (account.user) void runGuestSync(account.user.id); }} onClose={() => setAccountOpen(false)} />}
    {toast && (
      <div className="toast" role="status">
        <CircleAlert size={17} />
        <span>{toast}</span>
        <button aria-label="关闭通知" onClick={() => setToast('')}><X size={15} /></button>
      </div>
    )}
    {dialog}
    <GlobalMediaPlayer onAlignLyrics={activeMedia && assets.some(a => a.id === activeMedia.id) ? id => { const asset = assetsRef.current.find(a => a.id === id); if (asset) void alignMusicLyrics(asset); } : undefined} aligningIds={aligningIds} />
  </div>;
}

export default function Studio({ serviceReady = false, imageEngineMode, videoEngineMode, shortFilm = false }: { serviceReady?: boolean; imageEngineMode?: ImageEngineMode; videoEngineMode?: VideoEngineMode; shortFilm?: boolean }) {
  return (
    <PlayerProvider>
      <StudioInner serviceReady={serviceReady} imageEngineMode={imageEngineMode} videoEngineMode={videoEngineMode} shortFilm={shortFilm} />
    </PlayerProvider>
  );
}
