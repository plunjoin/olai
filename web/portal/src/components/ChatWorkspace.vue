<template>
  <div class="chat-workspace" @keydown="onWorkspaceKeydown">
    <div class="workspace-toolbar">
      <div class="toolbar-left"><h1 class="workspace-label">{{ kind ? modeName : t('AI 对话') }}</h1></div>
      <div class="toolbar-right">
        <button v-if="!kind" type="button" class="icon-button" :aria-label="t('导出当前会话')" :title="t('导出当前会话')" :disabled="!messages.length" @click="exportConversation"><Download :size="17" /></button>
        <button
          v-else
          ref="panelToggleRef"
          type="button"
          class="icon-button parameters-sidebar-toggle"
          :class="{ 'is-active': parametersOpen }"
          :aria-label="parametersOpen ? t('收起创作参数') : t('展开创作参数')"
          :title="parametersOpen ? t('收起创作参数') : t('展开创作参数')"
          :aria-expanded="parametersOpen"
          :aria-controls="panelId"
          @click="changeParameters(!parametersOpen)"
        ><PanelRightClose v-if="parametersOpen" :size="19" /><SlidersHorizontal v-else :size="16" /></button>
      </div>
    </div>

    <div class="chat-body" :class="{ 'has-parameters': !!kind && parametersOpen }">
      <div class="chat-primary" :inert="kind && parametersOpen && narrow ? true : undefined">
        <div class="chat-stage">
          <div ref="scrollRef" class="chat-scroll" @scroll="updateFollow">
            <MediaWorkspace
              v-if="kind"
              :key="kind"
              ref="mediaController"
              :kind="kind"
              embedded
              :initial-prompt="input"
              :edit-asset="editRequest"
              :panel-host="panelHost"
              :parameter-request="parameterRequest"
              :attachments="attachments"
              :requests="visibleSent"
              :user-name="userName"
              :user-avatar="userAvatar"
              @composer-state-change="onComposerStateChange"
              @prompt-suggestion="usePromptSuggestion"
              @consumed-draft="parameterRequest = null"
              @consumed-edit="consumeEdit"
              @edit-requested="requestEdit"
            />
            <template v-else>
              <div v-if="!chatMessages.length" class="chat-welcome">
                <div class="welcome-symbol"><Companion :size="120" interactive /></div>
                <h2>{{ t('从一个想法开始') }}</h2>
                <p>{{ t('和小o聊聊，或从左侧选择一种创作方式') }}</p>
                <div class="suggestion-grid">
                  <button v-for="suggestion in suggestions" :key="suggestion.title" type="button" @click="useSuggestion(suggestion.prompt)">
                    <strong>{{ suggestion.title }}</strong>
                    <p>{{ suggestion.prompt }}</p>
                    <ArrowUp :size="16" />
                  </button>
                </div>
              </div>
              <div v-else class="messages">
                <article v-for="(message, index) in chatMessages" :key="message.id" class="message" :class="message.role">
                  <div class="message-avatar">
                    <AccountAvatar v-if="message.role === 'user'" :name="userName" :avatar="userAvatar" :size="34" />
                    <BrandLogo v-else :size="32" />
                  </div>
                  <div class="message-main">
                    <div class="message-name">{{ message.role === 'user' ? t('你') : t('小o') }}<span>{{ message.role === 'assistant' ? t('灵感伙伴') : '' }}</span></div>
                    <Markdown v-if="message.content" :text="message.content" />
                    <ThinkingOrb v-else-if="chatBusy && index === chatMessages.length - 1" :size="26" :label="t('小o 正在思考与生成回复…')" />
                    <div v-if="message.error" class="message-error" role="alert">{{ t(publicServiceError(message.error)) }}</div>
                    <span v-if="message.interrupted" class="interrupted-label">{{ t('生成已停止，可重新生成') }}</span>
                    <div v-if="message.role === 'assistant' && (!chatBusy || index < chatMessages.length - 1)" class="message-actions">
                      <button type="button" :disabled="!message.content" :aria-label="t('复制回答')" @click="copy(message.id, message.content)">
                        <Check v-if="copied === message.id" :size="14" /><Copy v-else :size="14" />{{ copied === message.id ? t('已复制') : t('复制') }}
                      </button>
                      <button type="button" :disabled="chatBusy" @click="sendMessage('', message.id)"><RefreshCw :size="14" />{{ t('重新生成') }}</button>
                    </div>
                  </div>
                </article>
              </div>
            </template>
          </div>
        </div>

        <div class="composer-area">
          <div class="composer" :class="{ 'has-attachments': attachments.length }" @paste="pasteAttachments" @dragover.prevent @drop.prevent="dropAttachments">
            <div v-if="kind" class="composer-mode-heading">
              <component :is="modeIcon" :size="14" />
              <span>{{ t('{mode}创作', { mode: modeName }) }}</span>
              <small>{{ mediaState.composingSong ? t('在创作参数中编辑段落，再点击生成') : revisionHint }}</small>
              <span class="composer-mode-actions">
                <button type="button" class="composer-heading-action" :disabled="mediaLocked" @click="emit('newConversation')"><SquarePen :size="12" />{{ t('新对话') }}</button>
                <button type="button" class="icon-button" :aria-label="t('返回 AI 对话')" :title="t('返回 AI 对话')" :disabled="mediaLocked" @click="emit('modeChange')"><X :size="14" /></button>
              </span>
            </div>
            <input ref="fileInput" class="composer-attachment-input" type="file" multiple hidden :accept="ATTACHMENT_ACCEPT" @change="chooseAttachments" />
            <div v-if="attachments.length" class="composer-attachments" :aria-label="t('已添加附件')">
              <template v-for="attachment in attachments" :key="attachment.id">
                <figure v-if="attachment.kind === 'image'" class="attachment-preview">
                  <img :src="attachment.preview" :alt="attachment.name" :title="attachment.name" />
                  <button type="button" class="attachment-remove" :aria-label="t('移除附件：{name}', { name: attachment.name })" :disabled="attachmentLocked" @click="removeAttachment(attachment.id)"><X :size="12" /></button>
                </figure>
                <span v-else class="attachment-file" :title="attachment.name">
                  <FileText :size="16" />
                  <span class="attachment-file-name">{{ attachment.name }}</span>
                  <button type="button" class="attachment-remove" :aria-label="t('移除附件：{name}', { name: attachment.name })" :disabled="attachmentLocked" @click="removeAttachment(attachment.id)"><X :size="12" /></button>
                </span>
              </template>
            </div>
            <p v-if="!kind && hasImageAttachments" class="attachment-note">{{ t('图片参考请用于图像或视频创作。') }}</p>
            <p v-if="kind === 'music' && hasImageAttachments" class="attachment-note">{{ t('音乐创作暂不支持图片附件，将仅按文字描述生成。') }}</p>
            <p v-if="kind === 'video' && status.videoMode !== 'task' && hasImageAttachments" class="attachment-note">{{ t('当前视频模型不支持参考图，将按文字描述生成。') }}</p>
            <p v-if="(kind === 'image' || (kind === 'video' && status.videoMode === 'task')) && hasImageAttachments" class="attachment-note is-ready">{{ t('图片会随请求提交，参考效果取决于当前模型。') }}</p>
            <textarea
              ref="composerRef"
              v-model="input"
              :aria-label="kind ? t('{mode}描述', { mode: modeName }) : t('对话内容')"
              :placeholder="composerPlaceholder"
              maxlength="10000"
              rows="2"
              :disabled="mediaLocked"
              @input="adjustHeight"
              @keydown="onKeydown"
            />
            <div class="composer-bottom">
              <div class="composer-tools">
                <button type="button" class="creation-plus composer-attach" :aria-label="t('添加附件')" :title="kind ? t('添加附件（图片 / TXT / MD）') : t('添加附件（TXT / MD）')" :disabled="attachmentLocked || attachments.length >= MAX_ATTACHMENTS" @click="fileInput?.click()"><Plus :size="20" /></button>
                <Select v-if="!kind && models.length" v-model="selectedModel" class-name="model-select" :aria-label="t('切换对话模型')" :options="[{ value: '', label: t('默认模型') }, ...models.map(model => ({ value: model.id, label: model.name }))]" />
              </div>
              <button v-if="kind" type="button" class="primary-button composer-generate" :aria-label="revisionLabel || t('生成{mode}', { mode: modeName })" :disabled="mediaLocked || !mediaState.hasInput" @click="send">
                <LoaderCircle v-if="mediaLocked" :size="15" class="spin" /><Sparkles v-else :size="15" />
                {{ mediaLocked ? t('正在创作…') : revisionLabel || t('生成{mode}', { mode: modeName }) }}
              </button>
              <button v-else-if="chatBusy" type="button" class="send-button stop" :aria-label="t('停止生成')" @click="stopChat"><Square :size="16" fill="currentColor" /></button>
              <button v-else type="button" class="send-button" :aria-label="t('发送消息')" :disabled="!canSend" @click="send"><ArrowUp :size="21" /></button>
            </div>
          </div>
          <div class="composer-hint">
            <span>{{ t('Enter 发送 · Shift + Enter 换行') }}</span>
            <span>{{ t('留住每一步灵感 · 个人学习开发 · {storage}', { storage: account.user ? t('账号保存') : t('本地保存') }) }}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="parameters-sidebar-backdrop"
        :class="{ 'is-open': !!kind && parametersOpen }"
        :aria-label="t('关闭创作参数')"
        :aria-hidden="!!kind && parametersOpen ? 'false' : 'true'"
        :inert="!kind || !parametersOpen ? true : undefined"
        tabindex="-1"
        @click="changeParameters(false)"
      />
      <aside
        ref="panelHost"
        :id="panelId"
        class="creation-sidebar"
        :class="{ 'is-open': !!kind && parametersOpen }"
        :aria-label="t('创作参数')"
        :aria-hidden="!!kind && parametersOpen ? 'false' : 'true'"
        :inert="!kind || !parametersOpen ? true : undefined"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowUp, Check, Copy, Download, FileText, Image as ImageIcon, LoaderCircle, Music2, PanelRightClose, Plus, RefreshCw, SlidersHorizontal, Sparkles, Square, SquarePen, Video, X } from 'lucide-vue-next';
import AccountAvatar from './AccountAvatar.vue';
import BrandLogo from './BrandLogo.vue';
import Companion from './Companion.vue';
import Markdown from './Markdown.vue';
import MediaWorkspace from './MediaWorkspace.vue';
import ThinkingOrb from './ThinkingOrb.vue';
import Select from './ui/Select.vue';
import { publicServiceError } from '../lib/api';
import { ATTACHMENT_ACCEPT, AttachmentError, MAX_ATTACHMENTS, attachmentPrompt, attachmentThumbnail, readComposerAttachment, releaseAllAttachments, releaseAttachment, type ComposerAttachment } from '../lib/attachments';
import { t } from '../lib/i18n';
import { loadSuggestions, type PromptSuggestion } from '../lib/suggestions';
import type { Asset, MediaKind } from '../lib/types';
import { downloadBlob, notify, uid } from '../composables/ui';
import { account, activeConversation, assets, chatBusy, kindBusy, modelCatalog, modelSelection, sendMessage, startCreation, status, stopChat } from '../composables/studio';

interface MediaComposerState { locked: boolean; hasInput: boolean; composingSong: boolean }
interface SentRequest {
  id: string;
  kind: MediaKind;
  text: string;
  images: { url: string; name: string }[];
  files: string[];
  startedAt: number;
}

const props = withDefaults(defineProps<{
  userName?: string;
  userAvatar?: string | null;
  kind?: MediaKind | null;
  draft?: { token: string; prompt: string; options: Record<string, string | number> } | null;
  editAsset?: Asset | null;
}>(), { userName: '', userAvatar: null, kind: null, draft: null, editAsset: null });
const emit = defineEmits<{ consumedDraft: []; consumedEdit: []; modeChange: []; newConversation: [] }>();
const route = useRoute();
const router = useRouter();

const messages = computed(() => activeConversation.value?.messages || []);
const chatMessages = computed(() => messages.value.filter(message => !message.kind));
const models = computed(() => modelCatalog.value.filter(model => model.kind === 'chat'));
const selectedModel = computed({
  get: () => modelSelection.value.chat || '',
  set: value => { modelSelection.value = { ...modelSelection.value, chat: value }; },
});
const modeName = computed(() => props.kind === 'image' ? t('图像') : props.kind === 'video' ? t('视频') : t('音乐'));
const modeIcon = computed(() => props.kind === 'image' ? ImageIcon : props.kind === 'video' ? Video : Music2);
const input = ref('');
const attachments = ref<ComposerAttachment[]>([]);
const copied = ref('');
const scrollRef = ref<HTMLDivElement | null>(null);
const composerRef = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const panelToggleRef = ref<HTMLButtonElement | null>(null);
const panelHost = ref<HTMLElement | null>(null);
const panelId = `creation-parameters-${uid()}`;
const parametersOpen = ref((() => {
  try {
    const saved = sessionStorage.getItem('olai.creation-parameters-open');
    if (saved !== null) return saved === 'true';
  } catch { /* Fall back to the viewport default. */ }
  return window.innerWidth > 900;
})());
const narrow = ref(false);
const mediaController = ref<InstanceType<typeof MediaWorkspace> | null>(null);
const mediaState = ref<MediaComposerState>({ locked: false, hasInput: false, composingSong: false });
const sending = ref(false);
const parameterRequest = ref<{ token: string; options: Record<string, string | number> } | null>(null);
const editRequest = ref<Asset | null>(null);
let follow = true;
let narrowQuery: MediaQueryList | null = null;
const hasImageAttachments = computed(() => attachments.value.some(item => item.kind === 'image'));
const canSend = computed(() => !hasImageAttachments.value && Boolean(input.value.trim() || attachments.value.some(item => item.kind === 'text')));
const mediaLocked = computed(() => Boolean(props.kind) && (kindBusy(props.kind as MediaKind) || mediaState.value.locked || sending.value));
const attachmentLocked = computed(() => mediaLocked.value || chatBusy.value);
const visibleSent = computed<SentRequest[]>(() => {
  const kind = props.kind;
  if (!kind) return [];
  return messages.value
    .filter(message => message.role === 'user' && message.kind === kind && message.requestId)
    .map(message => ({
      id: message.requestId!,
      kind,
      text: message.content,
      images: message.images || [],
      files: message.files || [],
      startedAt: message.createdAt || 0,
    }));
});
/** The latest completed image or video in this conversation anchors the next revision. */
const revisionTarget = computed<Asset | null>(() => {
  const kind = props.kind;
  if (kind !== 'image' && kind !== 'video') return null;
  const ids = new Set(messages.value.filter(message => message.kind === kind && message.requestId).map(message => message.requestId!));
  if (!ids.size) return null;
  const completed = assets.value
    .filter(asset => asset.kind === kind && asset.requestId && ids.has(asset.requestId) && asset.status === 'completed')
    .sort((a, b) => a.createdAt - b.createdAt);
  return completed[completed.length - 1] || null;
});
const revisionHint = computed(() => revisionTarget.value
  ? t(props.kind === 'image' ? '继续描述将修改第 {n} 版图像' : '继续描述将修改第 {n} 版视频', { n: revisionTarget.value.version || 1 })
  : t('描述想法，小o帮你完成'));
const revisionLabel = computed(() => revisionTarget.value
  ? t(props.kind === 'image' ? '修改图像' : '修改视频')
  : '');
const composerPlaceholder = computed(() => mediaState.value.composingSong && props.kind === 'music'
  ? t('歌曲使用上方编辑的段落与歌词，可直接点击生成…')
  : props.kind === 'image'
    ? revisionTarget.value ? t('描述想修改的地方，如：把光线换成黄昏…') : t('描述想画的画面、颜色与风格…')
    : props.kind === 'video'
      ? revisionTarget.value ? t('描述想修改的地方，如：把光线换成黄昏…') : t('描述场景、镜头和故事…')
      : props.kind === 'music'
        ? t('写下故事、情绪或几句歌词，小o陪你谱成歌…')
        : t('和小o说说你的想法…'));
// 服务端每天用默认对话模型生成新的四张卡片；请求返回前先展示这组内置文案。
const suggestions = ref<PromptSuggestion[]>([
  { title: t('日常闲聊与倾诉'), prompt: t('今天有点累，想找你聊聊天，听听你轻松温暖的话语。') },
  { title: t('写点有意思的'), prompt: t('为一家独立咖啡馆写 3 条有温度的品牌文案，简短而有记忆点。') },
  { title: t('一起想个点子'), prompt: t('我想做一个周末创意项目，请帮我想 5 个有趣而且可以在两天内完成的点子。') },
  { title: t('把复杂变简单'), prompt: t('用生动的语言和一个生活中的例子，向我解释什么是机器学习。') },
]);

function updateFollow() {
  const element = scrollRef.value;
  if (element) follow = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
}
function scrollToBottom() {
  const element = scrollRef.value;
  if (element) element.scrollTop = element.scrollHeight;
}
function changeParameters(open: boolean) {
  parametersOpen.value = open;
  try { sessionStorage.setItem('olai.creation-parameters-open', String(open)); } catch { /* The sidebar also works without storage. */ }
  if (!open) panelToggleRef.value?.focus();
}
function onWorkspaceKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.kind || !parametersOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  changeParameters(false);
}
function onComposerStateChange(state: MediaComposerState) {
  mediaState.value = state;
}
function consumeEdit() {
  editRequest.value = null;
  emit('consumedEdit');
}
function requestEdit(asset: Asset) {
  editRequest.value = asset;
  input.value = typeof asset.options.inspiration === 'string' ? asset.options.inspiration : '';
  changeParameters(true);
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
  void nextTick(() => { adjustHeight(); composerRef.value?.focus(); });
}
watch(() => props.draft?.token, () => {
  const draft = props.draft;
  if (!draft) return;
  input.value = draft.prompt;
  parameterRequest.value = { token: draft.token, options: draft.options };
  changeParameters(true);
  void nextTick(() => {
    composerRef.value?.focus();
    adjustHeight();
    emit('consumedDraft');
  });
}, { immediate: true });
watch(() => props.editAsset, asset => {
  if (!asset) return;
  editRequest.value = asset;
  if (props.kind !== 'music') return;
  input.value = typeof asset.options.inspiration === 'string' ? asset.options.inspiration : '';
  changeParameters(true);
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
  void nextTick(() => { adjustHeight(); composerRef.value?.focus(); });
}, { immediate: true });
watch(() => mediaState.value.composingSong, composing => {
  if (composing) changeParameters(true);
});
watch(() => messages.value.map(message => message.content).join('\n'), async () => {
  if (props.kind || !follow) return;
  await nextTick();
  scrollToBottom();
});
watch([() => visibleSent.value.length, () => props.kind], async (_value, _previous, onCleanup) => {
  if (!props.kind || !visibleSent.value.length) return;
  await nextTick();
  const container = scrollRef.value;
  const thread = container?.querySelector('.creation-thread');
  if (!container || !thread) return;
  const reveal = () => { container.scrollTop = container.scrollHeight; };
  reveal();
  const observer = new ResizeObserver(reveal);
  observer.observe(thread);
  const workspace = container.querySelector('.media-workspace');
  if (workspace) observer.observe(workspace);
  const timers = [120, 360, 800].map(delay => window.setTimeout(reveal, delay));
  onCleanup(() => {
    observer.disconnect();
    timers.forEach(timer => window.clearTimeout(timer));
  });
});
watch(() => activeConversation.value?.id, () => {
  input.value = '';
  releaseAllAttachments(attachments.value);
  attachments.value = [];
  follow = true;
  void nextTick(() => composerRef.value?.focus());
});
watch(() => props.kind, () => {
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
  follow = true;
  void nextTick(() => composerRef.value?.focus());
});
onMounted(() => {
  follow = true;
  if (!props.kind) scrollToBottom();
  void loadSuggestions().then(items => {
    if (items.length) suggestions.value = items;
  });
  narrowQuery = window.matchMedia('(max-width: 900px)');
  narrow.value = narrowQuery.matches;
  narrowQuery.addEventListener('change', updateNarrow);
});
onBeforeUnmount(() => {
  narrowQuery?.removeEventListener('change', updateNarrow);
});

function updateNarrow(event: MediaQueryListEvent) {
  narrow.value = event.matches;
}
function adjustHeight() {
  const element = composerRef.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}
function useSuggestion(prompt: string) {
  input.value = prompt;
  void nextTick(() => { composerRef.value?.focus(); adjustHeight(); });
}
function usePromptSuggestion(prompt: string) {
  input.value = prompt;
  void nextTick(() => { composerRef.value?.focus(); adjustHeight(); });
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function clearAttachments() {
  releaseAllAttachments(attachments.value);
  attachments.value = [];
}
function send() {
  if (props.kind) { void sendCreation(); return; }
  if (chatBusy.value || !canSend.value) return;
  const text = [input.value.trim(), attachmentPrompt(attachments.value)].filter(Boolean).join('\n\n').trim();
  if (!text) return;
  void sendMessage(text);
  input.value = '';
  clearAttachments();
  if (composerRef.value) composerRef.value.style.height = 'auto';
  follow = true;
}

/** Save the request as a conversation record, then start the attached generation. */
async function sendCreation() {
  const kind = props.kind;
  if (!kind || chatBusy.value || mediaLocked.value || !mediaState.value.hasInput) return;
  if (!status.value.ready) { notify(t('创作服务尚未就绪，请联系服务提供方。')); return; }
  if (kind === 'music' && hasImageAttachments.value) notify(t('音乐创作暂不支持图片附件，将仅按文字描述生成。'));
  sending.value = true;
  try {
    // Keep small durable previews in the record instead of blob: URLs that die on reload.
    const imageAttachments = attachments.value.filter(attachment => attachment.kind === 'image').slice(0, 4);
    const images = (await Promise.all(imageAttachments.map(async attachment => ({
      url: await attachmentThumbnail(attachment.file),
      name: attachment.name,
    })))).filter(image => image.url);
    const files = attachments.value.flatMap(attachment => attachment.kind === 'text' ? [attachment.name] : []);
    const text = input.value.trim() || files[0] || t('开始创作');
    const revision = revisionTarget.value;
    const { conversation, requestId } = startCreation(kind, text, images, files);
    // Point the URL at the record so refreshing or sharing reopens this thread.
    if (route.params.conversationId !== conversation.id) void router.replace(`/chat/${encodeURIComponent(conversation.id)}`);
    const creation = mediaController.value?.create({
      requestId,
      conversationId: conversation.id,
      revisionOf: revision || null,
      version: revision ? (revision.version || 1) + 1 : 1,
    });
    input.value = '';
    void nextTick(() => { adjustHeight(); scrollToBottom(); });
    const started = await creation;
    if (started) clearAttachments();
  } finally {
    sending.value = false;
  }
}
async function addFiles(files: File[]) {
  if (!files.length) return;
  const room = MAX_ATTACHMENTS - attachments.value.length;
  if (room <= 0) { notify(t('最多添加 {n} 个附件。', { n: MAX_ATTACHMENTS })); return; }
  const usable = files.slice(0, room);
  const results = await Promise.allSettled(usable.map(readComposerAttachment));
  const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (added.length) attachments.value = [...attachments.value, ...added].slice(0, MAX_ATTACHMENTS);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) notify(failure.reason instanceof AttachmentError ? t(failure.reason.message) : t('附件读取失败，请重试。'));
}
function chooseAttachments(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  target.value = '';
  void addFiles(files);
}
function pasteAttachments(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  void addFiles(files);
}
function dropAttachments(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) void addFiles(files);
}
function removeAttachment(id: string) {
  const target = attachments.value.find(attachment => attachment.id === id);
  if (target) releaseAttachment(target);
  attachments.value = attachments.value.filter(attachment => attachment.id !== id);
}
async function copy(id: string, content: string) {
  try {
    await navigator.clipboard.writeText(content);
    copied.value = id;
    setTimeout(() => { copied.value = ''; }, 2000);
  } catch { notify(t('复制失败，请手动选择文本复制。')); }
}
function exportConversation() {
  const conversation = activeConversation.value;
  if (!conversation) return;
  downloadBlob(new Blob([JSON.stringify(conversation, null, 2)], { type: 'application/json' }), `olai-chat-${conversation.id.slice(0, 8)}.json`);
  notify(t('会话已导出为 JSON'));
}
</script>
