<template>
  <div class="adm-stack">
    <section class="adm-card">
      <div class="adm-card-head">
        <div class="adm-card-title">{{ t('账号详情') }}</div>
        <button type="button" class="adm-btn adm-btn-sm" @click="emit('close')">{{ t('收起') }}</button>
      </div>
      <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
      <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
      <template v-if="data">
        <dl class="adm-kv">
          <dt>{{ t('邮箱') }}</dt><dd>{{ data.user.email }}</dd>
          <dt>{{ t('账号 ID') }}</dt><dd class="adm-mono">{{ data.user.id }}</dd>
          <dt>{{ t('注册时间') }}</dt><dd>{{ adminWhen(data.user.createdAt) }}</dd>
          <dt>{{ t('当前积分') }}</dt><dd><strong>{{ data.user.balance }}</strong></dd>
          <dt>{{ t('状态') }}</dt><dd><span class="adm-badge" :data-tone="data.user.banned ? 'danger' : 'ok'">{{ data.user.banned ? t('已停用 · {reason}', { reason: data.user.banned.reason }) : t('正常') }}</span></dd>
          <dt>{{ t('累计消耗') }}</dt><dd>{{ t('{points} 积分 / {count} 次', { points: data.stats.spendPoints, count: data.stats.spendCount }) }}</dd>
          <dt>{{ t('媒体与作品') }}</dt><dd>{{ t('{media} 个对象 · {bytes} · {records} 条作品', { media: data.stats.mediaCount, bytes: adminBytes(data.stats.mediaBytes), records: data.stats.recordCount }) }}</dd>
          <dt>{{ t('第三方绑定') }}</dt><dd>{{ data.oauth.length ? data.oauth.map(item => providerLabel(item.provider)).join(t('、')) : t('无') }}</dd>
          <dt>{{ t('邀请人') }}</dt><dd>{{ data.invitedBy ? (data.invitedBy.rewardedAt ? t('{email}（已发放奖励）', { email: data.invitedBy.email }) : t('{email}（待发放）', { email: data.invitedBy.email })) : t('无') }}</dd>
        </dl>
        <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
        <form class="adm-form" style="margin-top: 16px" @submit.prevent="adjust">
          <div class="adm-form-inline">
            <label class="adm-field" style="flex: 0 0 130px"><span>{{ t('调整积分') }}</span><input v-model="delta" class="adm-input" type="number" step="1" min="-1000000" max="1000000" required :placeholder="t('如 100 或 -50')" /></label>
            <label class="adm-field" style="flex: 1 1 180px"><span>{{ t('原因（写入审计日志）') }}</span><input v-model="note" class="adm-input" maxlength="200" required :placeholder="t('例如：活动补偿 / 违规扣回')" /></label>
            <button type="submit" class="adm-btn adm-btn-primary" :disabled="busy || !delta">{{ t('调整') }}</button>
          </div>
          <p class="adm-note">{{ t('扣减不会让余额变成负数；每次调整都会写入积分流水与操作日志。') }}</p>
        </form>
        <div class="adm-form-inline" style="margin-top: 12px">
          <template v-if="!data.user.banned">
            <label class="adm-field" style="flex: 1 1 220px"><span>{{ t('停用原因') }}</span><input v-model="banReason" class="adm-input" maxlength="200" :placeholder="t('例如：批量注册 / 违规内容')" /></label>
            <button type="button" class="adm-btn adm-btn-danger" :disabled="busy" @click="toggleBan(true)">{{ t('停用账号') }}</button>
          </template>
          <button v-else type="button" class="adm-btn" :disabled="busy" @click="toggleBan(false)">{{ t('恢复账号') }}</button>
        </div>
      </template>
    </section>

    <section v-if="data" class="adm-card">
      <div class="adm-card-head"><div class="adm-card-title">{{ t('最近积分流水') }}</div></div>
      <div v-if="data.ledger.length" class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ t('时间') }}</th><th>{{ t('类型') }}</th><th class="num">{{ t('变动') }}</th></tr></thead>
          <tbody><tr v-for="row in data.ledger" :key="`${row.refId}-${row.createdAt}`"><td class="muted">{{ adminWhen(row.createdAt) }}</td><td>{{ LEDGER_REASONS[row.reason] || row.reason }}</td><td class="num" :style="{ color: row.delta > 0 ? 'var(--color-success)' : 'var(--color-danger)' }">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</td></tr></tbody>
        </table>
      </div>
      <div v-else class="adm-empty">{{ t('暂无流水。') }}</div>
    </section>

    <section v-if="data?.invites.length" class="adm-card">
      <div class="adm-card-head"><div class="adm-card-title">{{ t('邀请记录') }}</div></div>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ t('被邀请人') }}</th><th>{{ t('邀请码') }}</th><th>{{ t('时间') }}</th><th>{{ t('奖励') }}</th></tr></thead>
          <tbody><tr v-for="row in data.invites" :key="row.email + row.createdAt"><td>{{ row.email || '—' }}</td><td class="adm-mono">{{ row.code }}</td><td class="muted">{{ adminWhen(row.createdAt) }}</td><td><span class="adm-badge" :data-tone="row.rewarded ? 'ok' : 'warn'">{{ row.rewarded ? t('已发放') : t('待首次生成') }}</span></td></tr></tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { LEDGER_REASONS, adminApi, adminBytes, adminWhen, errorMessage, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ changed: []; close: [] }>();
interface DetailData {
  user: { id: string; email: string; createdAt: number; balance: number; banned: { reason: string; bannedAt: number } | null };
  oauth: { provider: string; createdAt: number }[];
  stats: { spendCount: number; spendPoints: number; mediaCount: number; mediaBytes: number; recordCount: number };
  ledger: { delta: number; reason: string; refId: string; createdAt: number }[];
  invites: { email: string; code: string; createdAt: number; rewardedAt: number | null; rewarded: boolean }[];
  invitedBy: { email: string; code: string; createdAt: number; rewardedAt: number | null } | null;
}
const data = ref<DetailData | null>(null);
const error = ref('');
const loading = ref(true);
const delta = ref('');
const note = ref('');
const banReason = ref('');
const busy = ref(false);
const message = ref<FeedbackMessage>(null);
const providerLabel = (provider: string) => provider === 'github' ? 'GitHub' : provider === 'google' ? 'Google' : provider;
async function load() {
  loading.value = true;
  try { data.value = await adminApi<DetailData>(`/api/admin/users/${encodeURIComponent(props.id)}`); error.value = ''; }
  catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
async function adjust() {
  busy.value = true; message.value = null;
  try {
    const result = await adminApi<{ balance: number }>(`/api/admin/users/${encodeURIComponent(props.id)}/points`, { method: 'POST', body: JSON.stringify({ delta: Number(delta.value), note: note.value }) });
    message.value = { tone: 'ok', text: t('已调整，当前余额 {balance}。', { balance: result.balance }) };
    delta.value = ''; note.value = '';
    await load(); emit('changed');
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '调整失败。') }; }
  finally { busy.value = false; }
}
async function toggleBan(banned: boolean) {
  if (banned && !banReason.value.trim()) { message.value = { tone: 'error', text: t('请填写停用原因。') }; return; }
  if (!window.confirm(banned ? t('停用后该账号会立即退出登录，且无法再登录。确认停用？') : t('确认恢复该账号？'))) return;
  busy.value = true; message.value = null;
  try {
    await adminApi(`/api/admin/users/${encodeURIComponent(props.id)}/ban`, { method: 'POST', body: JSON.stringify({ banned, reason: banReason.value }) });
    message.value = { tone: 'ok', text: banned ? t('账号已停用。') : t('账号已恢复。') };
    banReason.value = '';
    await load(); emit('changed');
  } catch (failure) { message.value = { tone: 'error', text: errorMessage(failure, '操作失败。') }; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
