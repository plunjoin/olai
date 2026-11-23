import { computed, ref, shallowRef } from 'vue';
import {
  base64Blob, chat, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent,
} from '../lib/api';
import { accountRequest, type AccountState } from '../lib/account';
import { alignLyricsToAudio, readAudioDuration } from '../lib/lyricAlignment';
import { ensurePlayableAudioBlob } from '../lib/audio';
import { generateLrcFromPrompt } from '../lib/lrc';
import { getAll, initializeStorage, loadSettings, put, remove, saveSettings, setAssetVisibility, syncGuestRecords } from '../lib/storage';
import { isStoredMedia, registerStoredBlob } from '../lib/mediaStorage';
import { composeSong, parseSong, songLyrics, sungLines } from '../lib/music';
import { imageDimensions } from '../lib/generation';
import { imageResolutionWarning, readImageResolution } from '../lib/imageResolution';
import { referenceImageBlob } from '../lib/imageReference';
import { captureVideoCover } from '../lib/videoCover';
import { DEFAULT_SETTINGS, type Asset, type Conversation, type ConversationKind, type CreationMeta, type Message, type MediaKind, type PublicModel, type Settings } from '../lib/types';
import { DEFAULT_MEMORY_STATE, extractMemories, loadMemoryState, type MemoryState } from '../lib/memory';
import { loadStatus, DEFAULT_STATUS, type StatusState } from '../lib/status';
import { t } from '../lib/i18n';
import { generateTitle } from '../lib/titles';
import { notify, uid, downloadBlob } from './ui';
import { confirmAction } from './dialog';
import { close as closePlayer, activeMedia } from './player';

export const ready = ref(false);
export const loadError = ref('');
export const account = ref<AccountState>({ user: null, generationLimit: 1 });
export const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
/** Account-scoped long-term memory, shared by the settings dialog and chat. */
export const memoryState = ref<MemoryState>({ ...DEFAULT_MEMORY_STATE, memories: [] });
export const conversations = ref<Conversation[]>([]);
export const assets = ref<Asset[]>([]);
export const activeId = ref('');
export const chatBusy = ref(false);
export const syncing = ref(false);
export const syncFailures = ref<string[]>([]);
export const modelCatalog = ref<PublicModel[]>([]);
export const modelSelection = ref<Record<string, string>>({});
export const aligningIds = ref<string[]>([]);
/** Works whose publish/withdraw request is in flight. */
export const visibilityBusyIds = ref<string[]>([]);
export const status = ref<StatusState>({ ...DEFAULT_STATUS });
export const creating = ref<Record<string, boolean>>({});
export const activeConversation = computed(() => conversations.value.find(item => item.id === activeId.value));
export const completedCount = computed(() => assets.value.filter(asset => asset.status === 'completed').length);
export const modelsFor = (kind: MediaKind | 'chat') => modelCatalog.value.filter(model => model.kind === kind);
export const activeAssets = (kind: MediaKind) => assets.value.filter(asset => asset.kind === kind);
export const kindBusy = (kind: MediaKind) => assets.value.some(asset => asset.kind === kind && asset.status === 'pending');

const chatController = shallowRef<AbortController | null>(null);
const jobs = new Map<string, AbortController>();
const videoCoverAttempts = new Set<string>();
let initialized: Promise<void> | null = null;

const errorText = (error: unknown) => t(publicServiceError(error instanceof Error ? error.message : '发生未知错误，请重试。'));
const persistError = (error: unknown) => notify(t('保存失败：{detail} 请下载重要内容备份。', { detail: errorText(error) }));

function saveConversation(conversation: Conversation, persist = true) {
  conversations.value = [conversation, ...conversations.value.filter(item => item.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  if (persist) void put('conversations', conversation).catch(persistError);
}

async function saveAsset(asset: Asset) {
  // Completion and cover updates are built from copies captured earlier. Keep a
  // title that was edited or generated while the work was still in flight.
  const current = assets.value.find(item => item.id === asset.id);
  if (!asset.title && current?.title) asset = { ...asset, title: current.title };
  assets.value = [asset, ...assets.value.filter(item => item.id !== asset.id)].sort((a, b) => b.createdAt - a.createdAt);
  try { await put('assets', asset); } catch (error) { persistError(error); }
}

/** Conversations whose AI title request is still in flight. */
const titleRequests = new Set<string>();

/**
 * Replace a truncated prompt seed with a short title from the default chat
 * model. The seed check keeps a manual rename authoritative even when the
 * request finishes late.
 */
async function autoTitleConversation(id: string, seed: string, text: string, reply = '') {
  if (!seed || titleRequests.has(id)) return;
  titleRequests.add(id);
  try {
    const title = await generateTitle('conversation', text, reply);
    if (!title) return;
    const current = conversations.value.find(item => item.id === id);
    if (!current || current.title !== seed) return;
    saveConversation({ ...current, title });
  } finally {
    titleRequests.delete(id);
  }
}

/**
 * Name a work with the default chat model so the library does not show a
 * truncated prompt. An explicit or user-edited title always wins.
 */
async function autoTitleWork(asset: Asset) {
  const title = await generateTitle('work', asset.prompt);
  if (!title) return;
  const current = assets.value.find(item => item.id === asset.id);
  // Only fill a still-untitled work whose prompt has not changed meanwhile.
  if (!current || current.title || current.prompt !== asset.prompt) return;
  await saveAsset({ ...current, title });
}

/** Publishes or withdraws a completed work, updating every card that shows it. */
export async function toggleAssetVisibility(asset: Asset): Promise<Asset | undefined> {
  if (visibilityBusyIds.value.includes(asset.id)) return;
  visibilityBusyIds.value = [...visibilityBusyIds.value, asset.id];
  try {
    const visibility = await setAssetVisibility(asset.id, asset.visibility === 'private' ? 'public' : 'private');
    const current = assets.value.find(item => item.id === asset.id) || asset;
    const updated = { ...current, visibility } as Asset;
    assets.value = assets.value.map(item => item.id === asset.id ? updated : item);
    notify(visibility === 'private' ? t('已从广场撤回，作品只对你可见。') : t('已发布到广场，大家可以看到这件作品了。'));
    return updated;
  } catch (error) {
    notify(errorText(error));
    return undefined;
  } finally {
    visibilityBusyIds.value = visibilityBusyIds.value.filter(id => id !== asset.id);
  }
}

function touchConversation(id?: string) {
  if (!id) return;
  const conversation = conversations.value.find(item => item.id === id);
  if (conversation) saveConversation({ ...conversation, updatedAt: Date.now() });
}

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});

export async function initStudio(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    settings.value = loadSettings();
    try {
      try {
        account.value = await initializeStorage();
      } catch (accountError) {
        notify(t('账号服务未就绪，已切换为本地离线模式（{detail}）', { detail: errorText(accountError) }));
      }
      const [chats, works] = await Promise.all([getAll<Conversation>('conversations'), getAll<Asset>('assets')]);
      conversations.value = (chats || []).map(conversation => ({
        ...conversation,
        messages: Array.isArray(conversation?.messages)
          ? conversation.messages.map(message => message.role === 'assistant' && !message.content && !message.error ? { ...message, interrupted: true } : message)
          : [],
      })).sort((a, b) => b.updatedAt - a.updatedAt);
      const savedActive = localStorage.getItem('olai.active') || localStorage.getItem('studio.active') || '';
      activeId.value = conversations.value.some(item => item.id === savedActive) ? savedActive : (conversations.value[0]?.id || '');
      const recovered = (works || []).filter(Boolean).map(asset => asset.status === 'pending' && !(asset.kind === 'video' && asset.remoteId)
        ? { ...asset, status: 'failed' as const, error: t('上次请求被中断，请点击重试。') }
        : asset).sort((a, b) => b.createdAt - a.createdAt);
      assets.value = recovered;
      await Promise.all(recovered.filter(asset => asset.status === 'failed').map(asset => put('assets', asset).catch(() => {})));
      ready.value = true;
      void loadStatus().then(value => { status.value = value; });
      void refreshModels();
      if (account.value.user) {
        // Memory is a private enhancement: a failure must never block the studio.
        void loadMemoryState().then(value => { memoryState.value = value; }).catch(() => {});
        void runGuestSync(account.value.user.id);
      }
      for (const asset of assets.value) {
        if (asset.kind === 'video' && asset.status === 'pending' && asset.remoteId) void pollVideo(asset);
        if (asset.kind === 'music' && asset.status === 'completed' && asset.coverStatus === 'pending') void generateMusicCover(asset);
        if (asset.kind === 'video' && asset.status === 'completed' && !asset.coverUrl && (asset.blob || asset.url)) void captureStoredVideoCover(asset);
      }
    } catch (error) {
      loadError.value = t('读取数据失败：{detail}', { detail: errorText(error) });
      notify(loadError.value);
    }
  })();
  return initialized;
}

export async function refreshModels() {
  if (!status.value.ready) return;
  try {
    const response = await request('models');
    const data = await response.json();
    if (!Array.isArray(data?.models)) return;
    modelCatalog.value = data.models.filter((model: any) => model && typeof model.id === 'string' && typeof model.name === 'string'
      && ['chat', 'image', 'video', 'music'].includes(model.kind));
  } catch { /* The server default model keeps working. */ }
}

export async function runGuestSync(userId: string) {
  if (syncing.value) return;
  syncing.value = true;
  try {
    const report = await syncGuestRecords(userId);
    syncFailures.value = report.failures;
    if (!report.failures.length) notify(t('本地数据与云端附件已同步。'));
    if (report.synced.conversations.length || report.synced.assets.length) {
      const [chats, works] = await Promise.all([getAll<Conversation>('conversations'), getAll<Asset>('assets')]);
      conversations.value = (chats || []).map(conversation => ({ ...conversation, messages: Array.isArray(conversation?.messages) ? conversation.messages : [] })).sort((a, b) => b.updatedAt - a.updatedAt);
      assets.value = (works || []).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
    }
  } catch (error) {
    syncFailures.value = [...syncFailures.value, t('游客记录后台同步未完成，本地内容已保留。{detail}', { detail: error instanceof Error ? error.message : t('请重试。') })];
  } finally {
    syncing.value = false;
  }
}

export function changeSettings(next: Settings, showToast = false) {
  settings.value = next;
  saveSettings(next);
  if (showToast) notify(t('设置已保存'));
}

export function newConversation(kind: ConversationKind = 'chat') {
  if (chatController.value) { notify(t('请先停止当前回答，再创建会话。')); return ''; }
  // Reuse an existing blank record of the same kind instead of stacking duplicates.
  const empty = conversations.value.find(item => (item.messages?.length || 0) === 0 && (item.kind || 'chat') === kind);
  const conversation: Conversation = empty || { id: uid(), title: t('新的灵感'), kind, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  if (!empty) saveConversation(conversation);
  activeId.value = conversation.id;
  try { localStorage.setItem('olai.active', conversation.id); } catch { /* Session still works in memory. */ }
  return conversation.id;
}

/** The creation mode a saved conversation belongs to. Legacy chats have no `kind`. */
export function conversationKind(conversation?: Conversation | null): MediaKind | null {
  if (!conversation) return null;
  if (conversation.kind === 'image' || conversation.kind === 'video' || conversation.kind === 'music') return conversation.kind;
  if (conversation.kind === 'chat') return null;
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const kind = messages[index]?.kind;
    if (kind === 'image' || kind === 'video' || kind === 'music') return kind;
  }
  return null;
}

function rememberConversation(conversation: Conversation, persist = true) {
  saveConversation(conversation, persist);
}

/**
 * Reuse the active conversation when it is empty or already on the same mode;
 * otherwise start a new record so chat and media threads never mix.
 */
export function prepareConversation(kind: ConversationKind, titleSeed = ''): Conversation {
  const now = Date.now();
  const active = conversations.value.find(item => item.id === activeId.value);
  const activeKind = active ? (active.kind || 'chat') : null;
  let conversation = active;
  let changed = false;
  if (!conversation || ((conversation.messages?.length || 0) > 0 && activeKind !== kind)) {
    // Reuse a blank record of this kind so abandoned "new" screens leave one entry, not many.
    conversation = conversations.value.find(item => (item.messages?.length || 0) === 0 && (item.kind || 'chat') === kind) || {
      id: uid(),
      title: titleSeed.trim().slice(0, 26) || t('新的灵感'),
      kind,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    changed = true;
  } else if (conversation.kind !== kind) {
    conversation = { ...conversation, kind };
    changed = true;
  }
  activeId.value = conversation.id;
  try { localStorage.setItem('olai.active', conversation.id); } catch { /* Session still works in memory. */ }
  if (changed) rememberConversation(conversation, false);
  return conversation;
}

/** Record a media creation request as a normal conversation entry. */
export function startCreation(kind: MediaKind, text: string, images: { url: string; name: string }[], files: string[]) {
  const now = Date.now();
  const requestId = uid();
  const conversation = prepareConversation(kind, text);
  const previous = Array.isArray(conversation.messages) ? conversation.messages : [];
  const first = previous.length === 0;
  const message: Message = { id: uid(), role: 'user', content: text, kind, requestId, images, files, createdAt: now };
  const next: Conversation = {
    ...conversation,
    kind,
    title: first ? (text.trim().slice(0, 26) || t('新的灵感')) : conversation.title,
    updatedAt: now,
    messages: [...previous, message],
  };
  saveConversation(next);
  // The request text is only a seed; ask the default model for a real title.
  if (first) void autoTitleConversation(next.id, next.title, text);
  return { conversation: next, requestId };
}

export function openConversation(id: string) {
  activeId.value = id;
  try { localStorage.setItem('olai.active', id); } catch { /* Session still works in memory. */ }
}

export async function renameConversation(conversation: Conversation, title: string) {
  if (!title.trim()) return;
  saveConversation({ ...conversation, title: title.trim().slice(0, 100), updatedAt: Date.now() });
}

export async function deleteConversation(conversation: Conversation) {
  if (chatController.value || chatBusy.value) { notify(t('请先停止回答，再删除会话。')); return; }
  if (!await confirmAction(t('删除这段会话？'), t('「{title}」和其中的消息将从{target}删除，此操作无法撤销。', { title: conversation.title, target: account.value.user ? t('你的账号') : t('此浏览器') }))) return;
  try {
    await remove('conversations', conversation.id);
    conversations.value = conversations.value.filter(item => item.id !== conversation.id);
    if (activeId.value === conversation.id) activeId.value = conversations.value[0]?.id || '';
    notify(t('会话已删除'));
  } catch (error) { persistError(error); }
}

export async function sendMessage(text: string, retryId?: string) {
  if (chatController.value || !status.value.ready) {
    if (!status.value.ready) notify(t('创作服务尚未就绪，请联系服务提供方。'));
    return;
  }
  const now = Date.now();
  let conversation = activeConversation.value;
  if (retryId) {
    if (!conversation || conversationKind(conversation) !== null) return;
  } else {
    conversation = prepareConversation('chat', text);
  }
  let history = [...conversation.messages];
  if (retryId) {
    const index = history.findIndex(message => message.id === retryId);
    if (index < 0) return;
    history = history.slice(0, index);
  } else {
    history.push({ id: uid(), role: 'user', content: text, createdAt: now });
  }
  const assistant = { id: uid(), role: 'assistant' as const, content: '', createdAt: now };
  let running: Conversation = {
    ...conversation,
    kind: 'chat',
    title: conversation.messages.length ? conversation.title : (text.slice(0, 26) || conversation.title),
    updatedAt: now,
    messages: [...history, assistant],
  };
  // Only the first exchange seeds a title; later messages keep it.
  const autoTitleSeed = !retryId && conversation.messages.length === 0 ? running.title : '';
  const controller = new AbortController();
  chatController.value = controller;
  chatBusy.value = true;
  saveConversation(running);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await chat(history, settings.value.temperature, controller.signal, delta => {
      assistant.content += delta;
      running = { ...running, updatedAt: Date.now(), messages: [...history, { ...assistant }] };
      saveConversation(running, false);
      if (!saveTimer) saveTimer = setTimeout(() => { void put('conversations', running).catch(persistError); saveTimer = undefined; }, 500);
    }, modelSelection.value.chat || undefined);
    if (!assistant.content.trim()) throw new Error(t('暂未收到回答，请重新尝试。'));
    if (account.value.user && memoryState.value.enabled && memoryState.value.autoCapture) {
      const recent: Pick<Message, 'role' | 'content' | 'error'>[] = [
        ...history.slice(-4).map(({ role, content, error }) => ({ role, content, error })),
        { role: 'assistant', content: assistant.content },
      ];
      const turns = recent.filter(message => message.content && !message.error).map(({ role, content }) => ({ role, content }));
      void extractMemories(turns).then(items => {
        if (items.length) memoryState.value = { ...memoryState.value, memories: [...memoryState.value.memories, ...items] };
      }).catch(() => { /* Automatic capture is best-effort and never interrupts chat. */ });
    }
  } catch (error) {
    running = { ...running, messages: [...history, { ...assistant, ...(controller.signal.aborted ? { interrupted: true } : { error: errorText(error) }) }] };
  } finally {
    clearTimeout(saveTimer);
    saveConversation(running);
    chatController.value = null;
    chatBusy.value = false;
    // Summarize the first exchange now that the reply (or its error) is known.
    if (autoTitleSeed) void autoTitleConversation(running.id, autoTitleSeed, text, assistant.content);
  }
}

export function stopChat() { chatController.value?.abort(); }

async function saveCompletedAsset(asset: Asset): Promise<string | undefined> {
  let resolutionWarning: string | undefined;
  if (asset.kind === 'image' && (asset.blob || asset.url)) {
    try {
      const resolution = await readImageResolution(asset.blob || asset.url!);
      asset.imageWidth = resolution.width;
      asset.imageHeight = resolution.height;
      resolutionWarning = imageResolutionWarning(resolution, asset.options.image_size);
    } catch { /* Keep the original image when dimensions cannot be read. */ }
  }
  if (asset.kind === 'music' && asset.song && !asset.song.instrumental && asset.blob) {
    try {
      asset.audioDuration = await readAudioDuration(asset.blob);
      asset.lrc = generateLrcFromPrompt(sungLines(asset.song), asset.audioDuration, asset.song.title);
    } catch { /* Keep the labelled estimate. */ }
  }
  if (asset.kind === 'video' && (asset.blob || asset.url)) {
    try {
      asset.coverUrl = await captureVideoCover(asset.blob || asset.url!);
      asset.coverStatus = 'completed';
      asset.coverError = undefined;
    } catch { /* Keep the gradient poster. */ }
  }
  await saveAsset(asset);
  touchConversation(asset.conversationId);
  return resolutionWarning;
}

/** Load the image a revision builds on so follow-up instructions keep visual context. */
async function revisionImageBlob(revisionOf?: string): Promise<Blob | undefined> {
  if (!revisionOf) return undefined;
  const parent = assets.value.find(asset => asset.id === revisionOf);
  if (!parent) return undefined;
  if (parent.blob instanceof Blob && parent.blob.type.startsWith('image/')) return referenceImageBlob(parent.blob);
  if (!parent.url) return undefined;
  try {
    const response = await fetch(safeMediaURL(parent.url), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? referenceImageBlob(blob) : undefined;
  } catch { return undefined; }
}

/** The server percent-encodes the public alias so non-ASCII names survive headers. */
function servedModelLabel(response: Response): string | undefined {
  const raw = response.headers.get('X-Olai-Model');
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw).trim().slice(0, 80) || undefined;
  } catch {
    return undefined;
  }
}

export async function generate(kind: MediaKind, prompt: string, options: Record<string, string | number>, retry?: Asset, referenceImages?: Blob[], meta?: CreationMeta) {
  if (!status.value.ready) { notify(t('创作服务尚未就绪，请联系服务提供方。')); return; }
  if (!prompt.trim()) return;
  if (assets.value.some(asset => asset.kind === kind && asset.status === 'pending' && asset.id !== retry?.id)) {
    notify(t('同类型作品正在生成，请等待完成。'));
    return;
  }
  const modelId = typeof options.modelId === 'string' && options.modelId ? options.modelId : undefined;
  const modelContext = modelId ? { modelId } : undefined;
  // Record the public alias of the selected model up front; the server replaces
  // or fills it from the response header, including for the default model.
  const selectedModel = modelId ? modelCatalog.value.find(model => model.id === modelId) : undefined;
  const modelLabel = (selectedModel?.name || '').trim().slice(0, 80);
  const asset: Asset = {
    id: retry?.id || uid(), kind, prompt, options, createdAt: Date.now(), status: 'pending',
    // New works start private; publishing is an explicit action. A retry keeps
    // the visibility the work already has.
    visibility: retry?.visibility ?? 'private',
    requestId: retry?.requestId || meta?.requestId,
    conversationId: retry?.conversationId || meta?.conversationId,
    revisionOf: retry?.revisionOf || meta?.revisionOf,
    version: retry?.version ?? meta?.version,
    ...(modelLabel ? { modelLabel } : {}),
    ...(retry?.title ? { title: retry.title } : {}),
  };
  creating.value[kind] = true;
  await saveAsset(asset);
  try {
    if (kind === 'music' && typeof options.song === 'string') {
      asset.song = parseSong(options.song);
      asset.coverStatus = options.generate_cover === 1 ? 'pending' : undefined;
      asset.lyrics = songLyrics(asset.song);
      const lines = sungLines(asset.song);
      asset.lrc = lines ? generateLrcFromPrompt(lines, Number(options.duration) || 120, asset.song.title || t('未命名歌曲')) : undefined;
      asset.lrcSource = lines ? 'estimated' : undefined;
      await saveAsset(asset);
    }
    // Summarize the prompt with the default chat model while it generates, so
    // the library never has to show a truncated prompt as the work's name.
    // Music with its own song title already has a suitable name.
    if (!asset.title && !(kind === 'music' && asset.song?.title?.trim())) void autoTitleWork(asset);
    let response: Response;
    if (kind === 'video') {
      response = await generateVideo({ prompt, options, mode: status.value.videoMode, context: modelContext, ...(referenceImages?.length && status.value.videoMode === 'task' ? { inputImage: referenceImages[0] } : {}) });
    } else if (kind === 'image') {
      // A revision carries the previous image as the first reference so the new
      // instruction edits it instead of starting over.
      const base = await revisionImageBlob(asset.revisionOf);
      const images = base
        ? [base, ...(referenceImages || []).filter(image => image !== base)].slice(0, 4)
        : referenceImages;
      response = await generateImage({
        prompt,
        mode: (status.value.imageMode || settings.value.imageEngineMode || 'auto') as any,
        size: imageDimensions(String(options.aspect_ratio || 'auto'), String(options.image_size || '1K')),
        aspectRatio: String(options.aspect_ratio || 'auto'),
        imageSize: String(options.image_size || '1K'),
        reasoningEffort: String(options.reasoning_effort || 'medium'),
        n: typeof options.n === 'number' ? options.n : 1,
        referenceImages: images?.length ? images : undefined,
        context: modelContext,
      });
    } else {
      let extra = {};
      try { extra = JSON.parse(settings.value.musicExtra || '{}'); } catch { /* ignore malformed local extras */ }
      response = await generateAudio({
        prompt,
        mode: settings.value.audioEngineMode || 'auto',
        musicPath: settings.value.musicPath || 'speech',
        duration: options.duration !== undefined ? Number(options.duration) : undefined,
        song: asset.song,
        voice: typeof options.voice === 'string' ? options.voice : 'alloy',
        speed: typeof options.speed === 'number' ? options.speed : 1.0,
        responseFormat: typeof options.response_format === 'string' ? options.response_format : 'mp3',
        context: modelContext,
        extra,
      });
    }
    let resolutionWarning: string | undefined;
    // The public alias of the model that actually served this request. It is
    // saved with the work so the gallery detail can show it later.
    const servedModel = servedModelLabel(response);
    if (servedModel) asset.modelLabel = servedModel;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const json = await response.json();
      if (kind === 'video' && json.status === 'failed') throw new Error(json.errors?.[0]?.message || t('视频生成失败，请重试。'));
      if (kind === 'video' && status.value.videoMode === 'task') {
        if (typeof json.id !== 'string' || !json.id || !['queued', 'pending', 'in_progress', 'processing', 'completed'].includes(json.status)) throw new Error(t('暂未收到视频任务，请重试或检查服务连接。'));
        const task = { ...asset, remoteId: json.id };
        await saveAsset(task);
        void pollVideo(task);
        return;
      }
      const outputs = mediaOutputs(json, kind);
      if (!outputs.length) throw new Error(kind === 'music' ? t('暂未收到音乐文件，请重试或检查服务连接。') : kind === 'video' ? t('暂未收到视频文件，请重试或检查服务连接。') : t('暂未收到图片，请重试或检查服务连接。'));
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        let blob: Blob | undefined;
        let url: string | undefined;
        if (output.base64) blob = base64Blob(output.base64, output.mime);
        else if (output.url) {
          const mediaUrl = safeMediaURL(output.url);
          url = mediaUrl;
          try {
            const media = await fetch(mediaUrl, { signal: AbortSignal.timeout(20_000) });
            if (media.ok) {
              const downloaded = await media.blob();
              if (downloaded.size && (downloaded.type.startsWith('image/') || downloaded.type.startsWith('audio/') || downloaded.type.startsWith('video/') || downloaded.type === 'application/octet-stream')) {
                blob = kind === 'music' ? await ensurePlayableAudioBlob(downloaded) : downloaded;
                if (isStoredMedia(output.url)) registerStoredBlob(blob, output.url);
                else url = undefined;
              }
            }
          } catch { /* Retain the remote URL. */ }
        }
        const warning = await saveCompletedAsset({ ...asset, id: i ? uid() : asset.id, status: 'completed', blob, url, lrc: asset.lrc });
        resolutionWarning ||= warning;
      }
    } else {
      if (!contentType.startsWith(kind === 'image' ? 'image/' : kind === 'video' ? 'video/' : 'audio/') && !contentType.includes('octet-stream')) throw new Error(t('服务返回了不支持的媒体格式，请检查接口设置。'));
      let blob = await response.blob();
      if (!blob.size) throw new Error(t('服务返回了空文件。'));
      if (kind === 'music') blob = await ensurePlayableAudioBlob(blob);
      resolutionWarning = await saveCompletedAsset({ ...asset, status: 'completed', blob, lrc: asset.lrc });
    }
    const done = asset.visibility === 'private'
      ? t('创作完成，已加入你的作品库。发布到广场后大家就能看到。')
      : t('创作完成，已加入你的作品库。');
    notify(resolutionWarning ? t('{warning} 原图已保存到作品库。', { warning: resolutionWarning }) : done);
  } catch (error) {
    await saveAsset({ ...asset, status: 'failed', coverStatus: undefined, error: errorText(error) });
    touchConversation(asset.conversationId);
    notify(errorText(error));
  } finally {
    creating.value[kind] = false;
  }
}

async function pollVideo(original: Asset) {
  if (!original.remoteId || jobs.has(original.id)) return;
  const controller = new AbortController();
  jobs.set(original.id, controller);
  try {
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await request(`videos/${encodeURIComponent(original.remoteId)}`, { signal: controller.signal });
      const video = await response.json();
      if (video.status === 'failed') throw new Error(video.error?.message || video.error || t('视频生成失败，请重试。'));
      if (video.status === 'completed') {
        let blob: Blob;
        try { blob = await videoContent(original.remoteId, controller.signal); }
        catch (error) {
          if ((error as Error & { status?: number }).status !== 409) throw error;
          await delay(5000, controller.signal);
          continue;
        }
        await saveCompletedAsset({ ...original, status: 'completed', blob, url: undefined, error: undefined });
        notify(t('你的视频已生成，去看看吧。'));
        return;
      }
      if (!['in_progress', 'queued', 'pending', 'processing'].includes(video.status)) throw new Error(t('无法识别视频任务状态：{status}', { status: video.status || t('空') }));
      await delay(5000, controller.signal);
    }
    throw new Error(t('视频任务仍未完成；重新打开页面后可以继续查询。'));
  } catch (error) {
    if (!controller.signal.aborted) {
      await saveAsset({ ...original, status: 'failed', error: errorText(error) });
      touchConversation(original.conversationId);
    }
  } finally {
    jobs.delete(original.id);
  }
}

async function generateMusicCover(original: Asset) {
  const jobId = `cover:${original.id}`;
  if (jobs.has(jobId) || original.kind !== 'music' || original.status !== 'completed') return;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  try {
    const response = await request('generate/image', {
      method: 'POST',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
      body: JSON.stringify({ action: 'cover', song: original.song, prompt: original.prompt, inspiration: original.options.inspiration, lyrics: original.lyrics }),
    });
    let coverUrl: string;
    if (response.headers.get('content-type')?.includes('json')) {
      const output = mediaOutputs(await response.json(), 'image')[0];
      if (!output) throw new Error(t('服务没有返回封面图片。'));
      if (output.base64 && output.mime.startsWith('image/')) coverUrl = `data:${output.mime};base64,${output.base64}`;
      else if (output.url) coverUrl = safeMediaURL(output.url);
      else throw new Error(t('服务没有返回有效封面图片。'));
    } else {
      if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(t('服务没有返回有效封面图片。'));
      const blob = await response.blob();
      if (!blob.size) throw new Error(t('服务返回了空封面图片。'));
      coverUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    }
    if (/^https?:/.test(coverUrl) && !isStoredMedia(coverUrl)) {
      try {
        const downloaded = await fetch(coverUrl, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (downloaded.ok && downloaded.headers.get('content-type')?.startsWith('image/')) {
          const blob = await downloaded.blob();
          coverUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
        }
      } catch { /* Retain the source URL. */ }
    }
    const current = assets.value.find(asset => asset.id === original.id);
    if (!current || controller.signal.aborted) return;
    await saveAsset({ ...current, coverUrl, coverStatus: 'completed', coverError: undefined });
    notify(t('歌曲封面已生成并保存。'));
  } catch (error) {
    if (controller.signal.aborted) return;
    const current = assets.value.find(asset => asset.id === original.id);
    if (current) await saveAsset({ ...current, coverStatus: 'failed', coverError: errorText(error) });
    notify(t('封面暂未生成，音乐已保存，可继续播放或下载。'));
  } finally {
    jobs.delete(jobId);
  }
}

async function captureStoredVideoCover(original: Asset) {
  const jobId = `videocover:${original.id}`;
  if (jobs.has(jobId) || videoCoverAttempts.has(original.id) || original.kind !== 'video' || original.status !== 'completed' || original.coverUrl) return;
  const source = original.blob || original.url;
  if (!source) return;
  videoCoverAttempts.add(original.id);
  const controller = new AbortController();
  jobs.set(jobId, controller);
  try {
    const coverUrl = await captureVideoCover(source);
    if (controller.signal.aborted) return;
    const current = assets.value.find(asset => asset.id === original.id);
    if (!current || current.coverUrl) return;
    await saveAsset({ ...current, coverUrl, coverStatus: 'completed', coverError: undefined });
  } catch { /* Keep the gradient poster. */ } finally {
    jobs.delete(jobId);
  }
}

export async function deleteAsset(id: string) {
  if (!await confirmAction(t('删除这件作品？'), t('作品及关联歌词将从{target}删除。建议先下载备份，此操作无法撤销。', { target: account.value.user ? t('你的账号') : t('此浏览器') }))) return;
  try {
    jobs.get(`lyrics:${id}`)?.abort();
    jobs.get(`cover:${id}`)?.abort();
    if (activeMedia.value?.id === id) closePlayer();
    await remove('assets', id);
    assets.value = assets.value.filter(asset => asset.id !== id);
    notify(t('作品已删除'));
  } catch (error) { persistError(error); }
}

export async function downloadAsset(asset: Asset) {
  const extension = asset.blob?.type.includes('jpeg') ? 'jpg' : asset.blob?.type.includes('webp') ? 'webp' : asset.blob?.type.includes('wav') ? 'wav' : asset.kind === 'image' ? 'png' : asset.kind === 'video' ? 'mp4' : 'mp3';
  const fileName = `olai-${asset.kind}-${asset.id.slice(0, 8)}.${extension}`;
  if (asset.blob) downloadBlob(asset.blob, fileName);
  else if (asset.url) {
    try {
      const response = await fetch(safeMediaURL(asset.url), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error();
      downloadBlob(await response.blob(), fileName);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = safeMediaURL(asset.url);
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.download = fileName;
      anchor.click();
      notify(t('已打开原始媒体链接，可在新页面保存。'));
    }
  }
  if (asset.kind === 'music' && asset.lyrics) downloadBlob(new Blob([asset.lyrics], { type: 'text/plain' }), `olai-music-${asset.id.slice(0, 8)}.txt`);
  if (asset.kind === 'music' && asset.lrc) downloadBlob(new Blob([asset.lrc], { type: 'text/plain' }), `olai-music-${asset.id.slice(0, 8)}.lrc`);
}

export async function downloadCover(asset: Asset) {
  if (!asset.coverUrl) return;
  try {
    const response = await fetch(safeMediaURL(asset.coverUrl), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const extension = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png';
    downloadBlob(blob, `olai-cover-${asset.id.slice(0, 8)}.${extension}`);
  } catch { notify(t('封面下载失败，请检查原图片链接是否仍可用。')); }
}

export function retryAsset(asset: Asset) { void generate(asset.kind, asset.prompt, asset.options, asset); }

export function retryCover(asset: Asset) {
  if (asset.status !== 'completed' || asset.kind !== 'music' || asset.coverStatus === 'pending') return;
  void saveAsset({ ...asset, options: { ...asset.options, generate_cover: 1 }, coverStatus: 'pending', coverError: undefined });
}

export async function alignMusicLyrics(asset: Asset) {
  const jobId = `lyrics:${asset.id}`;
  if (jobs.has(jobId) || !status.value.ready) return;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  aligningIds.value = [...aligningIds.value, asset.id];
  try {
    const result = await alignLyricsToAudio(asset, AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]));
    const current = assets.value.find(item => item.id === asset.id);
    if (!current || controller.signal.aborted) return;
    await saveAsset({ ...current, lrc: result.lrc, lrcSource: 'audio', audioDuration: result.duration, lrcError: undefined });
    notify(t('歌词已按实际音频校准，可试听检查或下载 LRC。'));
  } catch (error) {
    if (controller.signal.aborted) return;
    const detail = errorText(error);
    const message = detail.includes('原歌词')
      ? t('歌词校准未完成：{detail}', { detail })
      : t('歌词校准未完成：{detail}。原歌词时间轴已保留。', { detail });
    const current = assets.value.find(item => item.id === asset.id);
    if (current) await saveAsset({ ...current, lrcError: message });
    notify(message);
  } finally {
    jobs.delete(jobId);
    aligningIds.value = aligningIds.value.filter(id => id !== asset.id);
  }
}

export async function saveMusicLyricTimeline(asset: Asset, lrc: string) {
  const current = assets.value.find(item => item.id === asset.id) || asset;
  await saveAsset({ ...current, lrc, lrcSource: 'manual', lrcError: undefined });
  notify(t('歌词时间轴已保存，可试听检查。'));
}

export async function composeForMusic(prompt: string, style: string, instrumental: boolean) {
  if (!status.value.ready) throw new Error(t('请先连接创作服务，再整理歌曲。'));
  return composeSong(prompt, style, instrumental);
}
