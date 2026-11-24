<template>
  <AppDialog labelled-by="share-title" class-name="share-dialog" @close="emit('close')">
    <div class="share-dialog-inner">
      <header class="share-header">
        <h2 id="share-title">{{ t('分享') }}</h2>
        <button type="button" class="icon-button share-close" :aria-label="t('关闭分享')" @click="emit('close')"><X :size="18" /></button>
      </header>

      <div class="share-targets" role="group" :aria-label="t('分享到')">
        <button
          v-for="target in targets"
          :key="target.key"
          type="button"
          class="share-target"
          :aria-label="target.key === 'copy' && copyState === 'copied' ? t('已复制') : t('分享到 {target}', { target: target.label })"
          :data-dialog-focus="!signedIn && target.key === 'copy' ? true : undefined"
          @click="choose(target.key)"
        >
          <span class="share-target-icon" :class="`is-${target.key}`" aria-hidden="true">
            <template v-if="target.key === 'copy'">
              <Check v-if="copyState === 'copied'" :size="22" />
              <Link2 v-else :size="22" />
            </template>
            <svg v-else-if="target.key === 'whatsapp'" viewBox="0 0 24 24">
              <path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
            <svg v-else-if="target.key === 'messenger'" viewBox="5.2 7 15.1 8.6">
              <path fill="currentColor" d="M15.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.26L19.752 8l-6.561 6.963Z" />
            </svg>
            <svg v-else-if="target.key === 'facebook'" viewBox="0 0 24 24">
              <path fill="currentColor" d="M24 12.073C24 5.446 18.627 0 12 0S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
            </svg>
            <svg v-else-if="target.key === 'x'" viewBox="0 0 24 24">
              <path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
            </svg>
          </span>
          <span class="share-target-label">{{ target.key === 'copy' && copyState === 'copied' ? t('已复制') : target.label }}</span>
        </button>
      </div>

      <div class="share-divider" />

      <section class="share-people" :aria-label="t('分享给站内用户')">
        <label class="share-search">
          <Search :size="18" aria-hidden="true" />
          <input
            v-model="query"
            type="search"
            :placeholder="t('搜索用户')"
            :aria-label="t('搜索用户')"
            :disabled="!signedIn"
            :data-dialog-focus="signedIn ? true : undefined"
            autocomplete="off"
            spellcheck="false"
          />
          <LoaderCircle v-if="peopleLoading" :size="16" class="spin" :aria-label="t('正在搜索用户…')" />
        </label>

        <p v-if="!signedIn" class="share-empty">
          {{ t('登录后可以把作品分享给站内用户。') }}
          <RouterLink :to="loginTo">{{ t('去登录') }}</RouterLink>
        </p>

        <template v-else>
          <p v-if="peopleError" class="share-error" role="alert">{{ peopleError }}</p>
          <ul v-else-if="people.length" class="share-people-list" :aria-label="t('可分享的用户')">
            <li v-for="person in people" :key="person.id" class="share-person">
              <AccountAvatar :name="person.name" :avatar="person.avatar" :size="40" />
              <span class="share-person-id">
                <strong>{{ person.name }}</strong>
                <small>@{{ person.id }}</small>
              </span>
              <button
                type="button"
                class="share-send"
                :class="{ 'is-sent': sent.has(person.id) }"
                :disabled="sent.has(person.id) || sendingId === person.id"
                @click="sendTo(person)"
              >
                <Check v-if="sent.has(person.id)" :size="14" />
                {{ sent.has(person.id) ? t('已发送') : sendingId === person.id ? t('发送中…') : t('发送') }}
              </button>
            </li>
          </ul>
          <p v-else-if="!peopleLoading" class="share-empty">
            {{ query.trim() ? t('没有找到可以私信的用户。') : t('输入名字或主页地址，找到想分享的人。') }}
          </p>
        </template>

        <p v-if="hint" class="share-hint" role="status">{{ hint }}</p>
        <input
          v-if="manualLink"
          ref="manualInput"
          class="share-manual"
          :value="manualLink"
          :aria-label="t('作品链接')"
          readonly
          @focus="selectManualLink"
        />
      </section>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, Link2, LoaderCircle, Search, X } from 'lucide-vue-next';
import AccountAvatar from './AccountAvatar.vue';
import AppDialog from './AppDialog.vue';
import { t } from '../lib/i18n';
import { galleryTitle } from '../lib/galleryDetail';
import { getInbox, searchUsers, sendMessage, type ShareUser } from '../lib/people';
import type { Asset } from '../lib/types';

const props = defineProps<{ asset: Asset; signedIn: boolean }>();
const emit = defineEmits<{ close: [] }>();

const targets = computed(() => [
  { key: 'copy' as const, label: t('复制链接') },
  { key: 'whatsapp' as const, label: 'WhatsApp' },
  { key: 'messenger' as const, label: 'Messenger' },
  { key: 'facebook' as const, label: 'Facebook' },
  { key: 'x' as const, label: 'X' },
]);

const title = computed(() => galleryTitle(props.asset));
const link = computed(() => {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/?work=${encodeURIComponent(props.asset.id)}`;
});
const loginTo = computed(() => {
  const next = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
});

const query = ref('');
const people = ref<ShareUser[]>([]);
const suggestions = ref<ShareUser[]>([]);
const peopleLoading = ref(false);
const peopleError = ref('');
const sendingId = ref('');
const sent = ref(new Set<string>());
const hint = ref('');
const copyState = ref<'' | 'copied' | 'failed'>('');
const manualLink = ref('');
const manualInput = ref<HTMLInputElement | null>(null);

let copyTimer: ReturnType<typeof setTimeout> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchController: AbortController | null = null;

async function copyLink(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(link.value);
    return true;
  } catch {
    // Older webviews may lack the async clipboard; a hidden field still lets
    // the copy happen inside the same click.
    try {
      const field = document.createElement('textarea');
      field.value = link.value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

async function copyShareLink() {
  const copied = await copyLink();
  copyState.value = copied ? 'copied' : 'failed';
  if (copied) {
    manualLink.value = '';
    hint.value = t('链接已复制，可以分享给朋友。');
  } else {
    manualLink.value = link.value;
    hint.value = t('复制失败，请手动复制链接。');
    await nextTick();
    manualInput.value?.select();
  }
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => { copyState.value = ''; }, 1800);
}

function selectManualLink(event: Event) {
  (event.target as HTMLInputElement).select();
}

/** External channels open in a new tab; the sheet closes like a native one. */
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
  emit('close');
}

function choose(key: 'copy' | 'whatsapp' | 'messenger' | 'facebook' | 'x') {
  if (key === 'copy') {
    void copyShareLink();
    return;
  }
  const encodedLink = encodeURIComponent(link.value);
  if (key === 'whatsapp') {
    openExternal(`https://wa.me/?text=${encodeURIComponent(`${title.value} ${link.value}`)}`);
  } else if (key === 'facebook') {
    openExternal(`https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`);
  } else if (key === 'x') {
    openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title.value)}&url=${encodedLink}`);
  } else {
    shareToMessenger(encodedLink);
  }
}

/** Messenger has no app-id-free web share URL: phones use the app, desktop copies. */
function shareToMessenger(encodedLink: string) {
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = `fb-messenger://share/?link=${encodedLink}`;
    emit('close');
    return;
  }
  window.open('https://www.messenger.com/', '_blank', 'noopener,noreferrer');
  void copyLink().then(copied => {
    if (copied) {
      manualLink.value = '';
      hint.value = t('链接已复制，请在 Messenger 中粘贴。');
      return;
    }
    manualLink.value = link.value;
    hint.value = t('复制失败，请手动复制链接。');
    void nextTick(() => manualInput.value?.select());
  });
}

function scheduleSearch() {
  if (!props.signedIn) return;
  window.clearTimeout(searchTimer);
  const text = query.value.trim();
  if (!text) {
    searchController?.abort();
    searchController = null;
    peopleLoading.value = false;
    peopleError.value = '';
    people.value = suggestions.value;
    return;
  }
  peopleLoading.value = true;
  peopleError.value = '';
  searchTimer = window.setTimeout(() => { void runSearch(text); }, 240);
}

async function runSearch(text: string) {
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  try {
    const result = await searchUsers(text, controller.signal);
    if (controller.signal.aborted || query.value.trim() !== text) return;
    people.value = result.users;
  } catch (cause) {
    if (controller.signal.aborted) return;
    people.value = [];
    peopleError.value = cause instanceof Error ? cause.message : t('搜索暂不可用，请稍后重试。');
  } finally {
    if (!controller.signal.aborted) peopleLoading.value = false;
  }
}

async function loadSuggestions() {
  if (!props.signedIn) return;
  peopleLoading.value = true;
  try {
    const result = await getInbox();
    suggestions.value = result.conversations.map(item => item.with).slice(0, 8);
    if (!query.value.trim()) people.value = suggestions.value;
  } catch {
    // Suggestions are a shortcut; searching still works without them.
  } finally {
    // A search the reader started meanwhile keeps the spinner until it ends.
    if (!query.value.trim()) peopleLoading.value = false;
  }
}

async function sendTo(person: ShareUser) {
  if (sendingId.value || sent.value.has(person.id)) return;
  sendingId.value = person.id;
  peopleError.value = '';
  hint.value = '';
  try {
    await sendMessage(person.id, t('分享作品「{title}」：{link}', { title: title.value, link: link.value }));
    const next = new Set(sent.value);
    next.add(person.id);
    sent.value = next;
    hint.value = t('已发送给 {name}', { name: person.name });
  } catch (cause) {
    peopleError.value = cause instanceof Error ? cause.message : t('发送失败，请稍后重试。');
  } finally {
    sendingId.value = '';
  }
}

watch(query, scheduleSearch);

onMounted(() => { void loadSuggestions(); });
onBeforeUnmount(() => {
  window.clearTimeout(copyTimer);
  window.clearTimeout(searchTimer);
  searchController?.abort();
});
</script>
