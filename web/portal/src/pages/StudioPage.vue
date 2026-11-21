<template>
  <div class="studio-shell workspace-redesign">
    <div v-if="sidebarOpen && narrow" class="sidebar-overlay" @click="sidebarOpen = false" />
    <aside ref="sidebarRef" class="sidebar" :class="sidebarOpen ? 'open' : 'collapsed'" :aria-label="t('侧边栏')" :inert="narrow && !sidebarOpen">
      <div class="sidebar-rail" :aria-hidden="sidebarOpen">
        <button type="button" class="rail-btn rail-open" :aria-label="t('打开边栏')" @click="toggleSidebar"><PanelLeft :size="20" /><span class="rail-tip" aria-hidden="true">{{ t('打开边栏') }}</span></button>
        <RouterLink class="rail-btn rail-brand" to="/" :aria-label="t('小o 首页')"><BrandLogo :size="28" /><span class="rail-tip" aria-hidden="true">{{ t('小o') }}</span></RouterLink>
        <nav class="rail-nav" :aria-label="t('快捷导航')">
          <button type="button" class="rail-btn" :disabled="chatBusy" :aria-label="t('发起新对话')" @click="startNewConversation"><SquarePen :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ chatBusy ? t('请先停止当前回答') : t('发起新对话') }}</span></button>
          <button type="button" class="rail-btn" :aria-label="t('搜索会话')" @click="openSearch"><Search :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ t('搜索会话') }}</span></button>
          <RouterLink class="rail-btn" :class="{ active: view === 'gallery' }" to="/gallery" :aria-label="t('作品广场')"><Globe :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ t('作品广场') }}</span></RouterLink>
          <RouterLink class="rail-btn" :class="{ active: view === 'library' }" to="/library" :aria-label="t('我的库')"><LayoutGrid :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ t('我的库') }}</span></RouterLink>
          <RouterLink v-for="item in creativeNavigation" :key="item.view" class="rail-btn" :class="{ active: activeMode === item.view }" :to="`/${item.view}`" :aria-label="t(item.label)" @click="onCreativeNav(item.view)"><component :is="item.icon" :size="20" :stroke-width="1.5" /><span class="rail-tip" aria-hidden="true">{{ t(item.label) }}</span></RouterLink>
          <RouterLink v-if="status.shortFilm" class="rail-btn" :class="{ active: view === 'workflow' }" to="/workflow" :aria-label="t('短片工坊')"><Film :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ t('短片工坊') }}</span></RouterLink>
        </nav>
        <div class="rail-bottom">
          <button type="button" class="rail-btn" :aria-label="t('创作设置')" @click="settingsOpen = true"><SettingsIcon :size="20" :stroke-width="1.75" /><span class="rail-tip" aria-hidden="true">{{ t('创作设置') }}</span></button>
          <button type="button" class="rail-avatar" :disabled="!ready" :aria-label="account.user ? t('我的账号 · {name}', { name: profileName }) : t('登录 / 注册')" @click="openAccount"><AccountAvatar class-name="rail-avatar-media" :name="profileName" :avatar="account.user?.avatar" :size="26" /><span class="rail-tip" aria-hidden="true">{{ account.user ? t('我的账号 · {name}', { name: profileName }) : t('登录 / 注册') }}</span></button>
        </div>
      </div>

      <div class="sidebar-panel">
        <div class="sidebar-drawer-header">
          <RouterLink class="brand" to="/" :aria-label="t('小o 首页')"><BrandLogo :size="32" /><span class="brand-wordmark"><img src="/brand/olai-wordmark.png" alt="olai" width="585" height="240" /></span></RouterLink>
          <div class="sidebar-header-actions">
            <button type="button" class="icon-button" :aria-label="t('搜索会话')" :aria-pressed="searchOpen" @click="searchOpen = !searchOpen; searchOpen && focusSearch()"><Search :size="18" :stroke-width="1.75" /></button>
            <button ref="sidebarPanelToggleRef" type="button" class="icon-button sidebar-panel-toggle" :aria-label="t('收起侧边栏')" :aria-expanded="sidebarOpen" :title="t('收起侧边栏')" @click="toggleSidebar"><PanelLeftClose :size="18" /></button>
          </div>
        </div>

        <nav :aria-label="t('主导航')">
          <button type="button" class="nav-item nav-new-chat" :disabled="chatBusy" :title="chatBusy ? t('请先停止当前回答，再发起新对话') : t('发起新对话')" @click="startNewConversation">
            <span class="nav-icon-box"><SquarePen :size="18" :stroke-width="1.75" /></span><span class="nav-label">{{ t('发起新对话') }}</span>
          </button>
          <RouterLink v-for="item in creativeNavigation" :key="item.view" class="nav-item" :class="{ active: activeMode === item.view }" :to="`/${item.view}`" @click="onCreativeNav(item.view)">
            <span class="nav-icon-box"><component :is="item.icon" :size="18" :stroke-width="1.5" /></span><span class="nav-label">{{ t(item.label) }}</span>
          </RouterLink>
          <RouterLink class="nav-item" :class="{ active: view === 'gallery' }" to="/gallery">
            <span class="nav-icon-box"><Globe :size="18" :stroke-width="1.75" /></span><span class="nav-label">{{ t('作品广场') }}</span>
          </RouterLink>
          <RouterLink class="nav-item" :class="{ active: view === 'library' }" to="/library">
            <span class="nav-icon-box"><LayoutGrid :size="18" :stroke-width="1.75" /></span><span class="nav-label">{{ t('我的库') }}</span>
            <span v-if="completedCount > 0" class="count-badge">{{ completedCount }}</span>
          </RouterLink>
          <RouterLink v-if="status.shortFilm" class="nav-item" :class="{ active: view === 'workflow' }" to="/workflow">
            <span class="nav-icon-box"><Film :size="18" :stroke-width="1.75" /></span><span class="nav-label">{{ t('短片工坊') }}</span><span class="nav-new">Beta</span>
          </RouterLink>
        </nav>

        <div class="history-section">
          <button type="button" class="history-section-toggle" :aria-expanded="historyExpanded" @click="historyExpanded = !historyExpanded">
            <span>{{ t('会话历史') }}</span><ChevronRight :size="16" :class="{ 'is-open': historyExpanded }" />
          </button>
          <input v-if="searchOpen" ref="searchRef" v-model="search" class="session-search" :aria-label="t('搜索会话标题')" :placeholder="t('搜索会话…')" />
          <div class="recent-sessions">
            <div v-for="conversation in visibleRecent" :key="conversation.id" class="session-row" :class="{ selected: isChatShell && activeId === conversation.id }">
              <RouterLink class="session-link" :to="`/chat/${encodeURIComponent(conversation.id)}`" :title="conversation.title">
                <component :is="sessionIcon(conversation)" :size="13" :stroke-width="1.75" class="session-kind" />
                <span>{{ conversation.title }}</span>
              </RouterLink>
              <div class="session-actions">
                <button type="button" class="icon-button" :aria-label="t('重命名会话')" :title="t('重命名会话')" @click.stop="rename(conversation)"><Pencil :size="14" /></button>
                <button type="button" class="icon-button" :aria-label="t('删除会话')" :title="t('删除会话')" :disabled="chatBusy" @click.stop="removeConversation(conversation)"><Trash2 :size="14" /></button>
              </div>
            </div>
            <div v-if="!visibleRecent.length" class="recent-empty"><MessageSquare :size="20" :stroke-width="1.5" /><p>{{ search ? t('没有匹配的会话') : t('还没有开始的对话') }}</p><small>{{ search ? t('换个关键词试试') : t('和小o聊聊，灵感会留在这里') }}</small></div>
            <button v-if="hasMoreHistory" type="button" class="history-more" @click="historyExpanded = true">{{ t('显示更多') }}</button>
          </div>
        </div>

        <div class="sidebar-bottom">
          <button type="button" class="profile-button" :disabled="!ready" @click="openAccount">
            <AccountAvatar class-name="profile-avatar" :name="profileName" :avatar="account.user?.avatar" :size="28" />
            <span>{{ profileName }}<small>{{ profileMeta }}</small></span>
          </button>
          <button type="button" class="icon-button profile-settings" :aria-label="t('创作设置')" :title="t('创作设置')" @click="settingsOpen = true"><SettingsIcon :size="18" :stroke-width="1.75" /></button>
        </div>
      </div>
    </aside>

    <main class="main-shell" :class="{ 'chat-main': isChatShell }" :inert="narrow && sidebarOpen">
      <button ref="sidebarToggleRef" type="button" class="icon-button workspace-menu-toggle" :aria-label="sidebarOpen ? t('收起侧边栏') : t('展开侧边栏')" :aria-expanded="sidebarOpen" @click="toggleSidebar"><PanelLeft :size="20" /></button>

      <div v-if="!ready" class="loading-workspace">
        <Companion :size="100" animated />
        <span class="loading-track"><i /></span>
        <p>{{ loadError || t('正在准备你的创作空间…') }}</p>
        <div v-if="loadError" style="display: flex; gap: 8px; margin-top: 12px">
          <button class="secondary-button" @click="reload">{{ t('重新加载') }}</button>
          <button class="secondary-button" @click="ready = true">{{ t('以游客模式进入') }}</button>
        </div>
      </div>

      <template v-else>
        <div v-if="account.user && (syncing || syncFailures.length)" class="guest-sync-notice" role="status">
          <span>{{ syncing ? t('正在后台同步游客记录，可继续创作。') : t('{n} 条游客记录同步未完成，内容仍保留在本地，可继续创作。', { n: syncFailures.length }) }}</span>
          <button v-if="syncFailures.length" class="secondary-button" :disabled="syncing" @click="runGuestSync(account.user.id)">{{ t('重试同步') }}</button>
        </div>
        <ChatWorkspace
          v-if="isChatShell"
          :kind="shellKind"
          :draft="creationDraft"
          :edit-asset="musicEdit"
          :user-name="profileName"
          :user-avatar="account.user?.avatar"
          @consumed-draft="creationDraft = null"
          @consumed-edit="musicEdit = null"
          @mode-change="router.push('/chat')"
          @new-conversation="startNewConversation"
        />
        <Library v-else-if="view === 'library'" @edit="editMusic" />
        <VideoWorkflow v-else-if="view === 'workflow' && status.shortFilm" @exit="router.push('/chat')" />
      </template>
    </main>

    <SettingsDialog v-if="settingsOpen" :initial="settings" :cloud="Boolean(account.user)" @close="settingsOpen = false" @save="savePreferences" />
    <div v-if="toastText" class="toast" role="status">
      <CircleAlert :size="17" /><span>{{ toastText }}</span>
      <button :aria-label="t('关闭通知')" @click="clearToast"><X :size="15" /></button>
    </div>
    <DialogHost />
    <GlobalPlayer />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronRight, CircleAlert, Film, Globe, Image as ImageIcon, LayoutGrid, MessageSquare, Music2, PanelLeft, PanelLeftClose, Pencil, Search, Settings as SettingsIcon, SquarePen, Trash2, Video, X } from 'lucide-vue-next';
import BrandLogo from '../components/BrandLogo.vue';
import AccountAvatar from '../components/AccountAvatar.vue';
import ChatWorkspace from '../components/ChatWorkspace.vue';
import Library from '../components/Library.vue';
import VideoWorkflow from '../components/VideoWorkflow.vue';
import SettingsDialog from '../components/SettingsDialog.vue';
import DialogHost from '../components/DialogHost.vue';
import GlobalPlayer from '../components/GlobalPlayer.vue';
import Companion from '../components/Companion.vue';
import { profileDisplayName } from '../lib/profile';
import { t } from '../lib/i18n';
import { loadStatus } from '../lib/status';
import type { Asset, Conversation, MediaKind, Settings } from '../lib/types';
import {
  account, activeConversation, activeId, changeSettings, chatBusy, completedCount, conversationKind, conversations, deleteConversation,
  initStudio, loadError, newConversation, ready, renameConversation, runGuestSync, settings, status, syncFailures, syncing,
} from '../composables/studio';
import { clearToast, notify, toastText } from '../composables/ui';
import { confirmAction, promptAction } from '../composables/dialog';

const props = withDefaults(defineProps<{ view?: string; conversationId?: string }>(), { view: 'chat', conversationId: '' });
const view = computed(() => props.view || 'chat');
const isChatShell = computed(() => view.value === 'chat' || view.value === 'image' || view.value === 'video' || view.value === 'music');
/** Media conversations reopen in their own composer and thread from a normal chat URL. */
const shellKind = computed<MediaKind | null>(() => {
  if (view.value === 'image' || view.value === 'video' || view.value === 'music') return view.value;
  if (view.value === 'chat' && props.conversationId) return conversationKind(activeConversation.value);
  return null;
});
const activeMode = computed(() => isChatShell.value ? (shellKind.value || 'chat') : '');
const router = useRouter();
const route = useRoute();
const sidebarOpen = ref(window.innerWidth > 768 ? localStorage.getItem('olai.sidebar') !== 'false' : false);
const narrow = ref(window.innerWidth <= 768);
const sidebarRef = ref<HTMLElement | null>(null);
const sidebarToggleRef = ref<HTMLButtonElement | null>(null);
const sidebarPanelToggleRef = ref<HTMLButtonElement | null>(null);
let drawerWasOpen = false;
let drawerFocusTimer: ReturnType<typeof setTimeout> | undefined;
const settingsOpen = ref(false);
const searchOpen = ref(false);
const search = ref('');
const historyExpanded = ref(false);
const searchRef = ref<HTMLInputElement | null>(null);
const creationDraft = ref<{ token: string; prompt: string; options: Record<string, string | number> } | null>(null);
const musicEdit = ref<Asset | null>(null);
const creativeNavigation = [
  { view: 'chat', label: 'AI 对话', icon: MessageSquare },
  { view: 'image', label: '图像', icon: ImageIcon },
  { view: 'video', label: '视频', icon: Video },
  { view: 'music', label: '音乐', icon: Music2 },
];
const profileName = computed(() => account.value.user ? profileDisplayName(account.value.user) : t('访客'));
const profileMeta = computed(() => account.value.user
  ? t('已同步{credits}', { credits: typeof account.value.points === 'number' ? t(' · {n} 积分', { n: account.value.points }) : '' })
  : t('各 {n} 次 / 天 · 对话 {m} 条', { n: account.value.generationLimit, m: account.value.chatLimit ?? 100 }));
const recent = computed(() => conversations.value.filter(conversation => conversation.title.toLowerCase().includes(search.value.toLowerCase())));
const visibleRecent = computed(() => historyExpanded.value || search.value || searchOpen.value ? recent.value : recent.value.slice(0, 5));
const hasMoreHistory = computed(() => !historyExpanded.value && !search.value && !searchOpen.value && recent.value.length > 5);

function reload() { window.location.reload(); }
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
  if (!narrow.value) { try { localStorage.setItem('olai.sidebar', String(sidebarOpen.value)); } catch { /* optional */ } }
}
function focusSearch() { void nextTick(() => searchRef.value?.focus()); }
function openSearch() { sidebarOpen.value = true; searchOpen.value = true; focusSearch(); }
function startNewConversation() {
  if (chatBusy.value) { notify(t('请先停止当前回答，再新建会话。')); return; }
  const mode = activeMode.value;
  if (mode === 'image' || mode === 'video' || mode === 'music') {
    // A media mode starts on a blank composer; the record is created by the first request.
    clearActiveConversation();
    if (route.path !== `/${mode}`) void router.push(`/${mode}`);
    return;
  }
  const id = newConversation('chat');
  if (!id) return;
  void router.push(`/chat/${encodeURIComponent(id)}`);
}
/** Clicking the current creation mode again starts a fresh conversation. */
function onCreativeNav(target: string) {
  if (target !== 'image' && target !== 'video' && target !== 'music') return;
  if (activeMode.value === target) startNewConversation();
}
function sessionIcon(conversation: Conversation) {
  const kind = conversationKind(conversation);
  return kind === 'image' ? ImageIcon : kind === 'video' ? Video : kind === 'music' ? Music2 : MessageSquare;
}
async function rename(conversation: { id: string; title: string; createdAt: number; updatedAt: number; messages: any[] }) {
  const title = await promptAction(t('给灵感起个名字'), t('一个容易记住的名字，让下次继续更轻松。'), conversation.title);
  if (title) await renameConversation(conversation as any, title);
}
async function removeConversation(conversation: any) {
  await deleteConversation(conversation);
  if (view.value === 'chat' && !activeId.value) void router.push('/chat');
}
function openAccount() {
  if (!ready.value) return;
  if (chatBusy.value) { notify(t('请先等待创作完成或停止当前回答，再切换账号。')); return; }
  window.location.assign(account.value.user ? '/account' : '/login');
}
function savePreferences(next: Settings) {
  changeSettings(next, true);
  settingsOpen.value = false;
}
function editMusic(asset: Asset) {
  if (!asset.song || chatBusy.value) { notify(t('请等待当前歌曲生成完成后再编辑。')); return; }
  musicEdit.value = asset;
  void router.push('/music');
  notify(t('已载入歌曲段落，修改后生成新作品。'));
}
function drawerControls() {
  return [...(sidebarRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])]
    .filter(element => element.getClientRects().length > 0);
}
function onWorkspaceKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    startNewConversation();
    return;
  }
  if (event.key === 'Escape' && sidebarOpen.value && !document.querySelector('dialog[open]') && !document.querySelector('[role="menu"]')) {
    sidebarOpen.value = false;
    return;
  }
  if (event.key !== 'Tab' || !narrow.value || !sidebarOpen.value) return;
  const controls = drawerControls();
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch([narrow, sidebarOpen], async ([isNarrow, open]) => {
  clearTimeout(drawerFocusTimer);
  if (!isNarrow) { drawerWasOpen = false; return; }
  if (!open) {
    if (!drawerWasOpen) return;
    drawerWasOpen = false;
    drawerFocusTimer = setTimeout(() => sidebarToggleRef.value?.focus(), 0);
    return;
  }
  drawerWasOpen = true;
  await nextTick();
  sidebarPanelToggleRef.value?.focus();
}, { flush: 'post' });

watch(() => props.conversationId, id => {
  if (id && conversations.value.some(item => item.id === id)) {
    activeId.value = id;
    try { localStorage.setItem('olai.active', id); } catch { /* optional */ }
  }
});
function clearActiveConversation() {
  activeId.value = '';
  try { localStorage.removeItem('olai.active'); } catch { /* optional */ }
}
// A creation mode always opens a blank composer; past records reopen from history.
watch([ready, view, () => props.conversationId], () => {
  if (!ready.value || props.conversationId) return;
  if (view.value === 'chat') {
    if (conversationKind(activeConversation.value) !== null) clearActiveConversation();
    return;
  }
  if (view.value === 'image' || view.value === 'video' || view.value === 'music') clearActiveConversation();
}, { immediate: true });
watch(() => route.fullPath, () => {
  if (narrow.value) sidebarOpen.value = false;
});
onMounted(async () => {
  const query = window.matchMedia('(max-width: 768px)');
  const update = () => {
    narrow.value = query.matches;
    if (query.matches) sidebarOpen.value = false;
    else { try { sidebarOpen.value = localStorage.getItem('olai.sidebar') !== 'false'; } catch { sidebarOpen.value = true; } }
  };
  query.addEventListener('change', update);
  window.addEventListener('keydown', onWorkspaceKeydown);
  await Promise.all([loadStatus().then(value => { status.value = value; }), initStudio()]);
  if (view.value === 'workflow' && !status.value.shortFilm) void router.replace('/chat');
  if (props.conversationId && conversations.value.some(item => item.id === props.conversationId)) activeId.value = props.conversationId;
});
onBeforeUnmount(() => {
  clearTimeout(drawerFocusTimer);
  window.removeEventListener('keydown', onWorkspaceKeydown);
});
</script>
