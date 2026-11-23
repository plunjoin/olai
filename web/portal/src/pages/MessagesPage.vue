<template>
  <div class="plaza-shell messages-shell">
    <PlazaRail :user="me" :short-film="shortFilm" />
    <div class="plaza-main">
      <header class="profile-bar">
        <RouterLink to="/" class="profile-back"><ArrowLeft :size="16" />{{ t('作品广场') }}</RouterLink>
        <h1>{{ t('私信') }}</h1>
      </header>
      <main class="messages-main">
        <div v-if="!me && !loading" class="messages-gate">
          <p>{{ t('登录后可以和创作者私信。') }}</p>
          <RouterLink to="/login?next=%2Fmessages">{{ t('去登录') }}</RouterLink>
        </div>
        <template v-else>
          <aside class="messages-list" :aria-label="t('会话列表')">
            <p v-if="!inbox.length" class="profile-status">{{ t('还没有私信。在创作者主页点私信即可开始。') }}</p>
            <RouterLink
              v-for="item in inbox"
              :key="item.id"
              class="messages-item"
              :class="{ 'is-active': item.with.id === active }"
              :to="`/messages/${item.with.id}`"
            >
              <AccountAvatar :name="item.with.name" :avatar="item.with.avatar" :size="36" />
              <span>
                <strong>{{ item.with.name }}</strong>
                <small>{{ item.last || t('还没有消息') }}</small>
              </span>
              <em v-if="item.unread">{{ item.unread }}</em>
            </RouterLink>
          </aside>
          <section v-if="active" class="messages-thread">
            <header v-if="partner" class="messages-thread-head">
              <RouterLink :to="`/u/${partner.id}`">
                <AccountAvatar :name="partner.name" :avatar="partner.avatar" :size="28" />
                <strong>{{ partner.name }}</strong>
              </RouterLink>
            </header>
            <p v-if="threadError" class="profile-notice" role="alert">{{ threadError }}</p>
            <ol>
              <li v-for="message in messages" :key="message.id" :class="{ 'is-mine': message.mine }">
                <p>{{ message.body }}</p>
              </li>
            </ol>
            <form @submit.prevent="submit">
              <textarea v-model="draft" :maxlength="2000" :aria-label="t('私信内容')" :placeholder="t('写一条私信')" />
              <button type="submit" class="secondary-button" :disabled="sending || !draft.trim()">{{ sending ? t('发送中…') : t('发送') }}</button>
            </form>
          </section>
          <section v-else class="messages-thread">
            <p class="profile-status">{{ t('选择左侧的会话，或从创作者主页发起私信。') }}</p>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';
import AccountAvatar from '../components/AccountAvatar.vue';
import PlazaRail from '../components/plaza/PlazaRail.vue';
import { accountRequest, type Account } from '../lib/account';
import { t } from '../lib/i18n';
import { getConversation, getInbox, sendMessage, type DirectMessage, type InboxItem } from '../lib/people';

const route = useRoute();
const me = ref<Account | null>(null);
const shortFilm = ref(false);
const loading = ref(true);
const inbox = ref<InboxItem[]>([]);
const messages = ref<DirectMessage[]>([]);
const drafts = ref<Record<string, string>>({});
const sending = ref(false);
const threadError = ref('');
const active = computed(() => String(route.params.handle || ''));
const partner = computed(() => inbox.value.find(item => item.with.id === active.value)?.with ?? null);
const draft = computed({
  get: () => drafts.value[active.value] ?? '',
  set: (value: string) => {
    if (!active.value) return;
    drafts.value = { ...drafts.value, [active.value]: value };
  },
});

async function loadInbox() {
  const result = await getInbox();
  inbox.value = result.conversations;
}

async function loadThread() {
  if (!active.value) { messages.value = []; return; }
  threadError.value = '';
  try {
    messages.value = (await getConversation(active.value)).messages;
    await loadInbox();
  } catch (cause) {
    threadError.value = cause instanceof Error ? cause.message : t('私信暂不可用，请稍后重试。');
  }
}

async function submit() {
  const body = draft.value.trim();
  const handle = active.value;
  if (!body || sending.value || !handle) return;
  sending.value = true;
  threadError.value = '';
  try {
    const result = await sendMessage(handle, body);
    if (active.value === handle) messages.value = result.messages;
    const next = { ...drafts.value };
    delete next[handle];
    drafts.value = next;
    await loadInbox();
  } catch (cause) {
    threadError.value = cause instanceof Error ? cause.message : t('私信暂不可用，请稍后重试。');
  } finally {
    sending.value = false;
  }
}

watch(active, loadThread);
onMounted(async () => {
  try {
    const state = await accountRequest('me');
    me.value = state.user;
    shortFilm.value = Boolean(state.shortFilm);
    if (state.user) await loadInbox();
  } catch { /* 未登录时只显示登录提示。 */ }
  finally { loading.value = false; }
  if (me.value && active.value) await loadThread();
});
</script>
