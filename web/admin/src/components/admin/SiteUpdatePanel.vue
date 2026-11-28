<template>
  <section class="adm-card adm-update-card">
    <div class="adm-card-head">
      <div>
        <div class="adm-card-title">{{ t('整站更新') }}</div>
        <div class="adm-card-sub">{{ t('检查 GitHub 发布版本，通过 Actions 完成备份、部署与健康检查；失败时按部署脚本回滚。') }}</div>
      </div>
      <span v-if="data" class="adm-badge" :data-tone="phaseTone">{{ disconnected ? t('重连中') : phaseLabel }}</span>
    </div>

    <p v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }}</p>
    <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>

    <div v-if="data" class="adm-update-body">
      <dl class="adm-kv adm-update-meta">
        <dt>{{ t('当前版本') }}</dt>
        <dd>
          <strong class="adm-mono">{{ currentVersion }}</strong>
          <span v-if="data.current.commit" class="adm-mono"> · {{ data.current.commit.slice(0, 12) }}</span>
          <span v-if="data.current.builtAt" class="adm-note"> · {{ data.current.builtAt }}</span>
        </dd>
        <dt>{{ t('发布来源') }}</dt>
        <dd class="adm-mono">{{ data.repo || '—' }} · {{ data.workflow || '—' }} @ {{ data.ref || '—' }}</dd>
      </dl>

      <div class="adm-update-grid">
        <div class="adm-update-box">
          <div class="adm-update-box-label">{{ t('当前部署') }}</div>
          <div class="adm-update-box-value">{{ currentVersion }}</div>
          <code class="adm-update-box-code">{{ data.current.commit || '—' }}</code>
        </div>
        <div class="adm-update-box">
          <div class="adm-update-box-label">{{ t('目标版本') }}</div>
          <div class="adm-update-box-value">{{ selected || t('尚未选择') }}</div>
          <code class="adm-update-box-code">{{ targetSha || t('从 GitHub 发布版本中选择') }}</code>
        </div>
      </div>

      <div class="adm-update-state" :data-tone="stateTone">
        <strong>{{ disconnected ? t('服务正在重启，正在重新连接…') : stateLabel }}</strong>
        <p>{{ stateMessage }}</p>
      </div>

      <p v-if="!data.enabled" class="adm-note">
        {{ t('整站更新尚未启用。请在下方「版本与更新」中开启，并填写 GitHub 仓库、部署工作流和令牌。') }}
      </p>
      <p v-else-if="!data.configured" class="adm-note">
        {{ t('整站更新配置不完整。请填写仓库、工作流、分支和 GitHub 令牌后再试。') }}
      </p>

      <div class="adm-update-actions">
        <label class="adm-update-field">
          <span>{{ t('选择版本') }}</span>
          <Select
            v-model="selected"
            class-name="adm-select"
            :aria-label="t('选择整站版本')"
            :disabled="!data.enabled || !data.configured || busy"
            :options="tagOptions"
          />
        </label>
        <a v-if="safeGitHubUrl(active?.htmlUrl)" class="adm-btn adm-btn-sm" :href="safeGitHubUrl(active?.htmlUrl)" target="_blank" rel="noreferrer noopener">{{ t('查看部署进度') }}</a>
        <button type="button" class="adm-btn" :disabled="loading || busy" @click="load()">
          <span v-if="loading" class="adm-spinner" />
          {{ loading ? t('检查中…') : t('重新检查') }}
        </button>
        <button type="button" class="adm-btn adm-btn-primary" :disabled="busy || !selected || Boolean(active) || !data.enabled || !data.configured" @click="start">
          {{ busy ? t('触发中…') : active ? t('部署进行中') : t('更新整站') }}
        </button>
      </div>

      <div v-if="data.runs.length" class="adm-table-wrap adm-update-runs">
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

type UpdatePhase = 'idle' | 'checking' | 'ready' | 'up_to_date' | 'starting' | 'deploying' | 'waiting' | 'completed' | 'rolled_back' | 'failed';
const busyPhases: UpdatePhase[] = ['checking', 'starting', 'deploying', 'waiting'];
const phaseLabels: Record<UpdatePhase, string> = {
  idle: t('等待检查'),
  checking: t('正在检查发布版本'),
  ready: t('有可用更新'),
  up_to_date: t('已是最新版本'),
  starting: t('正在触发部署'),
  deploying: t('正在部署新版本'),
  waiting: t('等待审批'),
  completed: t('更新完成'),
  rolled_back: t('已恢复旧版本'),
  failed: t('更新失败'),
};
const phaseTones: Record<UpdatePhase, string> = {
  idle: '', checking: 'warn', ready: 'info', up_to_date: 'ok', starting: 'warn',
  deploying: 'warn', waiting: 'warn', completed: 'ok', rolled_back: 'danger', failed: 'danger',
};

const data = ref<UpdateStatus | null>(null);
const selected = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const message = ref<FeedbackMessage>(null);
const disconnected = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
let retryUntil = 0;
let lastTargetTag = '';
let lastCompletedRunId = 0;
let initialRunId = 0;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = true;

const currentVersion = computed(() => {
  const version = data.value?.current.version ?? 'dev';
  return version === 'dev' ? 'dev' : version.startsWith('v') ? version : `v${version}`;
});
const tagOptions = computed(() => (data.value?.tags ?? []).map(tag => ({
  value: tag.name,
  label: tag.name === data.value?.latestTag ? `${tag.name} · ${t('最新')}` : tag.name,
})));
const targetSha = computed(() => data.value?.tags.find(tag => tag.name === selected.value)?.sha ?? '');
const active = computed(() => data.value?.runs.find(run => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)) ?? null);
const latestSuccessful = computed(() => data.value?.runs.find(run => run.status === 'completed' && run.conclusion === 'success') ?? null);
const currentTag = computed(() => data.value && data.value.tags.some(tag => tag.name === currentVersion.value) ? currentVersion.value : '');

const phase = computed<UpdatePhase>(() => {
  if (busy.value) return 'checking';
  const run = active.value;
  if (run) {
    if (run.status === 'waiting') return 'waiting';
    return run.status === 'in_progress' ? 'deploying' : 'starting';
  }
  if (data.value?.error) return 'failed';
  const finished = data.value?.runs[0];
  if (finished?.status === 'completed' && finished.conclusion === 'success' && finished.id === lastCompletedRunId) return 'completed';
  if (finished?.status === 'completed' && finished.conclusion !== 'success' && finished.id === lastCompletedRunId) return 'rolled_back';
  if (data.value?.latestTag) return data.value.updateAvailable ? 'ready' : 'up_to_date';
  return 'idle';
});
const phaseLabel = computed(() => phaseLabels[phase.value]);
const phaseTone = computed(() => phaseTones[phase.value]);
const stateTone = computed(() => phaseTone.value || 'info');
const stateLabel = computed(() => phaseLabel.value);
const latestRun = computed(() => data.value?.runs[0] ?? null);
const latestRunFinished = computed(() => latestRun.value?.status === 'completed');
const stateMessage = computed(() => {
  if (message.value) return message.value.text;
  if (disconnected.value) return t('部署期间连接中断；页面会自动重试，无需手动刷新。');
  if (data.value?.error) return data.value.error;
  const run = active.value;
  if (run) {
    if (run.status === 'waiting') return t('需要在 GitHub 的 production 环境中审批。部署完成后站点会自动切换版本。');
    return t('GitHub Actions 正在执行部署。页面会自动更新状态；期间站点可能短暂无法访问。');
  }
  const finished = latestSuccessful.value;
  if (finished && finished.id === lastCompletedRunId) return t('最近一次成功部署：{title}。', { title: finished.displayTitle || t('整站部署') });
  return t('点击“重新检查”拉取 GitHub 发布列表；选择版本后可触发整站部署。');
});

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
  const shouldPoll = mounted && (Boolean(active.value) && !latestRunFinished.value || Date.now() < retryUntil);
  if (shouldPoll && !timer) {
    timer = setInterval(() => { void load(true); }, 15_000);
  } else if (!shouldPoll && timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function load(silent = false) {
  if (!mounted) return;
  if (!silent) {
    loading.value = true;
    error.value = '';
    message.value = null;
  }
  const before = phase.value;
  try {
    const next = await adminApi<UpdateStatus>('/api/admin/site-update');
    if (!mounted) return;
    if (!initialRunId) initialRunId = next.runs[0]?.id ?? 0;
    data.value = next;
    error.value = '';
    message.value = null;
    disconnected.value = false;
    if (!selected.value || selected.value === lastTargetTag || !next.tags.some(tag => tag.name === selected.value)) {
      selected.value = next.latestTag || next.tags[0]?.name || '';
    }
    const finished = next.runs.find(run => run.status === 'completed' && run.id > initialRunId);
    if (finished && finished.id !== lastCompletedRunId) {
      lastCompletedRunId = finished.id;
      const shouldReload = busyPhases.includes(before) && finished.conclusion === 'success' &&
        Boolean(lastTargetTag) && finished.id > initialRunId;
      if (shouldReload) scheduleReload();
    }
  } catch (failure) {
    if (!mounted) return;
    const text = errorMessage(failure, '整站更新状态读取失败。');
    if (!silent) {
      error.value = text;
    } else if (data.value?.error) {
      retryUntil = 0;
      message.value = { tone: 'error', text: data.value.error };
    } else if (busyPhases.includes(before)) {
      disconnected.value = true;
      message.value = { tone: 'error', text: t('站点可能正在重启；稍后会自动重试。{reason}', { reason: text }) };
    } else if (silent) {
      message.value = { tone: 'error', text: text };
    }
  } finally {
    if (mounted) {
      loading.value = false;
      syncPolling();
    }
  }
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => { window.location.reload(); }, 500);
}

watch(latestRun, run => {
  if (run?.status === 'completed') syncPolling();
});

async function start() {
  const tag = selected.value;
  if (!tag || busy.value) return;
  if (!window.confirm(t('将把整站更新到 {tag}。部署会备份数据、替换容器并重启站点，期间可能短暂无法访问。确认继续？', { tag }))) return;
  busy.value = true;
  disconnected.value = false;
  message.value = { tone: 'ok', text: t('已提交整站部署请求，正在等待 GitHub Actions 响应。') };
  lastTargetTag = tag;
  retryUntil = Date.now() + 90_000;
  syncPolling();
  try {
    await adminApi('/api/admin/site-update', { method: 'POST', body: JSON.stringify({ tag }) });
    message.value = { tone: 'ok', text: t('已触发整站部署。页面会自动跟踪状态，完成后站点会自动切换版本。') };
    await load(true);
  } catch (failure) {
    message.value = { tone: 'error', text: errorMessage(failure, '触发整站更新失败。') };
    retryUntil = 0;
  } finally {
    busy.value = false;
    syncPolling();
  }
}

onMounted(load);
onBeforeUnmount(() => {
  mounted = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
});
</script>
