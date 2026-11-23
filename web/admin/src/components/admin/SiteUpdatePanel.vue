<template>
  <section class="adm-card">
    <div class="adm-card-head">
      <div>
        <div class="adm-card-title">{{ t('整站更新') }}</div>
        <div class="adm-card-sub">{{ t('服务端与前端一起更新：触发 GitHub Actions，按部署脚本备份数据（如适用），再拉取镜像并做健康检查；失败会自动回滚。') }}</div>
      </div>
      <button type="button" class="adm-btn adm-btn-sm" :disabled="loading || busy" @click="load()">
        {{ loading ? t('检查中…') : t('重新检查') }}
      </button>
    </div>

    <p v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }}</p>
    <p v-if="message" class="adm-feedback" :data-tone="message.tone" role="status">{{ message.text }}</p>
    <p v-if="data?.error" class="adm-feedback" data-tone="error" role="alert">{{ data.error }}</p>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>

    <template v-if="data">
      <dl class="adm-kv adm-update-meta">
        <dt>{{ t('当前版本') }}</dt>
        <dd>
          <strong>{{ data.current.version === 'dev' ? 'dev' : `v${data.current.version}` }}</strong>
          <span v-if="data.current.commit" class="adm-mono"> · {{ data.current.commit }}</span>
          <span v-if="data.current.builtAt" class="adm-note"> · {{ data.current.builtAt }}</span>
        </dd>
        <dt>{{ t('发布来源') }}</dt>
        <dd class="adm-mono">{{ data.repo || '—' }} · {{ data.workflow || '—' }} @ {{ data.ref || '—' }}</dd>
        <dt>{{ t('最新版本') }}</dt>
        <dd>
          <template v-if="data.latestTag">
            <strong>{{ data.latestTag }}</strong>
            <span v-if="data.updateAvailable" class="adm-badge" data-tone="warn">{{ t('可更新') }}</span>
            <span v-else class="adm-badge" data-tone="ok">{{ t('已是最新') }}</span>
          </template>
          <span v-else>—</span>
        </dd>
      </dl>

      <p v-if="!data.enabled" class="adm-note">
        {{ t('整站更新尚未启用。请在下方「版本与更新」中开启，并填写 GitHub 仓库、部署工作流和令牌。') }}
      </p>
      <p v-else-if="!data.configured" class="adm-note">
        {{ t('整站更新配置不完整。请填写仓库、工作流、分支和 GitHub 令牌后再试。') }}
      </p>
      <template v-else>
        <div class="adm-update-actions">
          <Select
            v-model="selected"
            class-name="adm-select"
            :aria-label="t('选择整站版本')"
            :options="tagOptions"
          />
          <a v-if="safeGitHubUrl(active?.htmlUrl)" class="adm-btn adm-btn-sm" :href="safeGitHubUrl(active?.htmlUrl)" target="_blank" rel="noreferrer noopener">{{ t('查看部署进度') }}</a>
          <button type="button" class="adm-btn adm-btn-primary" :disabled="busy || !selected || Boolean(active)" @click="start">
            {{ busy ? t('触发中…') : active ? t('部署进行中') : t('更新整站') }}
          </button>
        </div>
        <p v-if="active" class="adm-note">
          {{ t('部署状态：{status}', { status: runLabel(active) }) }}<template v-if="active.status === 'waiting'"> · {{ t('需要在 GitHub 的 production 环境中审批。') }}</template>
        </p>
        <p v-else class="adm-note">
          {{ t('只选择已推送 tag 且 Release image 已完成的版本。部署期间站点会短暂重启，后台连接可能中断。') }}
        </p>

        <div v-if="data.runs.length" class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ t('时间') }}</th><th>{{ t('部署') }}</th><th>{{ t('状态') }}</th><th>{{ t('操作') }}</th></tr></thead>
            <tbody>
              <tr v-for="run in data.runs" :key="run.id">
                <td class="muted">{{ run.createdAt ? adminWhen(Date.parse(run.createdAt)) : '—' }}</td>
                <td>{{ run.displayTitle || t('整站部署') }}</td>
                <td><span class="adm-badge" :data-tone="runTone(run)">{{ runLabel(run) }}</span></td>
                <td><a v-if="safeGitHubUrl(run.htmlUrl)" class="adm-link" :href="safeGitHubUrl(run.htmlUrl)" target="_blank" rel="noreferrer noopener">{{ t('打开') }}</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Select from '../ui/Select.vue';
import { adminApi, adminWhen, errorMessage, type FeedbackMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface UpdateTag { name: string; sha?: string }
interface UpdateRun {
  id: number; status: string; conclusion?: string; displayTitle?: string;
  createdAt?: string; updatedAt?: string; htmlUrl?: string;
}
interface UpdateStatus {
  enabled: boolean; configured: boolean;
  current: { version: string; commit?: string; builtAt?: string };
  repo?: string; workflow?: string; ref?: string;
  latestTag?: string; updateAvailable: boolean;
  tags: UpdateTag[]; runs: UpdateRun[]; error?: string;
}

const data = ref<UpdateStatus | null>(null);
const selected = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const message = ref<FeedbackMessage>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let retryUntil = 0;

const tagOptions = computed(() => (data.value?.tags ?? []).map(tag => ({
  value: tag.name,
  label: tag.name === data.value?.latestTag ? `${tag.name} · ${t('最新')}` : tag.name,
})));
const active = computed(() => data.value?.runs.find(run => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)) ?? null);

function safeGitHubUrl(value?: string) {
  return value && /^https:\/\/github\.com\//i.test(value) ? value : '';
}

function runLabel(run: UpdateRun) {
  if (run.status === 'queued' || run.status === 'pending' || run.status === 'requested') return t('排队中');
  if (run.status === 'in_progress') return t('部署中');
  if (run.status === 'waiting') return t('等待审批');
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return t('已完成');
    if (run.conclusion === 'cancelled') return t('已取消');
    if (run.conclusion === 'skipped') return t('已跳过');
    return t('失败');
  }
  return run.status || '—';
}

function runTone(run: UpdateRun) {
  if (run.status === 'completed' && run.conclusion === 'success') return 'ok';
  if (run.status === 'completed') return 'danger';
  if (run.status === 'waiting') return 'warn';
  return 'info';
}

function syncPolling() {
  const shouldPoll = Boolean(active.value) || Date.now() < retryUntil;
  if (shouldPoll && !timer) {
    timer = setInterval(() => { void load(true); }, 15_000);
  } else if (!shouldPoll && timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function load(silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = '';
    message.value = null;
  }
  try {
    const next = await adminApi<UpdateStatus>('/api/admin/site-update');
    data.value = next;
    error.value = '';
    if (!selected.value || !next.tags.some(tag => tag.name === selected.value)) {
      selected.value = next.latestTag || next.tags[0]?.name || '';
    }
  } catch (failure) {
    const text = errorMessage(failure, '整站更新状态读取失败。');
    if (silent) {
      message.value = { tone: 'error', text: t('站点可能正在重启；稍后会自动重试。{reason}', { reason: text }) };
    } else {
      error.value = text;
    }
  } finally {
    loading.value = false;
    syncPolling();
  }
}

async function start() {
  const tag = selected.value;
  if (!tag || busy.value) return;
  if (!window.confirm(t('将把整站更新到 {tag}。部署会备份数据、替换容器并重启站点，期间可能短暂无法访问。确认继续？', { tag }))) return;
  busy.value = true;
  message.value = null;
  error.value = '';
  try {
    await adminApi('/api/admin/site-update', { method: 'POST', body: JSON.stringify({ tag }) });
    message.value = { tone: 'ok', text: t('已触发整站部署。完成后站点会自动切换版本，可稍后重新检查。') };
    retryUntil = Date.now() + 90_000;
    await load(true);
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '触发整站更新失败。') };
  } finally {
    busy.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>
