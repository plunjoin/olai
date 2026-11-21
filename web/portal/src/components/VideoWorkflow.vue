<template>
  <div class="workflow-container" :class="{ 'workflow-editor-page': current }">
    <div class="workflow-header">
      <template v-if="current">
        <button type="button" class="workflow-back" :disabled="loading" @click="backToList"><ChevronLeft :size="20" />{{ t('返回列表') }}</button>
        <h2>{{ current.title }}</h2>
        <div class="wf-project-meta">
          <p class="workflow-stage">{{ STAGE_LABELS[current.stage] }}</p>
          <span role="status">{{ saveState === 'saving' ? t('保存中…') : saveState === 'failed' ? t('保存失败') : t('已自动保存') }}</span>
          <button v-if="saveState === 'failed'" type="button" class="wf-small-button" @click="retrySave">{{ t('重试保存') }}</button>
        </div>
      </template>
      <template v-else>
        <h2>{{ t('短片工坊') }}</h2>
        <p class="workflow-subtitle">{{ t('把人物、场景和灵感，拖进你的故事') }}</p>
        <button type="button" class="workflow-back" @click="emit('exit')"><ChevronLeft :size="20" />{{ t('返回工作台') }}</button>
      </template>
    </div>

    <div v-if="!current" class="workflow-projects">
      <form class="wf-create-project" @submit.prevent="createProject">
        <div class="wf-create-icon"><Film :size="28" /></div>
        <h3>{{ t('开始一个新故事') }}</h3>
        <p>{{ t('写下一句话创意，交给 AI 构思，或自己动手搭建分镜。') }}</p>
        <label for="workflow-idea">{{ t('故事创意') }}</label>
        <textarea id="workflow-idea" v-model="newIdea" rows="3" required :placeholder="t('例如：一个穿黄色雨衣的女孩，在雨后的老街找到一封来自未来的信…')" />
        <div class="wf-create-footer">
          <label>{{ t('目标时长') }}<Select :model-value="String(newDuration)" :aria-label="t('目标时长')" :options="[15, 30, 60, 90].map(seconds => ({ value: String(seconds), label: t('{seconds} 秒', { seconds }) }))" @update:model-value="newDuration = Number($event)" /></label>
          <button type="submit" class="workflow-action-primary" :disabled="!newIdea.trim()"><Plus :size="17" />{{ t('创建短片') }}</button>
        </div>
      </form>

      <div v-if="projects.length" class="workflow-project-list">
        <h3>{{ t('我的短片') }}</h3>
        <div v-for="project in projects" :key="project.id" class="workflow-project-card">
          <div class="workflow-project-info">
            <h4>{{ project.title }}</h4>
            <p>{{ STAGE_LABELS[project.stage] }}</p>
            <span class="workflow-project-time">{{ new Date(project.updatedAt).toLocaleString(intlLocale()) }}</span>
          </div>
          <div class="workflow-project-actions">
            <button type="button" @click="openProject(project)">{{ t('继续') }}</button>
            <button type="button" :aria-label="t('删除项目：{title}', { title: project.title })" @click="deleteProject(project)"><Trash2 :size="16" /></button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="workflow-loading">
      <div class="workflow-loading-spinner" />
      <p>{{ loadingMessage }}</p>
      <button type="button" class="workflow-cancel" @click="cancel">{{ t('取消') }}</button>
    </div>

    <div v-else class="workflow-content">
      <WorkflowBoard :key="current.id" :project="current" @change="saveBoard" />

      <div v-if="current.stage === 'init'" class="workflow-stage-init">
        <h3>{{ t('创意') }}</h3>
        <p>{{ current.idea }}</p>
        <p>{{ t('目标时长：{seconds} 秒', { seconds: current.targetLength ?? '' }) }}</p>
        <button type="button" class="workflow-action-primary" @click="generateScript">{{ t('开始创作 - 生成脚本') }}</button>
      </div>

      <div v-else-if="current.stage === 'script' && current.script && current.styleBible" class="workflow-stage-script">
        <h3>{{ t('脚本') }}</h3>
        <div class="workflow-script-content"><p>{{ current.script }}</p></div>
        <h3>{{ t('风格圣经') }}</h3>
        <div class="workflow-style-bible">
          <div><strong>{{ t('角色外观：') }}</strong>{{ current.styleBible.appearance }}</div>
          <div><strong>{{ t('服装：') }}</strong>{{ current.styleBible.wardrobe }}</div>
          <div><strong>{{ t('美术风格：') }}</strong>{{ current.styleBible.artStyle }}</div>
          <div><strong>{{ t('色调：') }}</strong>{{ current.styleBible.palette }}</div>
        </div>
        <button type="button" class="workflow-action-primary" @click="generateShotList">{{ t('下一步 - 生成分镜') }}</button>
      </div>

      <div v-else-if="current.stage === 'shotlist' && current.shots" class="workflow-stage-shotlist">
        <h3>{{ t('准备生成画面') }}</h3>
        <p>
          {{ t('共 {count} 个镜头，总时长 {duration} 秒', { count: current.shots.length, duration: calculateTotalDuration(current.shots) }) }}
          <span v-if="videoMode === 'task'" class="workflow-note-inline">{{ t('（连续镜头每段固定 {seconds} 秒）', { seconds: OMNI_SEGMENT_DURATION }) }}</span>
        </p>
        <label v-if="videoMode === 'task'" class="workflow-checkbox">
          <input type="checkbox" :checked="current.useContinuousShot || false" @change="toggleContinuous" />
          <span>{{ t('连续长镜头模式（最多 {seconds} 秒，使用 extend_from 保持连续性）', { seconds: 30 }) }}</span>
        </label>
        <div class="workflow-actions">
          <button type="button" class="workflow-action-primary" :disabled="!canGenerateKeyframes" @click="generateKeyframes()">{{ t('下一步 - 生成关键帧（{count} 个）', { count: pending.keyframes }) }}</button>
        </div>
        <p v-if="!canGenerateKeyframes" class="wf-hint">{{ t('添加镜头并填写每个镜头的画面描述后，即可生成关键帧。') }}</p>
      </div>

      <div v-else-if="current.stage === 'keyframes' && current.shots" class="workflow-stage-keyframes">
        <h3>{{ t('关键帧') }}</h3>
        <div class="workflow-keyframes">
          <div v-for="(shot, index) in current.shots" :key="shot.id" class="workflow-keyframe-card">
            <h4>{{ t('镜头 {number} ({duration}秒)', { number: shot.number, duration: shot.duration }) }}</h4>
            <img v-if="shot.keyframeUrl && shot.keyframeStatus === 'completed'" :src="shot.keyframeUrl" :alt="t('镜头 {number} 关键帧', { number: index + 1 })" />
            <p v-if="shot.keyframeStatus === 'pending'">{{ t('生成中...') }}</p>
            <div v-if="shot.keyframeStatus === 'failed'" class="workflow-error">
              <AlertCircle :size="16" />
              <div><p>{{ shot.keyframeError }}</p><button type="button" @click="generateKeyframes(shot.id)">{{ t('重新生成') }}</button></div>
            </div>
            <p class="workflow-shot-desc">{{ shot.sceneDescription }}</p>
          </div>
        </div>
        <div class="workflow-actions">
          <button type="button" @click="generateKeyframes()">{{ t('重新生成失败的关键帧') }}</button>
          <button type="button" class="workflow-action-primary" @click="generateVideos()">
            {{ t('下一步 - 生成视频') }}
            <span v-if="current.useContinuousShot && continuousGenerations > 0"> {{ t('({count} 次生成)', { count: continuousGenerations }) }}</span>
            <span v-else-if="!current.useContinuousShot && pending.videos > 0"> {{ t('({count} 个)', { count: pending.videos }) }}</span>
          </button>
        </div>
        <p v-if="videoMode === 'task' && account.generationLimit <= 5" class="workflow-warning">
          {{ t('⚠️ Omni 每日额度有限（约 3-5 次），请谨慎使用。当前剩余额度：{remaining}', { remaining: account.generationLimit }) }}
        </p>
      </div>

      <div v-else-if="current.stage === 'videos' && current.shots" class="workflow-stage-videos">
        <h3>{{ t('镜头视频') }}</h3>
        <div class="workflow-videos">
          <div v-for="shot in current.shots" :key="shot.id" class="workflow-video-card">
            <h4>{{ t('镜头 {number} ({duration}秒)', { number: shot.number, duration: shot.duration }) }}</h4>
            <button v-if="shot.videoUrl && shot.videoStatus === 'completed'" type="button" class="workflow-play-media" @click="playShot(shot)"><Play :size="16" />{{ t('播放镜头视频') }}</button>
            <p v-if="shot.videoStatus === 'pending'">{{ t('生成中...') }}</p>
            <div v-if="shot.videoStatus === 'failed'" class="workflow-error">
              <AlertCircle :size="16" />
              <div><p>{{ shot.videoError }}</p><button type="button" @click="generateVideos(shot.id)">{{ t('重新生成') }}</button></div>
            </div>
          </div>
        </div>
        <div class="workflow-actions">
          <button type="button" @click="generateVideos()">{{ t('重新生成失败的视频') }}</button>
          <button type="button" class="workflow-action-primary" @click="generateMusicTrack">{{ t('添加配乐（可选）') }}</button>
          <button type="button" @click="assembleFinal(false)">{{ t('跳过配乐，开始合成') }}</button>
        </div>
      </div>

      <div v-else-if="current.stage === 'music' || current.stage === 'assembly'" class="workflow-stage-assembly">
        <h3>{{ t('合成成片') }}</h3>
        <div v-if="current.musicUrl" class="workflow-music">
          <h4>{{ t('背景音乐') }}</h4>
          <button type="button" class="workflow-play-media" @click="playMusic"><Play :size="16" />{{ t('播放背景音乐') }}</button>
        </div>
        <div v-if="current.musicStatus === 'failed'" class="workflow-error"><AlertCircle :size="16" /><p>{{ current.musicError }}</p></div>
        <p>{{ t('准备合成 {count} 个镜头{music}', { count: completedVideoShots.length, music: current.musicUrl ? t('和背景音乐') : '' }) }}</p>
        <p class="wf-hint">{{ t('合成会在浏览器本机完成，过程需要保持页面打开。') }}</p>
        <div class="workflow-actions">
          <button type="button" class="workflow-action-primary" @click="assembleFinal(false)">{{ t('合成视频（无字幕）') }}</button>
          <button type="button" class="workflow-action-primary" @click="assembleFinal(true)">{{ t('合成视频（含字幕）') }}</button>
          <button type="button" @click="exportSRT">{{ t('导出 SRT 字幕') }}</button>
        </div>
      </div>

      <div v-else-if="current.stage === 'complete'" class="workflow-stage-complete">
        <h3>{{ t('🎉 工作流完成') }}</h3>
        <div v-if="current.finalVideoUrl && current.finalVideoStatus === 'completed'" class="workflow-final-video">
          <h4>{{ t('成片') }}</h4>
          <button type="button" class="workflow-play-media" @click="playFinal"><Play :size="16" />{{ t('播放成片') }}</button>
          <button type="button" class="workflow-download" @click="downloadFinal"><Download :size="16" />{{ t('下载成片') }}</button>
        </div>
        <div v-if="current.finalVideoStatus === 'failed'" class="workflow-error"><AlertCircle :size="16" /><p>{{ current.finalVideoError }}</p></div>
        <div class="workflow-final-shots">
          <h4>{{ t('所有镜头') }}</h4>
          <div v-for="(shot, index) in current.shots || []" :key="shot.id" class="workflow-final-shot">
            <span>{{ t('镜头 {number}', { number: index + 1 }) }}</span>
            <button v-if="shot.videoUrl" type="button" class="workflow-play-media" @click="playShot(shot)"><Play :size="15" />{{ t('播放') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertCircle, ChevronLeft, Download, Film, Play, Plus, Trash2 } from 'lucide-vue-next';
import WorkflowBoard from './WorkflowBoard.vue';
import Select from './ui/Select.vue';
import { base64Blob, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, request, safeMediaURL, videoContent } from '../lib/api';
import { getAll, put, remove } from '../lib/storage';
import { calculateTotalDuration, countPendingGenerations, createWorkflowProject, parseRetryAfter, planContinuousShots, validateShotList, type Shot, type VideoWorkflowProject, type WorkflowStage } from '../lib/videoWorkflow';
import { OMNI_MAX_EXTEND_DURATION, OMNI_SEGMENT_DURATION } from '../lib/video';
import { assembleWorkflowVideo, exportWorkflowSRT } from '../lib/workflowAssemble';
import { intlLocale, t } from '../lib/i18n';
import { account, status } from '../composables/studio';
import { notify, downloadBlob } from '../composables/ui';
import { confirmAction } from '../composables/dialog';
import { play } from '../composables/player';

const emit = defineEmits<{ exit: [] }>();
const STAGE_LABELS: Record<WorkflowStage, string> = {
  init: t('创意输入'), script: t('编剧'), shotlist: t('分镜'), keyframes: t('关键帧'),
  videos: t('视频生成'), music: t('配乐'), assembly: t('合成'), complete: t('完成'),
};
const projects = ref<VideoWorkflowProject[]>([]);
const current = ref<VideoWorkflowProject | null>(null);
const loading = ref(false);
const loadingMessage = ref('');
const newIdea = ref('');
const newDuration = ref(30);
const saveState = ref<'saved' | 'saving' | 'failed'>('saved');
const videoMode = computed(() => status.value.videoMode === 'task' ? 'task' : 'chat');
const pending = computed(() => countPendingGenerations(current.value?.shots || []));
const continuousGenerations = computed(() => {
  const project = current.value;
  if (!project?.shots || !project.useContinuousShot || videoMode.value !== 'task') return 0;
  const shotsToGenerate = project.shots.filter(shot => !shot.videoStatus || shot.videoStatus === 'failed');
  if (!shotsToGenerate.length) return 0;
  return planContinuousShots(shotsToGenerate, OMNI_MAX_EXTEND_DURATION).totalGenerations;
});
const completedVideoShots = computed(() => (current.value?.shots || []).filter(shot => shot.videoBlob && shot.videoStatus === 'completed'));
const canGenerateKeyframes = computed(() => Boolean(current.value?.shots?.length) && !current.value!.shots!.some(shot => !shot.sceneDescription.trim()));
let abortController: AbortController | null = null;
let saveVersion = 0;
const mediaUrls: string[] = [];

function restoreURL(blob: Blob | undefined, fallback: string | undefined) {
  if (!blob) return fallback;
  const url = URL.createObjectURL(blob);
  mediaUrls.push(url);
  return url;
}
function releaseMedia() {
  mediaUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
}
function hydrateProject(project: VideoWorkflowProject): VideoWorkflowProject {
  return {
    ...project,
    shots: project.shots?.map(shot => ({
      ...shot,
      keyframeUrl: restoreURL(shot.keyframeBlob, shot.keyframeUrl),
      videoUrl: restoreURL(shot.videoBlob, shot.videoUrl),
      keyframeStatus: shot.keyframeStatus === 'pending' ? 'failed' : shot.keyframeStatus,
      keyframeError: shot.keyframeStatus === 'pending' ? t('上次生成被中断，请重新生成。') : shot.keyframeError,
      videoStatus: shot.videoStatus === 'pending' ? 'failed' : shot.videoStatus,
      videoError: shot.videoStatus === 'pending' ? t('上次生成被中断，请重新生成。') : shot.videoError,
    })),
    musicUrl: restoreURL(project.musicBlob, project.musicUrl),
    finalVideoUrl: restoreURL(project.finalVideoBlob, project.finalVideoUrl),
  };
}

async function saveProject(project: VideoWorkflowProject): Promise<VideoWorkflowProject> {
  const updated = { ...project, updatedAt: Date.now() };
  const version = ++saveVersion;
  saveState.value = 'saving';
  current.value = updated;
  projects.value = projects.value.some(item => item.id === updated.id)
    ? projects.value.map(item => item.id === updated.id ? updated : item)
    : [...projects.value, updated];
  try {
    await put('workflows', updated);
    if (version === saveVersion) saveState.value = 'saved';
    return updated;
  } catch (error) {
    if (version === saveVersion) saveState.value = 'failed';
    notify(t('项目保存失败，请点击重试保存。'));
    throw error;
  }
}
function saveBoard(project: VideoWorkflowProject) {
  if (!current.value) return;
  void saveProject(project).catch(() => {});
}
function retrySave() {
  if (current.value) void saveProject(current.value).catch(() => {});
}
function createProject() {
  const idea = newIdea.value.trim();
  if (!idea) return;
  const project = createWorkflowProject(idea, newDuration.value);
  newIdea.value = '';
  void saveProject(project).catch(() => {});
}
async function openProject(project: VideoWorkflowProject) {
  current.value = project;
  saveState.value = 'saved';
}
function backToList() {
  if (loading.value) return;
  current.value = null;
}
async function deleteProject(project: VideoWorkflowProject) {
  if (!await confirmAction(t('删除短片项目'), t('项目“{title}”和其中的镜头素材会一起删除。', { title: project.title }), t('删除'), true)) return;
  try {
    await remove('workflows', project.id);
    projects.value = projects.value.filter(item => item.id !== project.id);
    if (current.value?.id === project.id) current.value = null;
  } catch { notify(t('删除项目失败，请重试。')); }
}

function outputBlob(output: { url?: string; base64?: string; mime: string }): Promise<{ blob: Blob; url: string }> {
  return (async () => {
    let blob: Blob;
    let url: string;
    if (output.base64) {
      blob = base64Blob(output.base64, output.mime);
      url = URL.createObjectURL(blob);
    } else if (output.url) {
      url = safeMediaURL(output.url);
      blob = await (await fetch(url)).blob();
    } else {
      throw new Error(t('媒体数据格式无效'));
    }
    mediaUrls.push(url);
    return { blob, url };
  })();
}
function beginLoading(message: string) {
  loading.value = true;
  loadingMessage.value = message;
  abortController = new AbortController();
}
function endLoading() {
  loading.value = false;
  loadingMessage.value = '';
  abortController = null;
}
function cancel() {
  abortController?.abort();
  abortController = null;
  loading.value = false;
  loadingMessage.value = '';
}

async function generateScript() {
  if (!current.value) return;
  const project = current.value;
  beginLoading(t('编剧正在创作脚本和风格圣经...'));
  try {
    const response = await request('chat/completions', {
      method: 'POST', signal: abortController!.signal,
      body: JSON.stringify({ action: 'workflow-script', idea: project.idea, targetLength: project.targetLength || 30, elements: project.elements || [] }),
    });
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(t('未收到编剧输出'));
    let data: any;
    try {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (!match) throw new Error();
      data = JSON.parse(match[0]);
    } catch { throw new Error(t('编剧输出的 JSON 格式无效')); }
    if (!data.script || !data.styleBible) throw new Error(t('脚本或风格圣经缺失'));
    await saveProject({ ...project, stage: 'script', script: data.script, title: data.title || project.title, styleBible: data.styleBible });
  } catch (error: any) {
    if (error.name !== 'AbortError') notify(publicServiceError(error.message));
  } finally { endLoading(); }
}

async function generateShotList() {
  const project = current.value;
  if (!project?.script || !project.styleBible) return;
  beginLoading(t('导演正在规划分镜...'));
  try {
    const response = await request('chat/completions', {
      method: 'POST', signal: abortController!.signal,
      body: JSON.stringify({ action: 'workflow-shots', script: project.script, styleBible: project.styleBible, targetLength: project.targetLength || 30, elements: project.elements || [] }),
    });
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(t('未收到导演输出'));
    let data: any;
    try {
      const match = String(content).match(/\[[\s\S]*\]/);
      if (!match) throw new Error();
      data = JSON.parse(match[0]);
    } catch { throw new Error(t('导演输出的 JSON 格式无效')); }
    const shots = validateShotList(data, project.elements || []);
    await saveProject({ ...project, stage: 'shotlist', shots });
  } catch (error: any) {
    if (error.name !== 'AbortError') notify(publicServiceError(error.message));
  } finally { endLoading(); }
}

async function generateKeyframes(regenerateShotId?: string) {
  const project = current.value;
  if (!project?.shots || !project.styleBible) return;
  const targets = regenerateShotId
    ? project.shots.filter(shot => shot.id === regenerateShotId)
    : project.shots.filter(shot => !shot.keyframeStatus || shot.keyframeStatus === 'failed');
  if (!targets.length) { await saveProject({ ...project, stage: 'keyframes' }); return; }
  beginLoading(t('正在准备关键帧...'));
  const updatedShots = project.shots.map(shot => ({ ...shot }));
  try {
    for (const target of targets) {
      if (abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = updatedShots.findIndex(shot => shot.id === target.id);
      if (index < 0) continue;
      loadingMessage.value = t('生成关键帧 {index}/{total}...', { index: updatedShots[index].number, total: updatedShots.length });
      updatedShots[index] = { ...updatedShots[index], keyframeStatus: 'pending', keyframeError: undefined };
      await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
      try {
        const response = await generateImage({
          prompt: '', context: { action: 'workflow-keyframe', shot: updatedShots[index], styleBible: project.styleBible, elements: project.elements || [] },
          imageSize: '1K', aspectRatio: '16:9', signal: abortController!.signal,
        });
        const json = await response.json();
        const outputs = mediaOutputs(json, 'image');
        if (!outputs.length) throw new Error(t('未生成关键帧图片'));
        const { blob, url } = await outputBlob(outputs[0]);
        updatedShots[index] = { ...updatedShots[index], keyframeBlob: blob, keyframeUrl: url, keyframeStatus: 'completed', keyframeError: undefined };
      } catch (error: any) {
        if (error.name === 'AbortError') throw error;
        updatedShots[index] = { ...updatedShots[index], keyframeStatus: 'failed', keyframeError: publicServiceError(error.message) };
      }
      await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
    }
    if (!regenerateShotId && updatedShots.every(shot => shot.keyframeStatus === 'completed')) {
      await saveProject({ ...project, stage: 'keyframes', shots: updatedShots });
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') notify(publicServiceError(error.message));
  } finally { endLoading(); }
}

async function pollVideo(id: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await request(`videos/${encodeURIComponent(id)}`, { signal: abortController?.signal });
    const task = await response.json();
    if (task.status === 'completed') return videoContent(id, abortController?.signal);
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(task.error?.message || t('视频生成失败'));
  }
  throw new Error(t('视频生成超时'));
}

async function generateOneVideo(shot: Shot, project: VideoWorkflowProject, extendFrom?: string): Promise<{ shot: Shot; remoteId?: string }> {
  const hasKeyframe = videoMode.value === 'task' && Boolean(shot.keyframeBlob) && !extendFrom;
  const response = await generateVideo({
    prompt: '', context: { action: 'workflow-video', shot, styleBible: project.styleBible, hasKeyframe, elements: project.elements || [] },
    options: extendFrom ? { aspect_ratio: '16:9', resolution: '720p' } : { aspect_ratio: '16:9', seconds: Math.min(Math.max(shot.duration, 1), 8), resolution: '720p' },
    signal: abortController?.signal,
    inputImage: hasKeyframe ? shot.keyframeBlob : undefined,
    extendFrom,
  });
  if (videoMode.value === 'task' || extendFrom) {
    const json = await response.json();
    if (!json.id) throw new Error(t('未返回视频任务 ID'));
    const blob = await pollVideo(json.id);
    const url = URL.createObjectURL(blob);
    mediaUrls.push(url);
    return { shot: { ...shot, videoBlob: blob, videoUrl: url, videoStatus: 'completed', videoError: undefined, videoRemoteId: json.id }, remoteId: json.id };
  }
  const json = await response.json();
  const outputs = mediaOutputs(json, 'video');
  if (!outputs.length) throw new Error(t('未生成视频'));
  const { blob, url } = await outputBlob(outputs[0]);
  return { shot: { ...shot, videoBlob: blob, videoUrl: url, videoStatus: 'completed', videoError: undefined } };
}

async function generateVideos(regenerateShotId?: string) {
  const project = current.value;
  if (!project?.shots || !project.styleBible) return;
  const targets = regenerateShotId
    ? project.shots.filter(shot => shot.id === regenerateShotId)
    : project.shots.filter(shot => !shot.videoStatus || shot.videoStatus === 'failed');
  if (!targets.length) { await saveProject({ ...project, stage: 'videos' }); return; }
  beginLoading(t('正在准备镜头视频...'));
  const updatedShots = project.shots.map(shot => ({ ...shot }));
  try {
    if (project.useContinuousShot && videoMode.value === 'task' && !regenerateShotId) {
      const { segments } = planContinuousShots(targets, OMNI_MAX_EXTEND_DURATION);
      for (const segment of segments) {
        let extendFrom: string | undefined;
        for (const target of segment) {
          if (abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const index = updatedShots.findIndex(shot => shot.id === target.id);
          if (index < 0) continue;
          loadingMessage.value = t('连续长镜头：生成镜头 {index}/{total}...', { index: updatedShots[index].number, total: updatedShots.length });
          updatedShots[index] = { ...updatedShots[index], videoStatus: 'pending', videoError: undefined };
          await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
          try {
            const result = await generateOneVideo(updatedShots[index], project, extendFrom);
            updatedShots[index] = result.shot;
            extendFrom = result.remoteId;
          } catch (error: any) {
            if (error.name === 'AbortError') throw error;
            updatedShots[index] = { ...updatedShots[index], videoStatus: 'failed', videoError: retryMessage(error) };
          }
          await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
        }
      }
    } else {
      for (const target of targets) {
        if (abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const index = updatedShots.findIndex(shot => shot.id === target.id);
        if (index < 0) continue;
        loadingMessage.value = t('生成视频 {index}/{total}...', { index: updatedShots[index].number, total: updatedShots.length });
        updatedShots[index] = { ...updatedShots[index], videoStatus: 'pending', videoError: undefined };
        await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
        try {
          updatedShots[index] = (await generateOneVideo(updatedShots[index], project)).shot;
        } catch (error: any) {
          if (error.name === 'AbortError') throw error;
          updatedShots[index] = { ...updatedShots[index], videoStatus: 'failed', videoError: retryMessage(error) };
        }
        await saveProject({ ...project, shots: updatedShots.map(shot => ({ ...shot })) });
      }
    }
    if (!regenerateShotId && updatedShots.every(shot => shot.videoStatus === 'completed')) {
      await saveProject({ ...project, stage: 'videos', shots: updatedShots });
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') notify(publicServiceError(error.message));
  } finally { endLoading(); }
}
function retryMessage(error: any) {
  if (error?.status === 429) {
    const seconds = parseRetryAfter(error.headers?.get?.('Retry-After'));
    return t('视频生成额度已用完。{message}', { message: seconds ? t('请等待 {seconds} 秒后重试', { seconds }) : t('已达到每日额度上限，请明天再试') });
  }
  return publicServiceError(error?.message || '视频生成失败');
}

async function generateMusicTrack() {
  const project = current.value;
  if (!project?.script || !project.styleBible || !project.shots) return;
  beginLoading(t('作曲中...'));
  try {
    const totalDuration = calculateTotalDuration(project.shots);
    const response = await generateAudio({
      prompt: '', duration: totalDuration,
      context: { action: 'workflow-music', script: project.script, styleBible: project.styleBible, duration: totalDuration },
      signal: abortController!.signal,
    });
    const json = await response.json();
    const outputs = mediaOutputs(json, 'music');
    if (!outputs.length) throw new Error(t('未生成音乐'));
    const { blob, url } = await outputBlob(outputs[0]);
    await saveProject({ ...project, stage: 'music', musicBlob: blob, musicUrl: url, musicStatus: 'completed', musicError: undefined });
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      const message = publicServiceError(error.message);
      await saveProject({ ...project, musicStatus: 'failed', musicError: message }).catch(() => {});
      notify(message);
    }
  } finally { endLoading(); }
}

async function assembleFinal(includeSubtitles: boolean) {
  const project = current.value;
  if (!project?.shots) return;
  if (!completedVideoShots.value.length) { notify(t('没有可用的视频镜头')); return; }
  beginLoading(t('准备合成...'));
  try {
    const blob = await assembleWorkflowVideo({
      shots: project.shots, musicBlob: project.musicBlob, includeSubtitles,
      onProgress: message => { loadingMessage.value = message; },
      signal: abortController!.signal,
    });
    const url = URL.createObjectURL(blob);
    mediaUrls.push(url);
    await saveProject({ ...project, stage: 'complete', finalVideoBlob: blob, finalVideoUrl: url, finalVideoStatus: 'completed', finalVideoError: undefined });
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      await saveProject({ ...project, finalVideoStatus: 'failed', finalVideoError: publicServiceError(error.message) }).catch(() => {});
      notify(publicServiceError(error.message));
    }
  } finally { endLoading(); }
}

function toggleContinuous(event: Event) {
  if (!current.value) return;
  saveBoard({ ...current.value, useContinuousShot: (event.target as HTMLInputElement).checked });
}
function playShot(shot: Shot) {
  if (!shot.videoUrl || !current.value) return;
  play({ id: `wf-${current.value.id}-${shot.id}`, kind: 'video', src: shot.videoUrl, title: t('镜头 {number} · {title}', { number: shot.number, title: current.value.title }) });
}
function playMusic() {
  if (!current.value?.musicUrl) return;
  play({ id: `wf-music-${current.value.id}`, kind: 'audio', src: current.value.musicUrl, title: t('背景音乐 · {title}', { title: current.value.title }) });
}
function playFinal() {
  if (!current.value?.finalVideoUrl) return;
  play({ id: `wf-final-${current.value.id}`, kind: 'video', src: current.value.finalVideoUrl, title: t('成片 · {title}', { title: current.value.title }) });
}
function downloadFinal() {
  if (!current.value?.finalVideoBlob) return;
  const extension = current.value.finalVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
  downloadBlob(current.value.finalVideoBlob, `${current.value.title}.${extension}`);
}
function exportSRT() {
  if (current.value?.shots) exportWorkflowSRT(current.value.shots, current.value.title);
}

onMounted(async () => {
  try {
    const records = await getAll<VideoWorkflowProject>('workflows');
    projects.value = (records || []).filter(Boolean).map(hydrateProject);
  } catch { notify(t('短片项目读取失败，请刷新页面重试。')); }
});
onBeforeUnmount(() => {
  abortController?.abort();
  releaseMedia();
});
</script>
