<template>
  <div class="media-workspace" :class="[`${kind}-workspace`, { 'embedded-creation': embedded }]">
    <div class="page-intro">
      <div>
        <span class="eyebrow">A LITTLE IDEA. A NEW POSSIBILITY.</span>
        <h1>{{ t('{mode}创作', { mode: name }) }}<span class="heading-spark">✦</span></h1>
        <p>{{ kind === 'music' ? t('从一个念头，到一首属于你的歌。') : kind === 'image' ? t('把脑海里的色彩，变成眼前的惊喜。') : t('让想象开始流动，让故事有了画面。') }}</p>
      </div>
      <span class="workspace-step">{{ t('01 描述灵感') }} <span>→</span> {{ t('02 收获作品') }}</span>
    </div>

    <div class="generation-layout">
      <CreationParameters :embedded="embedded" :host="panelHost" :summary="parametersSummary">
        <fieldset class="creation-fields" :disabled="locked">
          <template v-if="models.length">
            <label class="field-label">
              {{ t('生成模型') }}
              <Select v-model="selectedModel" :aria-label="t('选择生成模型')" :options="[{ value: '', label: t('默认模型') }, ...models.map(model => ({ value: model.id, label: model.name }))]" />
            </label>
            <p v-if="selectedModelModel" class="field-hint">{{ modelPriceLabel(selectedModelModel) }}</p>
          </template>

          <template v-if="kind === 'music'">
            <div class="music-mode-tabs" role="tablist" :aria-label="t('音乐创作模式')">
              <button type="button" role="tab" :aria-selected="mode === 'inspiration'" :class="{ selected: mode === 'inspiration' }" @click="mode = 'inspiration'"><Sparkles :size="16" />{{ t('灵感模式') }}</button>
              <button type="button" role="tab" :aria-selected="mode === 'composer'" :class="{ selected: mode === 'composer' }" @click="enterComposer"><WandSparkles :size="16" />Composer</button>
            </div>
            <p class="field-hint mode-description">{{ mode === 'inspiration' ? t('写下故事、心情或几句歌词，自动整理为完整歌曲段落。') : useDraft ? t('编辑下方段落后直接生成；更换输入框中的灵感会重新整理歌曲。') : t('灵感已修改，下次生成会按新描述重新整理歌曲。') }}</p>
          </template>

          <template v-if="!embedded && (kind !== 'music' || mode === 'inspiration')">
            <div class="panel-title">
              <span><WandSparkles :size="17" />{{ t('描述你的灵感') }}</span>
              <span class="tiny-label">YOUR IDEA</span>
            </div>
            <textarea v-model="localPrompt" class="prompt-input" :aria-label="t('{mode}描述', { mode: name })" :placeholder="placeholder" maxlength="10000" rows="5" />
            <div class="prompt-counter">{{ localPrompt.length }} / 10000</div>
          </template>

          <template v-if="kind === 'music'">
            <label class="checkbox-label"><input v-model="song.instrumental" type="checkbox" />{{ t('纯音乐 · 无人声') }}</label>
            <label class="checkbox-label"><input v-model="generateCover" type="checkbox" />{{ t('生成封面') }}</label>
            <p class="field-hint">{{ t('根据歌曲主题与风格绘制封面，和音乐一起保存。') }}</p>

            <div v-if="mode === 'composer'" class="song-composer">
              <label class="field-label">{{ t('歌曲名称') }}<input v-model="song.title" maxlength="100" :placeholder="t('给这首歌起个名字')" /></label>
              <label class="field-label">{{ t('整体音乐方向') }}<textarea v-model="song.style" rows="2" maxlength="2000" :placeholder="t('节奏、乐器、情绪、人声…')" /></label>
              <div class="section-sequence" :aria-label="t('歌曲段落顺序')">
                <span v-for="(section, index) in song.sections" :key="section.id">{{ index + 1 }}. {{ section.type }}</span>
              </div>
              <div v-for="(section, index) in song.sections" :key="section.id" class="song-section" :class="`section-${section.type}`">
                <div class="song-section-header">
                  <span class="section-number">{{ String(index + 1).padStart(2, '0') }}</span>
                  <Select v-model="section.type" class-name="song-section-select" :aria-label="t('第 {n} 段类型', { n: index + 1 })" :options="SECTION_TYPES.map(type => ({ value: type, label: `${type} · ${SECTION_LABELS[type]}` }))" />
                  <div class="section-actions">
                    <button type="button" class="icon-button" :aria-label="t('上移第 {n} 段', { n: index + 1 })" :disabled="locked || index === 0" @click="moveSection(index, -1)"><ArrowUp :size="14" /></button>
                    <button type="button" class="icon-button" :aria-label="t('下移第 {n} 段', { n: index + 1 })" :disabled="locked || index === song.sections.length - 1" @click="moveSection(index, 1)"><ArrowDown :size="14" /></button>
                    <button type="button" class="icon-button" :aria-label="t('删除第 {n} 段', { n: index + 1 })" :disabled="locked || song.sections.length === 1" @click="song.sections.splice(index, 1)"><Trash2 :size="14" /></button>
                  </div>
                </div>
                <input v-model="section.direction" :aria-label="t('第 {n} 段编曲', { n: index + 1 })" :placeholder="t('编曲方向，如：钢琴渐入，节奏逐渐加强')" maxlength="2000" />
                <textarea v-if="!song.instrumental" v-model="section.lyrics" :aria-label="t('第 {n} 段歌词', { n: index + 1 })" rows="3" :placeholder="t('写下这一段的歌词…')" maxlength="6000" />
              </div>
              <button type="button" class="secondary-button add-section" :disabled="locked || song.sections.length >= 30" @click="addSection"><Plus :size="16" />{{ t('添加段落') }}</button>
            </div>
          </template>

          <label class="field-label">{{ t('创作风格') }}</label>
          <div class="style-options">
            <button v-for="(styleOption, index) in styles" :key="styleOption" type="button" :class="{ selected: style === (index ? styleOption : '') }" @click="style = index ? styleOption : ''">{{ styleOption }}</button>
          </div>

          <template v-if="kind !== 'music'">
            <div class="form-divider" />
            <template v-if="kind === 'image'">
              <label class="field-label">{{ t('画面比例') }}</label>
              <div class="aspect-options">
                <button v-for="item in [...IMAGE_RATIOS, 'custom']" :key="item" type="button" :class="{ selected: ratio === item }" @click="ratio = item">{{ item === 'auto' ? t('Auto · 自动') : item === 'custom' ? t('自定义') : item }}</button>
              </div>
              <label v-if="ratio === 'custom'" class="field-label">{{ t('自定义比例') }}<input v-model="customRatio" :aria-label="t('自定义图片比例')" :placeholder="t('例如 2.35:1')" /></label>
              <p class="field-hint">{{ t('自动模式会根据你的描述决定画面构图。') }}</p>
            </template>
            <div class="settings-grid">
              <label v-if="kind === 'video'" class="field-label video-duration">
                <span class="video-duration-heading">{{ t('视频时长') }}<output>{{ t('{n} 秒', { n: duration }) }}</output></span>
                <input v-model.number="duration" type="range" :aria-label="t('视频时长')" :aria-valuetext="t('{n} 秒', { n: duration })" :min="minimumDuration" :max="maximumDuration" step="1" />
                <span class="video-duration-limits" aria-hidden="true"><span>{{ t('{n} 秒', { n: minimumDuration }) }}</span><span>{{ t('{n} 秒', { n: maximumDuration }) }}</span></span>
              </label>
              <label v-if="kind === 'video'" class="field-label">{{ t('画面比例') }}
                <Select v-model="ratio" :aria-label="t('画面比例')" :options="[{ value: '16:9', label: t('16:9 · 横屏') }, { value: '9:16', label: t('9:16 · 竖屏') }]" />
              </label>
              <label class="field-label">{{ kind === 'image' ? t('目标分辨率') : t('画质') }}
                <Select v-model="quality" :aria-label="t('画质')" :options="qualityOptions" />
              </label>
              <label class="field-label">{{ t('联想等级') }}
                <Select v-model="thinking" :aria-label="t('联想等级')" :options="[{ value: 'minimal', label: t('Minimal · 轻度') }, { value: 'medium', label: t('Medium · 适中') }, { value: 'high', label: t('High · 丰富') }]" />
              </label>
            </div>
            <p v-if="kind === 'image'" class="field-hint">{{ status.imageMode === 'interactions' ? t('按所选分辨率请求生成，实际像素见作品卡片。自定义比例作为构图偏好。') : status.imageMode === 'upstream' ? t('按服务支持的尺寸请求生成，实际像素见作品卡片。') : t('当前服务仅将分辨率作为创作偏好，选择 4K 不保证输出 4K。实际像素见作品卡片。') }}</p>
            <div v-if="!embedded" class="reference-field">
              <label class="field-label">{{ t('参考图片（可选）') }}</label>
              <input ref="referenceInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="addReferences" />
              <div class="composer-attachments reference-list">
                <figure v-for="reference in references" :key="reference.url" class="attachment-preview">
                  <img :src="reference.url" :alt="reference.file.name" :title="reference.file.name" />
                  <button type="button" class="attachment-remove" :aria-label="t('移除附件')" @click="removeReference(reference.url)"><X :size="12" /></button>
                </figure>
                <button v-if="references.length < 4" type="button" class="creation-plus composer-attach reference-add" :aria-label="t('添加参考图片')" :title="t('添加参考图片')" @click="referenceInput?.click()"><Plus :size="18" /></button>
              </div>
            </div>
          </template>

          <button v-if="kind === 'music' && mode === 'inspiration'" type="button" class="secondary-button organize-button" :disabled="locked || !prompt.trim()" @click="organize(true)">
            <WandSparkles :size="16" />{{ organizing ? t('正在编排歌曲…') : t('整理段落并编辑') }}
          </button>
        </fieldset>

        <p v-if="!embedded && error" class="error-text" role="alert">{{ error }}</p>
        <button v-if="!embedded" type="button" class="primary-button generate-button" :disabled="locked || !hasInput" @click="create">
          <LoaderCircle v-if="locked" :size="18" class="spin" /><Sparkles v-else :size="18" />
          {{ organizing ? t('正在编排歌曲…') : locked ? t('正在生成…') : t('生成{mode}', { mode: name }) }}
          <ArrowUpRight v-if="!locked" :size="17" />
        </button>
        <p class="generation-note">{{ kind === 'music' ? t('歌曲、段落与歌词一起保存。歌词可导出 TXT；LRC 时间为估算，方便后续校准。') : kind === 'image' ? t('作品卡片显示实际像素，未达到目标分辨率时会提示。原图自动收入作品库，可下载。') : status.videoMode === 'chat' ? t('时长、比例和画质作为创作偏好，实际效果以返回视频为准。完成后自动保存，可播放和下载。') : t('时长与画质组合以服务支持为准，联想等级作为创作偏好。完成后自动保存，可播放和下载。') }}</p>
      </CreationParameters>

      <p v-if="embedded && error" ref="errorNotice" class="error-text creation-error" role="alert">{{ error }}</p>

      <section
        class="generation-results"
        :class="[`${kind}-results-panel`, 'case-results-panel', { 'has-creation-thread': creationExchanges.length }]"
      >
        <div v-if="creationExchanges.length" class="creation-thread">
          <div v-for="exchange in creationExchanges" :key="exchange.request.id" class="creation-exchange">
            <article class="sent-request creation-request">
              <div class="sent-request-bubble">
                <span v-if="exchange.request.images.length" class="sent-request-images">
                  <img v-for="image in exchange.request.images" :key="image.url" :src="image.url" :alt="image.name" :title="image.name" />
                </span>
                <span v-if="exchange.request.files.length" class="sent-request-files">
                  <span v-for="(file, fileIndex) in exchange.request.files" :key="`${file}-${fileIndex}`"><FileText :size="12" />{{ file }}</span>
                </span>
                <p>{{ exchange.request.text }}</p>
              </div>
              <span class="sent-request-avatar"><AccountAvatar :name="userName" :avatar="userAvatar" :size="30" /></span>
            </article>
            <div class="creation-response">
              <span class="creation-response-avatar"><BrandLogo :size="30" /></span>
              <div class="creation-response-main">
                <div v-for="asset in exchange.results" :key="asset.id" class="creation-result">
                  <AssetCard
                    :asset="asset"
                    :aligning="aligningIds.includes(asset.id)"
                    :publishable="Boolean(account.user)"
                    :publishing="visibilityBusyIds.includes(asset.id)"
                    @retry="retryAsset"
                    @delete="deleteAsset"
                    @download="downloadAsset"
                    @edit="startEdit"
                    @align="alignMusicLyrics"
                    @download-cover="downloadCover"
                    @retry-cover="retryCover"
                    @visibility="toggleAssetVisibility"
                  />
                </div>
                <div v-if="!exchange.results.length && locked" class="creation-waiting">
                  <LoaderCircle :size="17" class="spin" />{{ t('正在生成…') }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="case-showcase">
          <div class="case-intro">
            <span class="case-eyebrow">CASE INSPIRATION</span>
            <h2>{{ kind === 'music' ? t('把心情写成一首歌') : kind === 'video' ? t('让脑海里的故事动起来') : t('把想象变成画面') }}</h2>
            <p>{{ kind === 'music' ? t('写下故事、情绪或几句歌词，小o 陪你谱成歌。') : kind === 'video' ? t('描述场景、镜头和故事，小o 陪你把想象拍出来。') : t('描述画面、颜色和风格，小o 陪你把灵感变成图像。') }}</p>
            <span class="case-hint"><WandSparkles :size="13" />{{ t('点击案例，提示词与参数会直接填入创作表单。') }}</span>
            <div class="case-quick-list">
              <button v-for="item in showcase" :key="item.key" type="button" class="case-quick-item" @click="fillCase(item)">
                <span class="case-quick-mark"><ImageIcon v-if="kind === 'image'" :size="16" /><Video v-else-if="kind === 'video'" :size="16" /><Music2 v-else :size="16" /></span>
                <strong>{{ item.title }}</strong>
                <ArrowUpRight :size="13" />
              </button>
            </div>
            <button v-if="recent.length" type="button" class="case-view-all" @click="router.push('/library')">{{ t('查看全部作品') }}<ArrowUpRight :size="14" /></button>
          </div>
          <div class="case-collage">
            <button
              v-for="(item, index) in showcase"
              :key="item.key"
              type="button"
              class="case-tile"
              :class="{ 'is-preset': !item.cover, [`preset-${index % 3}`]: !item.cover }"
              :aria-label="t('使用案例：{title}', { title: item.title })"
              @click="fillCase(item)"
            >
              <span class="case-tile-media">
                <img v-if="item.cover" :src="item.cover" alt="" loading="lazy" />
                <span v-else class="case-tile-art"><ImageIcon v-if="kind === 'image'" :size="30" /><Video v-else-if="kind === 'video'" :size="30" /><Music2 v-else :size="30" /></span>
              </span>
              <span class="case-tile-caption"><strong>{{ item.title }}</strong><small>{{ item.meta || t('示例') }}</small></span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowDown, ArrowUp, ArrowUpRight, FileText, Image as ImageIcon, LoaderCircle, Music2, Plus, Sparkles, Trash2, Video, WandSparkles, X } from 'lucide-vue-next';
import AccountAvatar from './AccountAvatar.vue';
import AssetCard from './AssetCard.vue';
import BrandLogo from './BrandLogo.vue';
import CreationParameters from './ui/CreationParameters.vue';
import Select from './ui/Select.vue';
import { modelPriceLabel } from '../lib/modelPrices';
import type { Asset, MediaKind, SongDraft } from '../lib/types';
import { IMAGE_RATIOS, normalizeRatio } from '../lib/generation';
import { getGallery } from '../lib/gallery';
import { galleryTitle } from '../lib/galleryDetail';
import { newSong, SECTION_LABELS, SECTION_TYPES } from '../lib/music';
import { attachmentImages, attachmentPrompt, type ComposerAttachment } from '../lib/attachments';
import { t } from '../lib/i18n';
import {
  account, activeAssets, alignMusicLyrics, aligningIds, composeForMusic, deleteAsset, downloadAsset, downloadCover, generate, kindBusy,
  modelCatalog, modelSelection, retryAsset, retryCover, status, toggleAssetVisibility, visibilityBusyIds,
} from '../composables/studio';
import { uid } from '../composables/ui';

interface ShowcaseItem {
  key: string;
  title: string;
  prompt: string;
  style: string;
  meta?: string;
  cover?: string;
  instrumental?: boolean;
  ratio?: string;
  quality?: string;
  duration?: number;
  thinking?: string;
}
interface CreationRequest {
  id: string;
  text: string;
  images: { url: string; name: string }[];
  files: string[];
  startedAt: number;
}
interface CreationContext {
  requestId?: string;
  conversationId?: string;
  revisionOf?: Asset | null;
  version?: number;
}

const props = withDefaults(defineProps<{
  kind: MediaKind;
  embedded?: boolean;
  initialPrompt?: string;
  editAsset?: Asset | null;
  userName?: string;
  userAvatar?: string | null;
  panelHost?: HTMLElement | null;
  parameterRequest?: { token: string; options: Record<string, string | number> } | null;
  attachments?: ComposerAttachment[];
  requests?: CreationRequest[];
}>(), {
  embedded: false,
  initialPrompt: '',
  editAsset: null,
  userName: '',
  userAvatar: null,
  panelHost: null,
  parameterRequest: null,
  attachments: () => [],
  requests: () => [],
});
const emit = defineEmits<{
  consumedDraft: [];
  consumedEdit: [];
  composerStateChange: [state: { locked: boolean; hasInput: boolean; composingSong: boolean }];
  promptSuggestion: [prompt: string];
  editRequested: [asset: Asset];
}>();
const router = useRouter();

const name = computed(() => props.kind === 'image' ? t('图像') : props.kind === 'video' ? t('视频') : t('音乐'));
const placeholder = computed(() => props.kind === 'image'
  ? t('明亮的橙色花朵、蓝色天空，阳光穿过透明玻璃，细腻的摄影质感…')
  : props.kind === 'video'
    ? t('镜头缓缓穿过花海，阳光洒在随风摇曳的花瓣上，轻盈而梦幻…')
    : t('写一首关于夏天与重逢的歌。轻快的独立流行，温柔女声，副歌让人想跟着唱…'));
const models = computed(() => modelCatalog.value.filter(model => model.kind === props.kind));
const selectedModel = computed({
  get: () => modelSelection.value[props.kind] || '',
  set: value => { modelSelection.value = { ...modelSelection.value, [props.kind]: value }; },
});
const selectedModelModel = computed(() => models.value.find(model => model.id === selectedModel.value));
const recent = computed(() => activeAssets(props.kind).slice(0, 24));

const localPrompt = ref('');
const prompt = computed(() => props.embedded ? props.initialPrompt : localPrompt.value);
const style = ref('');
const ratio = ref(props.kind === 'video' ? '16:9' : 'auto');
const customRatio = ref('');
const quality = ref(props.kind === 'image' ? '1K' : '720p');
// Only offer the tiers the selected model supports; without a model (or for
// catalogs created before tiers existed) fall back to the usual set.
const IMAGE_QUALITIES = ['1K', '2K', '4K'];
const VIDEO_QUALITIES = ['720p', '1080p', '4k'];
const tierLabel = (tier: string) => tier === '4k' ? '4K' : tier;
const qualityOptions = computed(() => {
  if (props.kind === 'music') return [];
  const fallback = props.kind === 'image' ? IMAGE_QUALITIES : VIDEO_QUALITIES;
  const supported = selectedModelModel.value?.tiers;
  return (supported?.length ? supported : fallback).map(value => ({ value, label: tierLabel(value) }));
});
function setQuality(value: string) {
  if (!value) return;
  const normalized = props.kind === 'image' ? value.toUpperCase() : value.toLowerCase();
  if (qualityOptions.value.some(option => option.value === normalized)) quality.value = normalized;
}
watch(qualityOptions, options => {
  if (!options.length || options.some(option => option.value === quality.value)) return;
  const preferred = props.kind === 'image' ? '1K' : '720p';
  quality.value = (options.find(option => option.value === preferred) ?? options[0]).value;
}, { immediate: true });
const thinking = ref(props.kind === 'video' ? 'high' : 'medium');
const duration = ref(4);
const minimumDuration = computed(() => status.value.videoMode === 'task' ? 4 : 3);
const maximumDuration = computed(() => status.value.videoMode === 'task' ? 8 : 10);
const mode = ref<'inspiration' | 'composer'>('inspiration');
const song = ref<SongDraft>(newSong());
const generateCover = ref(false);
const draftPrompt = ref(props.initialPrompt.trim());
const organizing = ref(false);
const error = ref('');
const errorNotice = ref<HTMLElement | null>(null);
const references = ref<{ file: File; url: string }[]>([]);
const referenceInput = ref<HTMLInputElement | null>(null);
const localRequests = ref<CreationRequest[]>([]);
const attachmentText = computed(() => attachmentPrompt(props.attachments));
const referenceImages = computed(() => attachmentImages(props.attachments));

const styles = computed(() => props.kind === 'music'
  ? [t('自由创作'), t('流行'), 'Lo-fi', t('电子'), t('爵士'), t('氛围音乐')]
  : props.kind === 'image'
    ? [t('自由创作'), t('摄影'), t('3D 艺术'), t('插画'), t('电影感')]
    : [t('自由创作'), t('电影感'), t('自然风光'), t('产品展示'), t('动画')]);
const locked = computed(() => kindBusy(props.kind) || organizing.value);
const useDraft = computed(() => mode.value === 'composer' && prompt.value.trim() === draftPrompt.value);
const hasInput = computed(() => props.kind === 'music' && useDraft.value
  ? song.value.sections.some(section => section.direction.trim() || (!song.value.instrumental && section.lyrics.trim()))
  : !!prompt.value.trim() || !!attachmentText.value);
const composingSong = computed(() => props.kind === 'music' && useDraft.value);
const parametersSummary = computed(() => props.kind === 'music'
  ? t('{mode} · {vocal}{style}', {
      mode: mode.value === 'composer' ? t('段落编辑') : t('灵感模式'),
      vocal: song.value.instrumental ? t('纯音乐') : t('人声歌曲'),
      style: style.value ? ` · ${style.value}` : '',
    })
  : t('{ratio} · {quality}{duration}', {
      ratio: ratio.value === 'auto' ? t('自动比例') : ratio.value === 'custom' ? customRatio.value || t('自定义比例') : ratio.value,
      quality: tierLabel(quality.value),
      duration: props.kind === 'video' ? ` · ${t('{n} 秒', { n: duration.value })}` : '',
    }));

const presets = computed<ShowcaseItem[]>(() => props.kind === 'image'
  ? [
      { key: 'preset-illustration', title: t('画一幅小o 插画'), prompt: t('蓝紫色星球小o 漂浮在星云与花朵之间，柔和插画风。'), style: t('插画'), meta: `${t('插画')} · 1K`, quality: '1K', ratio: 'auto' },
      { key: 'preset-poster', title: t('做一张电影海报'), prompt: t('雨后的城市夜景，霓虹倒影，安静而有电影感。'), style: t('电影感'), meta: `${t('电影感')} · 2:3`, quality: '1K', ratio: '2:3' },
      { key: 'preset-product', title: t('产品静物摄影'), prompt: t('极简产品摄影，磨砂玻璃香水瓶置于浅色石材台面，柔和侧光，干净留白。'), style: t('摄影'), meta: `${t('摄影')} · 2K`, quality: '2K', ratio: 'auto' },
    ]
  : props.kind === 'video'
    ? [
        { key: 'preset-cinema', title: t('拍一段电影感镜头'), prompt: t('镜头缓缓穿过花海，阳光落在随风摇曳的花瓣上。'), style: t('电影感'), meta: `${t('电影感')} · 16:9`, ratio: '16:9', quality: '720p', duration: 4 },
        { key: 'preset-story', title: t('讲一个小故事'), prompt: t('一只小o 在星光下出发，穿过云层寻找新的朋友。'), style: t('动画'), meta: `${t('动画')} · 4 秒`, ratio: '16:9', quality: '720p', duration: 4 },
        { key: 'preset-valley', title: t('清晨山谷云海'), prompt: t('清晨的山谷云海，镜头缓慢推进，薄雾被日光照亮，宁静辽阔。'), style: t('自然风光'), meta: `${t('自然风光')} · 1080p`, ratio: '16:9', quality: '1080p', duration: 4 },
      ]
    : [
        { key: 'preset-pop', title: t('写一首温柔的歌'), prompt: t('关于夏天、晚风和重逢的轻快流行歌。'), style: t('流行'), meta: t('人声歌曲'), instrumental: false },
        { key: 'preset-ambient', title: t('做一段氛围音乐'), prompt: t('没有人声，适合夜晚阅读的梦幻氛围音乐。'), style: t('氛围音乐'), meta: t('纯音乐'), instrumental: true },
        { key: 'preset-lofi', title: t('Lo-fi 循环'), prompt: t('温暖的 lo-fi 器乐，轻柔钢琴、爵士吉他与细腻黑胶噪声，适合雨天阅读。'), style: 'Lo-fi', meta: t('纯音乐'), instrumental: true },
      ]);
const galleryCases = ref<ShowcaseItem[]>([]);
const showcase = computed(() => [...galleryCases.value, ...presets.value].slice(0, 3));
const requestList = computed<CreationRequest[]>(() => props.embedded ? props.requests : localRequests.value);
const creationExchanges = computed(() => {
  const sorted = [...requestList.value].sort((a, b) => a.startedAt - b.startedAt);
  const all = activeAssets(props.kind);
  // New records link assets through the shared request ID; legacy local lists still use time windows.
  if (all.some(asset => asset.requestId)) {
    return sorted.map(request => ({
      request,
      results: all.filter(asset => asset.requestId === request.id).sort((a, b) => a.createdAt - b.createdAt),
    }));
  }
  return sorted.map((request, index) => {
    const next = sorted[index + 1]?.startedAt ?? Number.POSITIVE_INFINITY;
    const results = all
      .filter(asset => asset.createdAt >= request.startedAt && asset.createdAt < next)
      .sort((a, b) => a.createdAt - b.createdAt);
    return { request, results };
  });
});
const sentReferenceURLs = new Set<string>();

watch(() => props.parameterRequest?.token, () => {
  const options = props.parameterRequest?.options;
  if (!options) return;
  if (typeof options.style === 'string') style.value = options.style;
  if (props.kind !== 'music') {
    const nextRatio = typeof options.aspect_ratio === 'string' ? options.aspect_ratio : '';
    if (nextRatio) {
      if (props.kind === 'image' && !IMAGE_RATIOS.includes(nextRatio)) { customRatio.value = nextRatio; ratio.value = 'custom'; }
      else if (props.kind === 'image' || ['16:9', '9:16'].includes(nextRatio)) ratio.value = nextRatio;
    }
    setQuality(String(props.kind === 'image' ? options.image_size : options.resolution || ''));
    if (props.kind === 'video' && typeof options.duration === 'number' && Number.isFinite(options.duration)) {
      duration.value = Math.min(maximumDuration.value, Math.max(minimumDuration.value, Math.round(options.duration)));
    }
    if (typeof options.reasoning_effort === 'string' && ['minimal', 'medium', 'high'].includes(options.reasoning_effort)) thinking.value = options.reasoning_effort;
  }
  emit('consumedDraft');
}, { immediate: true });

/** Library assets are reactive proxies, which structuredClone cannot copy. */
function cloneSong(source: SongDraft): SongDraft {
  return JSON.parse(JSON.stringify(source)) as SongDraft;
}
watch(() => props.editAsset, value => {
  if (!value?.song || props.kind !== 'music') return;
  song.value = cloneSong(value.song);
  style.value = '';
  generateCover.value = value.options.generate_cover === 1;
  draftPrompt.value = typeof value.options.inspiration === 'string' ? value.options.inspiration.trim() : '';
  if (!props.embedded) localPrompt.value = typeof value.options.inspiration === 'string' ? value.options.inspiration : value.prompt;
  mode.value = 'composer';
  error.value = '';
  emit('consumedEdit');
}, { immediate: true });

watch(error, async value => {
  if (!value || !props.embedded) return;
  await nextTick();
  errorNotice.value?.scrollIntoView({ block: 'nearest' });
});

watch([locked, hasInput, composingSong], () => {
  emit('composerStateChange', { locked: locked.value, hasInput: hasInput.value, composingSong: composingSong.value });
}, { immediate: true });

function composeBrief() {
  return [prompt.value.trim(), attachmentText.value].filter(Boolean).join('\n\n');
}
function fillCase(item: ShowcaseItem) {
  if (props.embedded) emit('promptSuggestion', item.prompt);
  else localPrompt.value = item.prompt;
  style.value = item.style;
  if (props.kind === 'music' && !styles.value.includes(item.style)) style.value = '';
  if (props.kind === 'music') {
    mode.value = 'inspiration';
    if (typeof item.instrumental === 'boolean') song.value = { ...song.value, instrumental: item.instrumental };
  } else {
    if (item.ratio) {
      if (props.kind === 'image' && !IMAGE_RATIOS.includes(item.ratio)) { ratio.value = 'custom'; customRatio.value = item.ratio; }
      else if (props.kind === 'image' || ['16:9', '9:16'].includes(item.ratio)) ratio.value = item.ratio;
    }
    if (item.quality) setQuality(item.quality);
    if (item.thinking && ['minimal', 'medium', 'high'].includes(item.thinking)) thinking.value = item.thinking;
    if (typeof item.duration === 'number') duration.value = Math.min(maximumDuration.value, Math.max(minimumDuration.value, item.duration));
  }
  error.value = '';
}
function recordRequest(startedAt: number, text: string) {
  const images = references.value.map(reference => ({ url: reference.url, name: reference.file.name }));
  images.forEach(image => sentReferenceURLs.add(image.url));
  localRequests.value.push({ id: uid(), text: text || t('开始创作'), images, files: [], startedAt });
}
function enterComposer() {
  draftPrompt.value = prompt.value.trim();
  mode.value = 'composer';
}
function addSection() {
  song.value.sections.push({ id: uid(), type: 'verse', direction: '', lyrics: '' });
}
function moveSection(index: number, offset: number) {
  const sections = [...song.value.sections];
  const next = index + offset;
  if (next < 0 || next >= sections.length) return;
  [sections[index], sections[next]] = [sections[next], sections[index]];
  song.value = { ...song.value, sections };
}
async function organize(openEditor: boolean) {
  error.value = '';
  organizing.value = true;
  try {
    const draft = await composeForMusic(composeBrief(), style.value, song.value.instrumental);
    song.value = draft;
    draftPrompt.value = prompt.value.trim();
    if (openEditor) mode.value = 'composer';
    return draft;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('歌曲整理失败，请重试。');
    return undefined;
  } finally {
    organizing.value = false;
  }
}
async function coverBlob(url?: string): Promise<Blob | undefined> {
  if (!url) return undefined;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : undefined;
  } catch { return undefined; }
}

async function create(context?: CreationContext): Promise<boolean> {
  if (locked.value || !hasInput.value) return false;
  error.value = '';
  const startedAt = Date.now();
  const brief = composeBrief();
  // Image and video follow-ups build on the previous result; music always starts a new song.
  const revision = props.kind === 'music' ? null : context?.revisionOf || null;
  const meta = {
    requestId: context?.requestId,
    conversationId: context?.conversationId,
    revisionOf: revision?.id,
    version: revision ? (context?.version ?? (revision.version || 1) + 1) : context?.version,
  };
  try {
    if (props.kind === 'music') {
      const draft = useDraft.value ? song.value : await organize(false);
      if (!draft) return false;
      if (!draft.sections.length || !draft.sections.some(section => section.direction.trim() || (!draft.instrumental && section.lyrics.trim()))) {
        throw new Error(t('请为至少一个段落填写歌词或编曲描述。'));
      }
      const finalSong = { ...draft, style: [draft.style, style.value].filter(Boolean).join('，') };
      const modelId = modelSelection.value.music;
      if (!props.embedded) recordRequest(startedAt, brief || finalSong.title || t('原创音乐'));
      void generate(props.kind, brief || finalSong.title || finalSong.style || t('原创音乐'), {
        song: JSON.stringify(finalSong),
        music_mode: useDraft.value ? 'composer' : 'inspiration',
        inspiration: brief,
        generate_cover: generateCover.value ? 1 : 0,
        ...(modelId ? { modelId } : {}),
      }, undefined, undefined, meta);
    } else {
      const aspect_ratio = normalizeRatio(ratio.value === 'custom' ? customRatio.value : ratio.value);
      const modelId = modelSelection.value[props.kind];
      const options: Record<string, string | number> = props.kind === 'image'
        ? { aspect_ratio, image_size: quality.value, reasoning_effort: thinking.value, n: 1 }
        : { aspect_ratio, seconds: duration.value, resolution: quality.value, reasoning_effort: thinking.value };
      if (modelId) options.modelId = modelId;
      let images: Blob[] = props.kind === 'video' && status.value.videoMode !== 'task' ? [] : referenceImages.value;
      // Keep the previous video's first frame as the reference for a task-mode revision.
      if (props.kind === 'video' && revision && status.value.videoMode === 'task' && !images.length) {
        const cover = await coverBlob(revision.coverUrl);
        if (cover) images = [cover];
      }
      const generationPrompt = revision
        ? `${revision.prompt}${brief ? `\n\n修改要求：${brief}` : ''}`
        : `${brief}${style.value ? `\n风格：${style.value}` : ''}`;
      if (!props.embedded) recordRequest(startedAt, prompt.value.trim() || name.value);
      void generate(props.kind, generationPrompt, options, undefined, images.length ? images : undefined, meta);
    }
    return true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('请检查创作内容。');
    return false;
  }
}
defineExpose({ create });
function addReferences(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files || [])) {
    if (references.value.length >= 4) break;
    if (!file.type.startsWith('image/')) continue;
    references.value.push({ file, url: URL.createObjectURL(file) });
  }
  input.value = '';
}
function removeReference(url: string) {
  if (!sentReferenceURLs.has(url)) URL.revokeObjectURL(url);
  references.value = references.value.filter(reference => reference.url !== url);
}
function startEdit(asset: Asset) {
  if (!asset.song || kindBusy('music')) return;
  if (props.embedded) { emit('editRequested', asset); return; }
  song.value = cloneSong(asset.song);
  generateCover.value = asset.options.generate_cover === 1;
  localPrompt.value = typeof asset.options.inspiration === 'string' ? asset.options.inspiration : asset.prompt;
  draftPrompt.value = localPrompt.value.trim();
  mode.value = 'composer';
  error.value = '';
}
onMounted(async () => {
  try {
    const page = await getGallery(0, AbortSignal.timeout(15_000), 12);
    galleryCases.value = page.records
      .filter(asset => asset.kind === props.kind && asset.status === 'completed')
      .slice(0, 3)
      .map(asset => ({
        key: `gallery-${asset.id}`,
        title: galleryTitle(asset),
        prompt: asset.prompt,
        style: asset.song?.style || '',
        meta: [asset.options.aspect_ratio, asset.options.image_size || asset.options.resolution].filter(Boolean).join(' · ') || t('作品广场'),
        cover: asset.thumbnail || asset.url || asset.coverThumbnail || asset.coverUrl,
        instrumental: asset.song?.instrumental,
        ratio: typeof asset.options.aspect_ratio === 'string' ? asset.options.aspect_ratio : undefined,
        quality: typeof asset.options.image_size === 'string'
          ? asset.options.image_size
          : typeof asset.options.resolution === 'string' ? asset.options.resolution : undefined,
        duration: typeof asset.options.duration === 'number' ? asset.options.duration : asset.audioDuration,
      }));
  } catch { /* the preset wall still works offline */ }
});
onBeforeUnmount(() => {
  const urls = new Set([...references.value.map(reference => reference.url), ...sentReferenceURLs]);
  urls.forEach(url => URL.revokeObjectURL(url));
});
</script>
