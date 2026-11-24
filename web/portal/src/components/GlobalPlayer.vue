<template>
  <!-- Global audio element: lives as long as the app does. -->
  <audio
    ref="audioRef"
    :src="audioSrc"
    preload="auto"
    @play="onAudioPlay"
    @pause="onAudioPause"
    @ended="onAudioEnded"
    @timeupdate="onAudioTime"
    @loadedmetadata="onAudioLoaded"
  />

  <!-- Global video player: small floating window / theater, and the one
       element hover previews and the gallery detail dock into. -->
  <aside
    class="floating-video-player"
    :class="{
      'has-media': hasVideo,
      'is-theater': isVideoExpanded,
      'is-inline': isDockedInline,
      'is-idle': !hasVideo,
      'is-closing': videoClosing,
    }"
    :aria-label="t('视频播放器')"
    :aria-hidden="!hasVideo || isDockedInline"
    @mouseenter="videoHovered = true"
    @mouseleave="videoHovered = false"
  >
    <button v-if="isVideoExpanded" type="button" class="video-theater-backdrop" :aria-label="t('收起视频播放器')" @click="collapseVideoTheater" />
    <div ref="videoFrameRef" class="video-player-frame">
      <div v-if="hasVideo" class="floating-video-header" :class="{ visible: videoHovered || !isPlaying || isVideoExpanded }">
        <div class="floating-video-title">
          <span class="floating-video-badge"><Video :size="11" /> {{ isVideoExpanded ? t('大屏观看') : t('视频播放') }}</span>
          <span class="title-text" :title="activeMedia?.title">{{ activeMedia?.title }}</span>
        </div>
        <div class="floating-video-header-actions">
          <button type="button" class="header-action-btn" :title="t('画中画模式')" :aria-label="t('画中画')" @click="togglePip"><PictureInPicture :size="14" /></button>
          <button v-if="isVideoExpanded" type="button" class="header-action-btn video-theater-toggle" :title="t('收起为小窗')" :aria-label="t('收起为小窗')" @click="collapseVideoTheater"><Minimize2 :size="14" /></button>
          <button v-else type="button" class="header-action-btn" :title="t('大屏观看')" :aria-label="t('大屏观看')" @click="openVideoTheater"><Maximize2 :size="14" /></button>
          <button type="button" class="header-action-btn close-btn" :title="t('关闭播放器')" :aria-label="t('关闭')" @click="close"><X :size="15" /></button>
        </div>
      </div>

      <div class="floating-video-stage" @click="hasVideo && toggle()">
        <div ref="videoStageHost" class="video-element-host">
          <!-- 没有视频时服务端不会渲染 Teleport 的子节点，客户端 vdom 却会，
               造成 hydration children mismatch。把 video 本身也按同一个条件
               v-if 掉，SSR 与客户端首帧都为空；真正播放时再挂载。 -->
          <Teleport v-if="hasVideo || videoPreview" :to="videoHost" :disabled="!videoHost">
            <video
              ref="videoRef"
              :src="videoSrc"
              playsinline
              :preload="videoPreview ? 'metadata' : 'auto'"
              :loop="Boolean(videoPreview)"
              :muted="videoPreview ? videoPreviewMuted : isMuted"
              :class="videoPreview ? 'hover-preview-video' : 'global-video-element'"
              @play="onVideoPlay"
              @pause="onVideoPause"
              @timeupdate="onVideoTime"
              @loadedmetadata="onVideoLoaded"
              @ended="onVideoEnded"
            />
          </Teleport>
        </div>
        <div v-if="hasVideo && !isPlaying && !videoPreview" class="video-pause-overlay">
          <div class="video-play-pulse"><Play :size="26" class="play-icon-offset" /></div>
        </div>
      </div>

      <div v-if="hasVideo" class="floating-video-controls" :class="{ visible: videoHovered || !isPlaying || isVideoExpanded }">
        <div class="floating-video-progress">
          <input
            type="range"
            min="0"
            :max="duration || 100"
            step="0.1"
            :value="Math.min(currentTime, duration || 100)"
            class="video-progress-slider"
            :aria-label="t('播放进度')"
            :style="{ background: `linear-gradient(to right, var(--accent-lime, #7047eb) ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)` }"
            @input="seek(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="floating-video-buttons">
          <div class="video-buttons-left">
            <button type="button" class="v-btn play-btn" :aria-label="isPlaying ? t('暂停') : t('播放')" @click="toggle">
              <Pause v-if="isPlaying" :size="16" /><Play v-else :size="16" class="play-icon-offset" />
            </button>
            <span class="video-time-tag">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
          </div>
          <div class="video-buttons-right">
            <button type="button" class="v-btn" :title="isMuted ? t('取消静音') : t('静音')" :aria-label="isMuted ? t('取消静音') : t('静音')" @click="toggleMute">
              <VolumeX v-if="isMuted" :size="16" /><Volume2 v-else :size="16" />
            </button>
            <button v-if="isVideoExpanded" type="button" class="v-btn" :title="t('收起为小窗')" :aria-label="t('收起为小窗')" @click="collapseVideoTheater"><Minimize2 :size="16" /></button>
            <button v-else type="button" class="v-btn" :title="t('大屏观看')" :aria-label="t('大屏观看')" @click="openVideoTheater"><Maximize2 :size="16" /></button>
            <button type="button" class="v-btn" :title="t('全屏')" :aria-label="t('全屏')" @click="toggleFullscreen"><Maximize2 :size="16" /></button>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <!-- Compact floating audio disc; stretches into the full now-playing panel. -->
  <aside v-if="activeAudio && !expanded" class="floating-audio-disc-wrap" :aria-label="t('浮窗音乐播放器')">
    <button
      ref="discRef"
      type="button"
      class="floating-audio-disc"
      :aria-label="t('{action}：{title}', { action: isPlaying ? t('暂停') : t('播放'), title: activeAudio.title })"
      :title="t('{title} · {action}', { title: activeAudio.title, action: isPlaying ? t('暂停') : t('播放') })"
      @click="toggle"
    >
      <ProgressRing :progress="progressPercent" />
      <span class="audio-disc-cover" :class="{ 'is-spinning': isPlaying }">
        <img v-if="activeAudio.coverUrl" :src="activeAudio.coverUrl" alt="" />
        <Music2 v-else :size="24" />
      </span>
      <span class="audio-disc-toggle" aria-hidden="true">
        <Pause v-if="isPlaying" :size="17" /><Play v-else :size="17" class="play-icon-offset" />
      </span>
    </button>

    <div class="audio-disc-controls">
      <button type="button" :aria-label="isPlaying ? t('暂停') : t('播放')" :title="isPlaying ? t('暂停') : t('播放')" @click="toggle">
        <Pause v-if="isPlaying" :size="15" /><Play v-else :size="15" class="play-icon-offset" />
      </button>
      <button type="button" :aria-label="t('展开播放器')" :title="t('展开播放器')" @click="openAudioPlayer"><Maximize2 :size="15" /></button>
      <button type="button" :aria-label="isMuted ? t('取消静音') : t('静音')" :title="isMuted ? t('取消静音') : t('静音')" @click="toggleMute">
        <VolumeX v-if="isMuted" :size="15" /><Volume2 v-else :size="15" />
      </button>
      <button type="button" class="is-danger" :aria-label="t('关闭播放器')" :title="t('关闭播放器')" @click="close"><X :size="15" /></button>
    </div>
  </aside>

  <!-- Full-screen now-playing panel, expanding from the disc. -->
  <div
    v-if="activeAudio && expanded"
    class="audio-stage"
    :class="{ 'is-closing': audioClosing }"
    role="dialog"
    aria-modal="true"
    :aria-label="t('音乐播放器：{title}', { title: activeAudio.title })"
  >
    <button type="button" class="audio-stage-backdrop" :aria-label="t('收起音乐播放器')" @click="collapseAudioPlayer" />
    <section ref="audioPanelRef" class="audio-stage-panel" :class="{ 'is-lyric-editing': editingLyrics }">
      <div class="audio-stage-art" :class="{ 'is-wave-mode': editingLyrics }">
        <template v-if="!editingLyrics">
          <div class="audio-stage-cover-wrap">
            <div class="audio-stage-cover" :class="{ 'is-spinning': isPlaying }">
              <img v-if="activeAudio.coverUrl" :src="activeAudio.coverUrl" :alt="t('{title}封面', { title: activeAudio.title })" />
              <Music2 v-else :size="68" />
            </div>
            <ProgressRing :progress="progressPercent" class-name="audio-stage-ring" />
          </div>
          <div class="audio-stage-now">
            <span class="audio-stage-badge">AI AUDIO</span>
            <h2>{{ activeAudio.title }}</h2>
            <p>{{ activeAudio.song?.style || t('原创音乐') }}{{ !activeAudio.song?.instrumental && activeAudio.song ? ` · ${t('人声歌曲')}` : '' }}</p>
          </div>
          <div class="audio-stage-eq" :class="{ active: isPlaying }" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </div>
          <p v-if="parsedLyrics.length > 0 && activeIndex >= 0" class="audio-stage-live-lyric">{{ parsedLyrics[activeIndex]?.text }}</p>
        </template>
        <div v-else class="lyric-wave-panel">
          <div class="lyric-wave-head">
            <span class="lyric-wave-kicker">{{ t('波形校对') }}</span>
            <strong>{{ formatLrcClock(waveTime) }} / {{ formatLrcClock(duration) }}</strong>
          </div>
          <div
            ref="waveTrackEl"
            class="lyric-wave-track"
            role="slider"
            tabindex="0"
            :aria-label="t('音频波形')"
            :aria-valuemin="0"
            :aria-valuemax="duration || 0"
            :aria-valuenow="currentTime"
            @pointerdown="beginWaveScrub"
            @pointermove="onWaveScrub"
            @pointerup="endWaveScrub"
            @pointercancel="endWaveScrub"
          >
            <canvas ref="waveCanvasEl" class="lyric-wave-canvas" />
            <span
              v-for="(time, index) in draftTimes"
              :key="index"
              class="lyric-wave-mark"
              :class="{ 'is-selected': index === selectedLyricIndex }"
              :style="{ left: wavePercent(time) }"
            />
            <span class="lyric-wave-playhead" :style="{ left: wavePercent(waveTime) }" />
            <div v-if="waveLoading" class="lyric-wave-loading">
              <LoaderCircle :size="16" class="spin" />{{ t('正在解析波形…') }}
            </div>
            <p v-else-if="!wavePeaks.length" class="lyric-wave-empty">{{ t('波形暂不可用，仍可用打点校对') }}</p>
          </div>
          <p class="lyric-wave-hint">{{ t('点击或拖动波形定位播放位置；竖线是该句的起点') }}</p>
        </div>
      </div>

      <div class="audio-stage-side">
        <header class="audio-stage-head">
          <div class="audio-stage-heading">
            <span class="audio-stage-kicker">{{ t('正在播放') }}</span>
            <strong :title="activeAudio.title">{{ activeAudio.title }}</strong>
          </div>
          <div class="audio-stage-head-actions">
            <button type="button" :aria-label="isMuted ? t('取消静音') : t('静音')" :title="isMuted ? t('取消静音') : t('静音')" @click="toggleMute">
              <VolumeX v-if="isMuted" :size="17" /><Volume2 v-else :size="17" />
            </button>
            <button type="button" class="audio-stage-collapse is-danger" :aria-label="t('关闭弹窗')" :title="t('关闭弹窗')" @click="collapseAudioPlayer"><X :size="17" /></button>
          </div>
        </header>

        <div
          v-if="activeAudio && !activeAudio.song?.instrumental && (activeAudio.lyrics || parsedLyrics.length)"
          class="audio-stage-status"
          :class="{ 'is-editing': editingLyrics }"
        >
          <template v-if="editingLyrics">
            <span>{{ t('手动校对：播放音频，唱到某句时点「打点」或按 T。') }}</span>
            <div class="lyric-edit-actions">
              <button type="button" class="secondary-button small" :disabled="!lyricHistory.length" @click="undoLyricEdit">
                <Undo2 :size="13" />{{ t('撤销') }}
              </button>
              <button type="button" class="secondary-button small" :disabled="!lyricRedo.length" @click="redoLyricEdit">
                <Redo2 :size="13" />{{ t('重做') }}
              </button>
              <button type="button" class="secondary-button small" @click="cancelLyricEdit">{{ t('取消') }}</button>
              <button type="button" class="primary-button small" :disabled="!lyricsDirty || savingLyrics" @click="saveLyricEdits">
                <LoaderCircle v-if="savingLyrics" :size="13" class="spin" /><Save v-else :size="13" />
                {{ t('保存校对') }}
              </button>
            </div>
          </template>
          <template v-else>
            <span>{{ lyricsSourceLabel }}</span>
            <div class="lyric-edit-actions">
              <button v-if="canAlignLyrics" type="button" class="secondary-button small" :disabled="aligning" @click="alignLyrics">
                <LoaderCircle v-if="aligning" :size="13" class="spin" /><Sparkles v-else :size="13" />
                {{ aligning ? t('正在校准歌词…') : t('校准歌词') }}
              </button>
              <button v-if="canEditLyrics" type="button" class="secondary-button small" @click="beginLyricEdit">
                <Pencil :size="13" />{{ t('手动校对') }}
              </button>
            </div>
          </template>
        </div>

        <div class="audio-stage-lyrics">
          <div v-if="editingLyrics && draftTimes.length" class="lyric-editor">
            <div class="lyric-editor-head">
              <span>{{ t('第 {index} / {total} 句', { index: selectedLyricIndex + 1, total: draftTimes.length }) }}</span>
              <div class="lyric-editor-head-right">
                <button type="button" class="lyric-editor-edit" :title="t('编辑这一句文字')" @click="beginTextEdit(selectedLyricIndex)">
                  <Pencil :size="12" />{{ t('改词') }}
                </button>
                <button
                  type="button"
                  class="lyric-editor-edit"
                  :class="{ 'is-active': lockFollow }"
                  :aria-pressed="lockFollow"
                  :title="t('开启后，微调这一句会同时平移它后面的所有句子（快捷键 L）')"
                  @click="lockFollow = !lockFollow"
                >
                  <Link2 :size="12" />{{ t('联动后续') }}
                </button>
                <strong>{{ formatLrcClock(draftTimes[selectedLyricIndex] ?? 0) }}</strong>
              </div>
            </div>
            <div class="lyric-editor-row">
              <button type="button" class="lyric-editor-chip" :title="t('试听')" @click="auditionSelected">
                <Play :size="12" class="play-icon-offset" />{{ t('试听') }}
              </button>
              <button type="button" class="lyric-editor-chip" title="-1s" @click="nudgeSelected(-1)">-1s</button>
              <button type="button" class="lyric-editor-chip" title="-0.1s" @click="nudgeSelected(-0.1)">-0.1s</button>
              <button type="button" class="lyric-editor-chip" title="+0.1s" @click="nudgeSelected(0.1)">+0.1s</button>
              <button type="button" class="lyric-editor-chip" title="+1s" @click="nudgeSelected(1)">+1s</button>
              <button
                type="button"
                class="lyric-editor-chip is-primary"
                :title="t('把这一句的起始时间对齐到当前播放位置（快捷键 T）')"
                @click="stampSelected"
              >
                <Target :size="12" />{{ t('打点') }}<kbd>T</kbd>
              </button>
            </div>
            <div class="lyric-editor-row is-shift">
              <span>{{ t('整体偏移') }}</span>
              <button type="button" class="lyric-editor-chip" @click="nudgeAll(-0.5)">-0.5s</button>
              <button type="button" class="lyric-editor-chip" @click="nudgeAll(-0.1)">-0.1s</button>
              <button type="button" class="lyric-editor-chip" @click="nudgeAll(0.1)">+0.1s</button>
              <button type="button" class="lyric-editor-chip" @click="nudgeAll(0.5)">+0.5s</button>
            </div>
          </div>
          <div
            v-if="displayLyrics.length"
            ref="lyricListEl"
            class="audio-stage-lyric-list"
            :class="{ 'is-editing': editingLyrics }"
          >
            <div
              v-for="(item, index) in displayLyrics"
              v-show="item.text"
              :key="index"
              :ref="element => setActiveLyric(index, element)"
              class="lyric-line"
              :class="{ active: index === activeIndex, 'is-selected': editingLyrics && index === selectedLyricIndex }"
              role="button"
              tabindex="0"
              :title="editingLyrics ? t('点击选中这一句，双击编辑文字') : t('点击跳转到 {time}', { time: formatTime(item.time) })"
              @click="onLyricClick(item, index)"
              @dblclick.stop="editingLyrics && beginTextEdit(index)"
              @keydown.enter.prevent="editingLyrics ? selectLyric(index) : seek(item.time)"
              @keydown.space.prevent="editingLyrics ? selectLyric(index) : seek(item.time)"
            >
              <input
                v-if="editingLyrics && editingTimeIndex === index"
                :ref="setTimeInput"
                v-model="timeDraft"
                class="lyric-time-input"
                inputmode="decimal"
                placeholder="01:23.45"
                :aria-label="t('输入这一句的起始时间')"
                @click.stop
                @dblclick.stop
                @keydown.stop
                @keydown.enter="onTimeEnter"
                @keydown.esc.prevent="cancelTimeEdit"
                @compositionstart="timeComposing = true"
                @compositionend="timeComposing = false"
                @blur="commitTimeEdit"
              />
              <span
                v-else
                class="lyric-time"
                :class="{ 'is-editable': editingLyrics }"
                :title="editingLyrics ? t('点击输入精确时间') : undefined"
                @click.stop="editingLyrics && beginTimeEdit(index)"
                @dblclick.stop
              >{{ editingLyrics ? formatLrcClock(item.time) : formatTime(item.time) }}</span>
              <input
                v-if="editingLyrics && editingTextIndex === index"
                :ref="setTextInput"
                v-model="textDraft"
                class="lyric-text-input"
                :aria-label="t('编辑这一句歌词')"
                @click.stop
                @dblclick.stop
                @keydown.stop
                @keydown.enter="onTextEnter"
                @keydown.esc.prevent="cancelTextEdit"
                @compositionstart="textComposing = true"
                @compositionend="textComposing = false"
                @blur="commitTextEdit"
              />
              <span v-else class="lyric-text">{{ item.text }}</span>
            </div>
          </div>
          <div v-else class="lyrics-empty">
            <FileText :size="34" />
            <p>{{ activeAudio.song?.instrumental ? t('纯音乐，享受旋律。') : t('暂无对齐歌词数据') }}</p>
          </div>
        </div>

        <footer class="audio-stage-footer">
          <div class="audio-stage-progress">
            <span>{{ formatTime(currentTime) }}</span>
            <input
              type="range"
              min="0"
              :max="duration || 100"
              step="0.1"
              :value="Math.min(currentTime, duration || 100)"
              class="progress-slider"
              :aria-label="t('播放进度')"
              :style="{ background: `linear-gradient(to right, var(--accent-lime, #7047eb) ${progressPercent}%, rgba(120, 132, 170, 0.18) ${progressPercent}%)` }"
              @input="seek(Number(($event.target as HTMLInputElement).value))"
            />
            <span>{{ formatTime(duration) }}</span>
          </div>

          <div class="audio-stage-controls">
            <div class="audio-stage-controls-side">
              <button type="button" :title="t('播放倍速')" :aria-label="t('播放倍速 {rate} 倍', { rate: playbackRate })" @click="changeRate"><span class="speed-tag">{{ playbackRate }}x</span></button>
              <template v-if="localLrc">
                <button type="button" :title="copied ? t('已复制歌词') : t('复制 LRC 歌词')" :aria-label="t('复制 LRC 歌词')" @click="copyLrc">
                  <Check v-if="copied" :size="17" /><Copy v-else :size="17" />
                </button>
                <button type="button" :title="t('下载 LRC 歌词')" :aria-label="t('下载 LRC 歌词')" @click="downloadLrc"><Download :size="17" /></button>
              </template>
            </div>

            <div class="audio-stage-controls-center">
              <button type="button" class="audio-stage-jump" :title="t('后退 5 秒')" :aria-label="t('后退 5 秒')" @click="jump(-5)"><RotateCcw :size="19" /></button>
              <button type="button" class="audio-stage-play" :aria-label="isPlaying ? t('暂停') : t('播放')" @click="toggle">
                <Pause v-if="isPlaying" :size="24" /><Play v-else :size="24" class="play-icon-offset" />
              </button>
              <button type="button" class="audio-stage-jump" :title="t('快进 5 秒')" :aria-label="t('快进 5 秒')" @click="jump(5)"><RotateCw :size="19" /></button>
            </div>

            <div class="audio-stage-controls-side is-right">
              <button type="button" :title="isMuted ? t('取消静音') : t('静音')" :aria-label="isMuted ? t('取消静音') : t('静音')" @click="toggleMute">
                <VolumeX v-if="isMuted" :size="17" /><Volume2 v-else :size="17" />
              </button>
            </div>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Check, Copy, Download, FileText, Link2, LoaderCircle, Maximize2, Minimize2, Music2, Pause, Pencil, PictureInPicture, Play,
  Redo2, RotateCcw, RotateCw, Save, Sparkles, Target, Undo2, Video, Volume2, VolumeX, X,
} from 'lucide-vue-next';
import ProgressRing from './ProgressRing.vue';
import {
  buildLrcFromLines, downloadLrcBlob, formatLrcClock, generateLrcFromPrompt, parseLRC, parseLrcMetadata,
  parseLrcTimeInput, type LyricLine,
} from '../lib/lrc';
import { sungLines } from '../lib/music';
import { lockBodyScroll } from '../lib/scrollLock';
import { t } from '../lib/i18n';
import {
  activeMedia, attachAudio, attachVideo, close, currentTime, duration, expanded, isMuted, isPlaying,
  isVideoExpanded, jump, playbackRate, seek, setExpanded, setPlaybackRate, setVideoExpanded,
  stopVideoPreview, toggle, toggleMute, videoInlineHost, videoPreview, videoPreviewMuted, volume,
} from '../composables/player';
import { aligningIds, alignMusicLyrics, assets, saveMusicLyricTimeline } from '../composables/studio';

const PANEL_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

const audioRef = ref<HTMLAudioElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const videoFrameRef = ref<HTMLDivElement | null>(null);
const videoStageHost = ref<HTMLDivElement | null>(null);
const discRef = ref<HTMLButtonElement | null>(null);
const audioPanelRef = ref<HTMLElement | null>(null);
const activeLyricEl = ref<HTMLElement | null>(null);
const audioFromRect = ref<DOMRect | null>(null);
const videoFromRect = ref<DOMRect | null>(null);
const audioClosing = ref(false);
const videoClosing = ref(false);
const videoHovered = ref(false);
const copied = ref(false);
const localLrc = ref('');
const lyricListEl = ref<HTMLElement | null>(null);
const editingLyrics = ref(false);
const draftTimes = ref<number[]>([]);
const draftTexts = ref<string[]>([]);
const selectedLyricIndex = ref(0);
const lyricHistory = ref<{ times: number[]; texts: string[] }[]>([]);
const lyricRedo = ref<{ times: number[]; texts: string[] }[]>([]);
const savingLyrics = ref(false);
const editingTextIndex = ref(-1);
const textDraft = ref('');
const textInputEl = ref<HTMLInputElement | null>(null);
const textComposing = ref(false);
const editingTimeIndex = ref(-1);
const timeDraft = ref('');
const timeInputEl = ref<HTMLInputElement | null>(null);
const timeComposing = ref(false);
// 与 iLRC 的“锁定跟随”一致：微调某句时，它后面的所有句子一起平移。
const lockFollow = ref(false);
const waveTrackEl = ref<HTMLElement | null>(null);
const waveCanvasEl = ref<HTMLCanvasElement | null>(null);
const wavePeaks = ref<number[]>([]);
const waveLoading = ref(false);
const waveTime = ref(0);
const waveScrubbing = ref(false);
const waveCache = new Map<string, number[]>();
let waveFrame = 0;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let releaseAudioScroll: (() => void) | null = null;
let releaseVideoScroll: (() => void) | null = null;
let disposed = false;

const activeAudio = computed(() => (activeMedia.value?.kind === 'audio' ? activeMedia.value : null));
const hasVideo = computed(() => activeMedia.value?.kind === 'video');
const audioSrc = computed(() => activeAudio.value?.src);
const videoSrc = computed(() => videoPreview.value?.media.src ?? (hasVideo.value ? activeMedia.value?.src : undefined));
const inlineHost = computed(() => {
  if (isVideoExpanded.value || !hasVideo.value) return null;
  return videoInlineHost.value?.mediaId === activeMedia.value?.id ? videoInlineHost.value.host : null;
});
const isDockedInline = computed(() => !videoPreview.value && Boolean(inlineHost.value));
const videoHost = computed(() => videoPreview.value?.host ?? inlineHost.value ?? null);
const progressPercent = computed(() => duration.value > 0 ? Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100)) : 0);
const parsedLyrics = computed(() => parseLRC(localLrc.value));
// 校对时用草稿时间和文字显示，播放高亮也跟随草稿，方便边听边验证。
const displayLyrics = computed<LyricLine[]>(() => editingLyrics.value
  ? parsedLyrics.value.map((line, index) => ({
    ...line,
    time: draftTimes.value[index] ?? line.time,
    text: draftTexts.value[index] ?? line.text,
  }))
  : parsedLyrics.value);
const activeIndex = computed(() => displayLyrics.value.reduce((acc, line, index) => (currentTime.value >= line.time ? index : acc), -1));
const activeAsset = computed(() => assets.value.find(asset => asset.id === activeAudio.value?.id));
const canAlignLyrics = computed(() => Boolean(activeAsset.value && activeAsset.value.kind === 'music'));
const canEditLyrics = computed(() => Boolean(canAlignLyrics.value && parsedLyrics.value.length));
const lyricsDirty = computed(() => editingLyrics.value && parsedLyrics.value.some((line, index) =>
  Math.abs((draftTimes.value[index] ?? line.time) - line.time) > 0.004 || (draftTexts.value[index] ?? line.text) !== line.text));
const lyricsSourceLabel = computed(() => {
  if (activeAudio.value?.lrcSource === 'audio') return t('已按音频校准 · 可试听检查');
  if (activeAudio.value?.lrcSource === 'manual') return t('已手动校对 · 可试听检查');
  return t('歌词时间为估算 · 可按音频校准');
});
const aligning = computed(() => Boolean(activeAudio.value && aligningIds.value.includes(activeAudio.value.id)));
function alignLyrics() {
  if (activeAsset.value) void alignMusicLyrics(activeAsset.value);
}

function roundedTime(value: number) {
  const limit = Number.isFinite(duration.value) && duration.value > 0 ? duration.value : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(0, Math.min(value, limit)) * 100) / 100;
}

function snapshotLyrics() {
  return { times: [...draftTimes.value], texts: [...draftTexts.value] };
}

function sameLyricSnapshot(a: { times: number[]; texts: string[] }, b: { times: number[]; texts: string[] }) {
  if (a.times.length !== b.times.length || a.texts.length !== b.texts.length) return false;
  return a.times.every((time, index) => time === b.times[index])
    && a.texts.every((text, index) => text === b.texts[index]);
}

/**
 * 只有真正改动才入栈（对应 iLRC HistoryManager 的重复快照抑制），
 * 避免按住方向键在边界上重复点击时产生一串“撤销无变化”的记录。
 */
function mutateLyrics(mutate: () => void) {
  const before = snapshotLyrics();
  mutate();
  if (sameLyricSnapshot(before, snapshotLyrics())) return;
  lyricHistory.value = [...lyricHistory.value.slice(-49), before];
  lyricRedo.value = [];
}

function restoreLyrics(snapshot: { times: number[]; texts: string[] }) {
  draftTimes.value = [...snapshot.times];
  draftTexts.value = [...snapshot.texts];
}

function setDraftTime(index: number, value: number) {
  if (index < 0 || index >= draftTimes.value.length) return;
  const next = [...draftTimes.value];
  next[index] = roundedTime(value);
  draftTimes.value = next;
}

function beginLyricEdit() {
  if (!canEditLyrics.value) return;
  draftTimes.value = parsedLyrics.value.map(line => line.time);
  draftTexts.value = parsedLyrics.value.map(line => line.text);
  selectedLyricIndex.value = Math.max(0, Math.min(parsedLyrics.value.length - 1, activeIndex.value));
  lyricHistory.value = [];
  lyricRedo.value = [];
  editingTextIndex.value = -1;
  editingTimeIndex.value = -1;
  editingLyrics.value = true;
  waveTime.value = currentTime.value;
  startWaveClock();
  void loadWaveform();
  scrollSelectedLyric();
}

function stopLyricEditing() {
  editingLyrics.value = false;
  editingTextIndex.value = -1;
  editingTimeIndex.value = -1;
  lyricHistory.value = [];
  lyricRedo.value = [];
  draftTimes.value = [];
  draftTexts.value = [];
  stopWaveClock();
}

function cancelLyricEdit() {
  stopLyricEditing();
}

function selectLyric(index: number) {
  if (!editingLyrics.value) return;
  // Switching rows should keep whatever was typed, rather than dropping it
  // when the input unmounts. Escape still cancels through cancelTextEdit().
  if (editingTextIndex.value >= 0) commitTextEdit();
  selectedLyricIndex.value = Math.max(0, Math.min(draftTimes.value.length - 1, index));
  editingTextIndex.value = -1;
  editingTimeIndex.value = -1;
  scrollSelectedLyric();
}

function scrollSelectedLyric() {
  if (!editingLyrics.value) return;
  void nextTick(() => {
    const list = lyricListEl.value;
    const container = list?.closest<HTMLElement>('.audio-stage-lyrics');
    const row = list?.querySelectorAll<HTMLElement>('.lyric-line')[selectedLyricIndex.value];
    if (!container || !row) return;
    // Center the row in the area below the sticky editor toolbar.
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const toolbar = container.querySelector<HTMLElement>('.lyric-editor');
    const toolbarBottom = containerRect.top + (toolbar?.offsetHeight ?? 0);
    // Leave already visible rows alone: scrolling here would move the row out
    // from under a double-click that is about to open the text editor.
    if (rowRect.top >= toolbarBottom + 8 && rowRect.bottom <= containerRect.bottom - 8) return;
    const visibleCenter = toolbarBottom + (containerRect.bottom - toolbarBottom) / 2;
    const delta = rowRect.top + rowRect.height / 2 - visibleCenter;
    container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: 'smooth' });
  });
}

function stampSelected() {
  if (!editingLyrics.value) return;
  editingTextIndex.value = -1;
  editingTimeIndex.value = -1;
  // Read the element directly: the timeupdate ref can lag by up to 250ms.
  const element = audioRef.value;
  const time = element && Number.isFinite(element.currentTime) ? element.currentTime : currentTime.value;
  const index = selectedLyricIndex.value;
  mutateLyrics(() => setDraftTime(index, time));
  // Advance even when the stamped time happens to match, so tap-tap-tap keeps moving.
  if (index < draftTimes.value.length - 1) selectedLyricIndex.value = index + 1;
  scrollSelectedLyric();
}

function nudgeSelected(delta: number) {
  if (!editingLyrics.value) return;
  const start = selectedLyricIndex.value;
  mutateLyrics(() => {
    if (!lockFollow.value) {
      setDraftTime(start, (draftTimes.value[start] ?? 0) + delta);
      return;
    }
    // 锁定跟随：保持这一句和后面所有句子的相对间距，一次修正后续累计漂移。
    draftTimes.value = draftTimes.value.map((time, index) => index < start ? time : roundedTime(time + delta));
  });
}

function nudgeAll(delta: number) {
  if (!editingLyrics.value) return;
  mutateLyrics(() => {
    draftTimes.value = draftTimes.value.map(time => roundedTime(time + delta));
  });
}

function undoLyricEdit() {
  const previous = lyricHistory.value[lyricHistory.value.length - 1];
  if (!previous) return;
  editingTextIndex.value = -1;
  lyricRedo.value = [...lyricRedo.value.slice(-49), snapshotLyrics()];
  lyricHistory.value = lyricHistory.value.slice(0, -1);
  restoreLyrics(previous);
}

function redoLyricEdit() {
  const next = lyricRedo.value[lyricRedo.value.length - 1];
  if (!next) return;
  editingTextIndex.value = -1;
  lyricHistory.value = [...lyricHistory.value.slice(-49), snapshotLyrics()];
  lyricRedo.value = lyricRedo.value.slice(0, -1);
  restoreLyrics(next);
}

function beginTextEdit(index: number) {
  if (!editingLyrics.value) return;
  if (editingTextIndex.value >= 0 && editingTextIndex.value !== index) commitTextEdit();
  editingTimeIndex.value = -1;
  editingTextIndex.value = index;
  selectedLyricIndex.value = index;
  textDraft.value = draftTexts.value[index] ?? '';
  textComposing.value = false;
  void nextTick(() => {
    textInputEl.value?.focus();
    textInputEl.value?.select();
  });
}

function setTextInput(element: unknown) {
  textInputEl.value = element instanceof HTMLInputElement ? element : null;
}

function commitTextEdit() {
  const index = editingTextIndex.value;
  if (index < 0) return;
  const text = textDraft.value.trim();
  editingTextIndex.value = -1;
  if (!text || text === (draftTexts.value[index] ?? '')) return;
  mutateLyrics(() => {
    const next = [...draftTexts.value];
    next[index] = text;
    draftTexts.value = next;
  });
}

function cancelTextEdit() {
  editingTextIndex.value = -1;
}

function onTextEnter(event: KeyboardEvent) {
  if (textComposing.value) return;
  event.preventDefault();
  commitTextEdit();
}

function beginTimeEdit(index: number) {
  if (!editingLyrics.value) return;
  if (editingTextIndex.value >= 0) commitTextEdit();
  editingTextIndex.value = -1;
  selectedLyricIndex.value = index;
  editingTimeIndex.value = index;
  timeDraft.value = formatLrcClock(draftTimes.value[index] ?? 0);
  timeComposing.value = false;
  void nextTick(() => {
    timeInputEl.value?.focus();
    timeInputEl.value?.select();
  });
}

function setTimeInput(element: unknown) {
  timeInputEl.value = element instanceof HTMLInputElement ? element : null;
}

/**
 * 提交手输时间（01:23.45 或 83.45）。开启“联动后续”时，
 * 这一句的后继句子按同一差值整体平移，保持它们之间的相对间距。
 */
function commitTimeEdit() {
  const index = editingTimeIndex.value;
  if (index < 0) return;
  editingTimeIndex.value = -1;
  const parsed = parseLrcTimeInput(timeDraft.value);
  if (parsed == null) return;
  const previous = draftTimes.value[index] ?? 0;
  const delta = parsed - previous;
  if (Math.abs(delta) < 0.005) return;
  mutateLyrics(() => {
    if (!lockFollow.value) {
      setDraftTime(index, parsed);
      return;
    }
    draftTimes.value = draftTimes.value.map((time, i) => i < index ? time : roundedTime(time + delta));
  });
}

function onTimeEnter(event: KeyboardEvent) {
  if (timeComposing.value || event.isComposing) return;
  event.preventDefault();
  commitTimeEdit();
}

function cancelTimeEdit() {
  editingTimeIndex.value = -1;
}

function auditionSelected() {
  seek(Math.max(0, (draftTimes.value[selectedLyricIndex.value] ?? 0) - 1.5));
  if (!isPlaying.value) toggle();
}

function onLyricClick(item: LyricLine, index: number) {
  if (editingLyrics.value) selectLyric(index);
  else seek(item.time);
}

function wavePercent(time: number) {
  const total = duration.value;
  if (!Number.isFinite(total) || total <= 0) return '0%';
  return `${Math.max(0, Math.min(100, (time / total) * 100))}%`;
}

function startWaveClock() {
  stopWaveClock();
  const tick = () => {
    waveTime.value = audioRef.value?.currentTime ?? currentTime.value;
    waveFrame = requestAnimationFrame(tick);
  };
  tick();
  if (typeof window !== 'undefined') window.addEventListener('resize', drawWaveform);
}

function stopWaveClock() {
  if (waveFrame) cancelAnimationFrame(waveFrame);
  waveFrame = 0;
  if (typeof window !== 'undefined') window.removeEventListener('resize', drawWaveform);
}

function paintWaveform() {
  const canvas = waveCanvasEl.value;
  const peaks = wavePeaks.value;
  if (!canvas || !peaks.length) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const mid = height / 2;
  const barWidth = width / peaks.length;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(186, 201, 255, 0.82)');
  gradient.addColorStop(0.5, 'rgba(139, 160, 245, 0.55)');
  gradient.addColorStop(1, 'rgba(186, 201, 255, 0.82)');
  context.fillStyle = gradient;
  peaks.forEach((peak, index) => {
    const bar = Math.max(1.5, peak * height * 0.44);
    context.fillRect(index * barWidth, mid - bar, Math.max(1, barWidth - 1), bar * 2);
  });
}

function drawWaveform() {
  paintWaveform();
}

async function loadWaveform() {
  const asset = activeAsset.value;
  if (!asset) return;
  const cached = waveCache.get(asset.id);
  if (cached) {
    wavePeaks.value = cached;
    void nextTick(paintWaveform);
    return;
  }
  const assetId = asset.id;
  waveLoading.value = true;
  wavePeaks.value = [];
  try {
    let blob = asset.blob;
    if (!blob && activeAudio.value?.src) {
      const response = await fetch(activeAudio.value.src);
      if (!response.ok) throw new Error('audio fetch failed');
      blob = await response.blob();
    }
    if (!blob?.size) throw new Error('no audio');
    const context = new AudioContext();
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
    finally { await context.close(); }
    const samples = decoded.getChannelData(0);
    const buckets = 480;
    const step = Math.max(1, Math.floor(samples.length / buckets));
    const peaks = new Array<number>(buckets).fill(0);
    let max = 0;
    for (let bucket = 0; bucket < buckets; bucket++) {
      const start = bucket * step;
      const end = Math.min(samples.length, start + step);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const value = Math.abs(samples[i]);
        if (value > peak) peak = value;
      }
      peaks[bucket] = peak;
      if (peak > max) max = peak;
    }
    const normalized = max > 0 ? peaks.map(peak => Math.pow(peak / max, 0.7)) : peaks;
    waveCache.set(assetId, normalized);
    if (!editingLyrics.value || activeAudio.value?.id !== assetId) return;
    wavePeaks.value = normalized;
    await nextTick();
    paintWaveform();
  } catch { /* Waveform is optional; stamping still works. */ }
  finally {
    if (activeAudio.value?.id === assetId) waveLoading.value = false;
  }
}

function scrubWave(event: PointerEvent) {
  const track = waveTrackEl.value;
  const total = duration.value;
  if (!track || !Number.isFinite(total) || total <= 0) return;
  const rect = track.getBoundingClientRect();
  if (!rect.width) return;
  const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total;
  seek(target);
  // Keep the display in sync even when rAF is throttled in a background tab.
  waveTime.value = audioRef.value?.currentTime ?? target;
}

function beginWaveScrub(event: PointerEvent) {
  waveScrubbing.value = true;
  try { (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId); } catch { /* synthetic or stale pointer */ }
  scrubWave(event);
}

function onWaveScrub(event: PointerEvent) {
  if (waveScrubbing.value) scrubWave(event);
}

function endWaveScrub(event: PointerEvent) {
  waveScrubbing.value = false;
  try { (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
}

async function saveLyricEdits() {
  const asset = activeAsset.value;
  if (!asset || !editingLyrics.value || savingLyrics.value) return;
  savingLyrics.value = true;
  try {
    const lrc = buildLrcFromLines(displayLyrics.value, {
      title: activeAudio.value?.title || asset.song?.title || '',
      // 保留原 LRC 的 [ar:]、[al:] 等头部信息，只更新时间行。
      meta: parseLrcMetadata(localLrc.value || activeAudio.value?.lrc || ''),
    });
    await saveMusicLyricTimeline(asset, lrc);
    const media = activeMedia.value;
    stopLyricEditing();
    localLrc.value = lrc;
    if (media && media.id === asset.id) activeMedia.value = { ...media, lrc, lrcSource: 'manual' };
  } finally {
    savingLyrics.value = false;
  }
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applyAudioOutput() {
  const element = audioRef.value;
  if (!element) return;
  element.volume = volume.value;
  element.muted = isMuted.value;
  try { element.playbackRate = playbackRate.value; } catch { /* not ready */ }
}

function applyVideoOutput() {
  const element = videoRef.value;
  if (!element) return;
  element.muted = videoPreview.value ? videoPreviewMuted.value : isMuted.value;
  try { element.playbackRate = playbackRate.value; } catch { /* not ready */ }
}

function onAudioPlay() {
  if (videoRef.value && !videoRef.value.paused) videoRef.value.pause();
  if (activeMedia.value?.kind === 'audio') isPlaying.value = true;
}

function onAudioPause() {
  if (activeMedia.value?.kind !== 'audio') return;
  isPlaying.value = false;
}

function onAudioEnded() {
  if (activeMedia.value?.kind === 'audio') isPlaying.value = false;
}

function onAudioTime() {
  const element = audioRef.value;
  if (!element || activeMedia.value?.kind !== 'audio') return;
  currentTime.value = element.currentTime;
  if (editingLyrics.value) waveTime.value = element.currentTime;
  if (Number.isFinite(element.duration)) duration.value = element.duration;
}

function onAudioLoaded() {
  applyAudioOutput();
  const element = audioRef.value;
  if (!element || activeMedia.value?.kind !== 'audio') return;
  if (Number.isFinite(element.duration)) duration.value = element.duration;
  if (isPlaying.value && element.paused) void element.play().catch(() => { isPlaying.value = false; });
}

function onVideoPlay() {
  if (videoPreview.value) return;
  audioRef.value?.pause();
  if (activeMedia.value?.kind === 'video') isPlaying.value = true;
}

function onVideoPause() {
  if (videoPreview.value) return;
  if (activeMedia.value?.kind === 'video') isPlaying.value = false;
}

function onVideoTime() {
  const element = videoRef.value;
  if (!element || videoPreview.value || activeMedia.value?.kind !== 'video') return;
  currentTime.value = element.currentTime;
  if (Number.isFinite(element.duration)) duration.value = element.duration;
}

function onVideoEnded() {
  if (videoPreview.value) return;
  isPlaying.value = false;
}

function onVideoLoaded() {
  applyVideoOutput();
  const element = videoRef.value;
  if (!element) return;
  if (videoPreview.value) {
    element.loop = true;
    element.muted = videoPreviewMuted.value;
    void element.play().catch(() => {});
    return;
  }
  if (activeMedia.value?.kind !== 'video') return;
  if (Number.isFinite(element.duration)) duration.value = element.duration;
  restoreVideoPlayback();
}

function restoreVideoPlayback() {
  const element = videoRef.value;
  if (!element || !hasVideo.value || videoPreview.value) return;
  const target = currentTime.value;
  const restore = () => {
    if (target < 0.25) return;
    try { if (Math.abs(element.currentTime - target) > 0.5) element.currentTime = target; } catch { /* not ready */ }
  };
  if (element.readyState >= 1) restore();
  else element.addEventListener('loadedmetadata', restore, { once: true });
  element.muted = isMuted.value;
  if (isPlaying.value && element.paused) void element.play().catch(() => { isPlaying.value = false; });
}

function togglePip() {
  const element = videoRef.value;
  if (!element) return;
  try {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void element.requestPictureInPicture();
  } catch { /* unsupported */ }
}

function toggleFullscreen() {
  const frame = videoFrameRef.value;
  if (!frame) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void frame.requestFullscreen().catch(() => {});
}

function changeRate() {
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const index = rates.indexOf(playbackRate.value);
  setPlaybackRate(rates[(index + 1) % rates.length]);
}

async function copyLrc() {
  if (!localLrc.value) return;
  try {
    await navigator.clipboard.writeText(localLrc.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch { /* clipboard unavailable */ }
}

function downloadLrc() {
  if (!localLrc.value) return;
  downloadLrcBlob(localLrc.value, `${(activeMedia.value?.title || 'olai-music').replace(/\s+/g, '_')}.lrc`);
}

function setActiveLyric(index: number, element: any) {
  if (index === activeIndex.value) activeLyricEl.value = (element as HTMLElement | null) ?? null;
}

function animateIn(element: HTMLElement | null, source: DOMRect | null, fromRadius: string) {
  if (!element || !source || reducedMotion()) return;
  const target = element.getBoundingClientRect();
  if (!target.width || !target.height || !source.width || !source.height) return;
  element.animate(
    [
      {
        transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
        borderRadius: fromRadius,
        opacity: 0.55,
      },
      { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
    ],
    { duration: 440, easing: PANEL_EASE },
  );
}

function openAudioPlayer() {
  audioFromRect.value = discRef.value?.getBoundingClientRect() ?? null;
  audioClosing.value = false;
  setExpanded(true);
}

function collapseAudioPlayer() {
  if (audioClosing.value) return;
  const element = audioPanelRef.value;
  const source = audioFromRect.value;
  if (!element || !source || reducedMotion()) {
    setExpanded(false);
    return;
  }
  const target = element.getBoundingClientRect();
  if (!target.width || !target.height) {
    setExpanded(false);
    return;
  }
  audioClosing.value = true;
  const animation = element.animate(
    [
      { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
      {
        transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
        borderRadius: '50%',
        opacity: 0,
      },
    ],
    { duration: 360, easing: PANEL_EASE, fill: 'forwards' },
  );
  const finish = () => {
    setExpanded(false);
    audioClosing.value = false;
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

function openVideoTheater() {
  if (!hasVideo.value) return;
  videoFromRect.value = (inlineHost.value ?? videoFrameRef.value)?.getBoundingClientRect() ?? null;
  videoClosing.value = false;
  setVideoExpanded(true);
}

function collapseVideoTheater() {
  if (videoClosing.value || !isVideoExpanded.value) return;
  const element = videoFrameRef.value;
  const source = videoFromRect.value;
  if (!element || !source || reducedMotion()) {
    setVideoExpanded(false);
    return;
  }
  const target = element.getBoundingClientRect();
  if (!target.width || !target.height || !source.width || !source.height) {
    setVideoExpanded(false);
    return;
  }
  videoClosing.value = true;
  const animation = element.animate(
    [
      { transform: 'translate(0, 0) scale(1, 1)', borderRadius: getComputedStyle(element).borderRadius, opacity: 1 },
      {
        transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
        borderRadius: '18px',
        opacity: 0.4,
      },
    ],
    { duration: 340, easing: PANEL_EASE, fill: 'forwards' },
  );
  const finish = () => {
    setVideoExpanded(false);
    videoClosing.value = false;
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

function onAudioKeydown(event: KeyboardEvent) {
  // A modal dialog in the top layer owns Escape and focus while it is open.
  if (document.querySelector('dialog[open]')) return;
  if (editingLyrics.value) {
    const target = event.target as HTMLElement | null;
    const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editingTimeIndex.value >= 0) cancelTimeEdit();
      else if (editingTextIndex.value >= 0) cancelTextEdit();
      else cancelLyricEdit();
      return;
    }
    // While editing lyric text, leave every other key to the input (including undo).
    if (typing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoLyricEdit();
      else undoLyricEdit();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      redoLyricEdit();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === 't') {
        event.preventDefault();
        stampSelected();
        return;
      }
      if (key === 'l') {
        event.preventDefault();
        lockFollow.value = !lockFollow.value;
        return;
      }
      if (event.key === '[' || event.key === '-') {
        event.preventDefault();
        nudgeSelected(-0.1);
        return;
      }
      if (event.key === ']' || event.key === '=' || event.key === '+') {
        event.preventDefault();
        nudgeSelected(0.1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 0.1;
        nudgeSelected(event.key === 'ArrowLeft' ? -step : step);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        selectLyric(selectedLyricIndex.value + (event.key === 'ArrowUp' ? -1 : 1));
        return;
      }
    }
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    collapseAudioPlayer();
    return;
  }
  if (event.key !== 'Tab' || !audioPanelRef.value) return;
  const focusable = Array.from(audioPanelRef.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    .filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function onVideoKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  collapseVideoTheater();
}

watch(() => activeMedia.value?.id, async () => {
  if (editingLyrics.value) cancelLyricEdit();
  await nextTick();
  applyAudioOutput();
  applyVideoOutput();
  const media = activeMedia.value;
  if (!media) return;
  const element = media.kind === 'video' ? videoRef.value : audioRef.value;
  if (!element) return;
  if (media.kind === 'video') {
    if (isPlaying.value && element.paused) void element.play().catch(() => { isPlaying.value = false; });
  } else if (isPlaying.value && element.paused) {
    void element.play().catch(() => { isPlaying.value = false; });
  }
});

watch([activeMedia, duration], () => {
  if (editingLyrics.value) return;
  const media = activeMedia.value;
  if (!media || media.kind !== 'audio') { localLrc.value = ''; return; }
  // A song stub with no sung lines (admin-published music) must not shadow the
  // plain lyrics field: fall back to it so the estimated timeline still works.
  const sung = media.song ? sungLines(media.song) : '';
  const lyrics = sung || (media.lyrics || '').replace(/^\[[^\]]+\]\s*$/gm, '');
  if (media.song?.instrumental) localLrc.value = '';
  else if ((media.lrcSource === 'audio' || media.lrcSource === 'manual') && media.lrc) localLrc.value = media.lrc;
  else if (lyrics && duration.value > 0) localLrc.value = generateLrcFromPrompt(lyrics, duration.value, media.title);
  else localLrc.value = media.lrc || '';
}, { immediate: true });

watch(activeIndex, async () => {
  if (!expanded.value || editingLyrics.value) return;
  await nextTick();
  activeLyricEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

watch(expanded, async open => {
  if (typeof window === 'undefined') return;
  if (open) {
    await nextTick();
    if (disposed) return;
    animateIn(audioPanelRef.value, audioFromRect.value, '50%');
    releaseAudioScroll = lockBodyScroll();
    window.addEventListener('keydown', onAudioKeydown);
    requestAnimationFrame(() => audioPanelRef.value?.querySelector<HTMLElement>('.audio-stage-collapse')?.focus());
  } else {
    cancelLyricEdit();
    releaseAudioScroll?.();
    releaseAudioScroll = null;
    window.removeEventListener('keydown', onAudioKeydown);
  }
});

watch(isVideoExpanded, async open => {
  if (typeof window === 'undefined') return;
  if (open) {
    await nextTick();
    if (disposed) return;
    animateIn(videoFrameRef.value, videoFromRect.value, '18px');
    releaseVideoScroll = lockBodyScroll();
    window.addEventListener('keydown', onVideoKeydown);
    requestAnimationFrame(() => videoFrameRef.value?.querySelector<HTMLElement>('.video-theater-toggle')?.focus());
  } else {
    releaseVideoScroll?.();
    releaseVideoScroll = null;
    window.removeEventListener('keydown', onVideoKeydown);
  }
});

watch(videoPreview, async preview => {
  await nextTick();
  const element = videoRef.value;
  if (!element) return;
  if (preview) {
    element.loop = true;
    element.muted = videoPreviewMuted.value;
    void element.play().catch(() => {});
  } else {
    element.loop = false;
    if (activeMedia.value?.kind === 'video') restoreVideoPlayback();
    else element.pause();
  }
});

watch(videoPreviewMuted, value => {
  if (videoRef.value && videoPreview.value) videoRef.value.muted = value;
});

watch(videoHost, async () => {
  await nextTick();
  if (videoPreview.value) return;
  restoreVideoPlayback();
});

// video 现在按需挂载：元素出现/消失时同步给全局播放器，mediaElement 才不会
// 一直停在 onMounted 时的 null。
watch(videoRef, element => attachVideo(element), { flush: 'post' });

watch(isMuted, value => {
  if (audioRef.value) audioRef.value.muted = value;
  if (videoRef.value && !videoPreview.value) videoRef.value.muted = value;
});

onMounted(() => {
  attachAudio(audioRef.value);
  attachVideo(videoRef.value);
});

onBeforeUnmount(() => {
  disposed = true;
  // The player is mounted inside the studio page. Leaving it would otherwise
  // remount later with a full-screen stage flag that never reacquired its
  // scroll lock or Escape listener.
  setExpanded(false);
  setVideoExpanded(false);
  stopWaveClock();
  attachAudio(null);
  attachVideo(null);
  stopVideoPreview();
  clearTimeout(copiedTimer);
  releaseAudioScroll?.();
  releaseVideoScroll?.();
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onAudioKeydown);
    window.removeEventListener('keydown', onVideoKeydown);
  }
});
</script>
