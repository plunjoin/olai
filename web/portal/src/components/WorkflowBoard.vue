<template>
  <section class="wf-editor" :aria-label="t('短片分镜编辑器')">
    <div class="wf-editor-bar"><span><Layers :size="17" /> {{ t('创作工作台') }}</span><span class="wf-muted">{{ t('拖入元素，让故事成形') }}</span></div>
    <div class="wf-editor-layout">
      <aside class="wf-elements" :aria-label="t('元素库')">
        <div class="wf-panel-title"><h3>{{ t('元素库') }}</h3><span>{{ elements.length }}</span></div>
        <div class="wf-element-tabs" :aria-label="t('元素分类')">
          <button v-for="kind in elementKinds" :key="kind" type="button" :aria-pressed="filter === kind" @click="filter = kind">
            <component :is="ICONS[kind]" :size="15" />{{ ELEMENT_LABELS[kind] }}
          </button>
        </div>
        <p class="wf-hint">{{ t('拖到镜头里复用，也可选中镜头后点击 ＋') }}</p>
        <div class="wf-element-list">
          <div
            v-for="element in visibleElements"
            :key="element.id"
            class="wf-element-card"
            :class="{ 'is-selected': selectedElement?.id === element.id }"
            draggable="true"
            @dragstart="startDrag($event, { kind: 'element', id: element.id })"
            @dragend="endDrag"
          >
            <button type="button" class="wf-element-main" :aria-label="t('编辑{kind}：{name}', { kind: ELEMENT_LABELS[element.kind], name: element.name })" @click="selection = { kind: 'element', id: element.id }">
              <span class="wf-element-icon" :class="element.kind"><component :is="ICONS[element.kind]" :size="21" /></span>
              <span><strong>{{ element.name }}</strong><small>{{ element.description || t('点击完善设定') }}</small></span>
            </button>
            <button type="button" class="wf-icon-button" :disabled="!selectedShot" :title="selectedShot ? t('加入选中镜头') : t('先选择一个镜头')" :aria-label="t('将{name}加入选中镜头', { name: element.name })" @click="addElementToShot(element.id)"><Plus :size="15" /></button>
          </div>
          <div v-if="!visibleElements.length" class="wf-element-empty">{{ t('还没有{kind}', { kind: ELEMENT_LABELS[filter] }) }}<br /><span>{{ t('创建专属于这个故事的设定') }}</span></div>
        </div>
        <button type="button" class="wf-add-element" @click="addElement(filter)"><Plus :size="16" />{{ t('新建{kind}', { kind: ELEMENT_LABELS[filter] }) }}</button>
        <div class="wf-library-note"><Check :size="15" /><span>{{ t('同一元素可用于多个镜头，修改设定会同步应用。') }}</span></div>
      </aside>

      <div class="wf-board">
        <div class="wf-board-heading">
          <div><h3>{{ t('分镜画布') }} <span>{{ t('{count} 个镜头', { count: shots.length }) }}</span></h3><p>{{ t('拖动镜头调整顺序 · 拖入人物、场景与道具') }}</p></div>
          <button type="button" class="wf-small-button" @click="addShot()"><Plus :size="15" />{{ t('添加镜头') }}</button>
        </div>
        <div class="wf-shot-grid">
          <article
            v-for="shot in shots"
            :key="shot.id"
            class="wf-shot"
            :class="{ 'is-selected': selectedShot?.id === shot.id, 'is-drop-target': dropTarget === shot.id, 'is-dragging': dragging?.id === shot.id }"
            @dragover="allowDrop($event, shot.id)"
            @dragleave="dropTarget = null"
            @drop="drop($event, shot.id)"
          >
            <div class="wf-shot-top">
              <button
                type="button"
                class="wf-drag-handle"
                draggable="true"
                :title="t('拖动排序；也可用左右方向键移动')"
                :aria-label="t('移动镜头 {number}', { number: shot.number })"
                @dragstart="startDrag($event, { kind: 'shot', id: shot.id })"
                @dragend="endDrag"
                @keydown="moveWithKeyboard($event, shot)"
              ><GripVertical :size="16" /><span>{{ t('镜头 {number}', { number: String(shot.number).padStart(2, '0') }) }}</span></button>
              <span>{{ shot.duration }}s</span>
            </div>
            <button type="button" class="wf-shot-body" :aria-label="t('编辑镜头 {number}', { number: shot.number })" @click="selection = { kind: 'shot', id: shot.id }">
              <div class="wf-shot-preview">
                <img v-if="shot.keyframeUrl" :src="shot.keyframeUrl" :alt="t('镜头 {number} 关键帧', { number: shot.number })" draggable="false" />
                <template v-else><Film :size="28" /><span>{{ shot.framing }} · {{ shot.cameraMovement }}</span></template>
              </div>
              <p>{{ shot.sceneDescription || t('点击填写这个镜头的故事…') }}</p>
              <div class="wf-shot-tags">
                <span v-for="element in shotElements(shot)" :key="element.id" :class="element.kind"><component :is="ICONS[element.kind]" :size="12" />{{ element.name }}</span>
                <span v-if="!shot.elementIds?.length" class="wf-drop-hint">{{ t('＋ 拖入创作元素') }}</span>
              </div>
            </button>
          </article>
          <button
            type="button"
            class="wf-new-shot"
            :class="{ 'is-drop-target': dropTarget === 'new' }"
            @click="addShot()"
            @dragover="allowDrop($event, 'new')"
            @dragleave="dropTarget = null"
            @drop="drop($event)"
          ><Plus :size="26" /><strong>{{ shots.length ? t('添加下一个镜头') : t('从第一个镜头开始') }}</strong><span>{{ t('点击创建，或把元素拖到这里') }}</span></button>
        </div>
        <div class="wf-timeline">
          <div class="wf-timeline-title"><span><Film :size="14" />{{ t('故事时间线') }}</span><span>{{ t('{current}s / 目标 {target}s', { current: totalDuration, target: project.targetLength || 30 }) }}</span></div>
          <div class="wf-timeline-track">
            <button v-for="shot in shots" :key="shot.id" type="button" :style="{ flexGrow: shot.duration }" :class="{ 'is-selected': selectedShot?.id === shot.id }" :title="t('镜头 {number} · {duration} 秒', { number: shot.number, duration: shot.duration })" @click="selection = { kind: 'shot', id: shot.id }">{{ String(shot.number).padStart(2, '0') }}<small>{{ shot.duration }}s</small></button>
            <p v-if="!shots.length">{{ t('添加镜头后，在这里查看故事节奏') }}</p>
          </div>
        </div>
      </div>

      <aside class="wf-inspector" :aria-label="t('属性编辑')">
        <div class="wf-panel-title"><h3><SlidersHorizontal :size="16" />{{ selectedElement ? t('{kind}设定', { kind: ELEMENT_LABELS[selectedElement.kind] }) : t('镜头属性') }}</h3><button v-if="selection" type="button" class="wf-icon-button" :aria-label="t('关闭属性编辑')" @click="selection = null"><X :size="15" /></button></div>
        <div v-if="selectedElement" :key="selectedElement.id" class="wf-fields">
          <label>{{ t('名称') }}<input :value="selectedElement.name" maxlength="60" @input="updateElement({ name: ($event.target as HTMLInputElement).value })" /></label>
          <label>{{ t('详细设定') }}<textarea :value="selectedElement.description" rows="7" :placeholder="elementPlaceholder(selectedElement.kind)" @input="updateElement({ description: ($event.target as HTMLTextAreaElement).value })" /></label>
          <p class="wf-hint">{{ t('设定将用于关联镜头的关键帧和视频生成。') }}</p>
          <button type="button" class="wf-danger-button" @click="deleteElement"><Trash2 :size="14" />{{ t('删除元素') }}</button>
        </div>
        <div v-else-if="selectedShot" :key="selectedShot.id" class="wf-fields">
          <div class="wf-selection-heading"><strong>{{ t('镜头 {number}', { number: String(selectedShot.number).padStart(2, '0') }) }}</strong><span>{{ selectedShot.videoStatus === 'completed' ? t('视频已就绪') : selectedShot.keyframeStatus === 'completed' ? t('关键帧已就绪') : t('待生成') }}</span></div>
          <div class="wf-shot-tools">
            <button type="button" :disabled="selectedShot.number === 1" :aria-label="t('镜头前移')" @click="move(selectedShot.id, selectedShot.number - 2)"><ArrowLeft :size="15" /></button>
            <button type="button" :disabled="selectedShot.number === shots.length" :aria-label="t('镜头后移')" @click="move(selectedShot.id, selectedShot.number)"><ArrowRight :size="15" /></button>
            <button type="button" :aria-label="t('复制镜头')" @click="copyShot"><Copy :size="15" /></button>
            <button type="button" :aria-label="t('删除镜头')" @click="deleteShot"><Trash2 :size="15" /></button>
          </div>
          <label>{{ t('时长（秒）') }}<input type="number" min="0.5" max="30" step="0.5" :value="selectedShot.duration" @change="setDuration" /></label>
          <div class="wf-field-pair">
            <label>{{ t('景别') }}<input :value="selectedShot.framing" @input="updateShotField({ framing: ($event.target as HTMLInputElement).value })" /></label>
            <label>{{ t('运镜') }}<input :value="selectedShot.cameraMovement" @input="updateShotField({ cameraMovement: ($event.target as HTMLInputElement).value })" /></label>
          </div>
          <label>{{ t('画面描述') }}<textarea rows="4" :value="selectedShot.sceneDescription" :placeholder="t('描述人物动作、故事情节与画面…')" @input="updateShotField({ sceneDescription: ($event.target as HTMLTextAreaElement).value })" /></label>
          <div class="wf-linked-elements">
            <span>{{ t('镜头元素') }}</span>
            <div v-for="element in shotElements(selectedShot)" :key="element.id"><span>{{ ELEMENT_LABELS[element.kind] }} · {{ element.name }}</span><button type="button" class="wf-icon-button" :aria-label="t('移除{name}', { name: element.name })" @click="detachElement(element.id)"><X :size="13" /></button></div>
            <Select
              :model-value="''"
              :aria-label="t('添加镜头元素')"
              :placeholder="t('＋ 选择人物 / 场景 / 道具')"
              :options="unlinkedElements.map(element => ({ value: element.id, label: `${ELEMENT_LABELS[element.kind]} · ${element.name}` }))"
              @update:model-value="addElementFromSelect"
            />
          </div>
          <label>{{ t('对白 / 旁白') }}<textarea rows="2" :value="selectedShot.dialogue || ''" :placeholder="t('这个镜头中说的话…')" @input="updateShotField({ dialogue: ($event.target as HTMLTextAreaElement).value })" /></label>
          <label>{{ t('音效备注') }}<input :value="selectedShot.soundNotes || ''" :placeholder="t('雨声、脚步声…')" @input="updateShotField({ soundNotes: ($event.target as HTMLInputElement).value })" /></label>
        </div>
        <div v-else class="wf-inspector-empty"><SlidersHorizontal :size="30" /><strong>{{ t('每个细节，都由你定义') }}</strong><p>{{ t('选中镜头编辑画面与运镜，') }}<br />{{ t('或点击元素完善人物和场景。') }}</p></div>
      </aside>
    </div>
    <div class="wf-sr-only" role="status" aria-live="polite">{{ announcement }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowLeft, ArrowRight, Box, Check, Copy, Film, GripVertical, Layers, MapPin, Plus, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-vue-next';
import {
  ELEMENT_LABELS, calculateTotalDuration, createEmptyShot, duplicateShot, moveShot,
  type Shot, type VideoWorkflowProject, type WorkflowElement, type WorkflowElementKind,
} from '../lib/videoWorkflow';
import { attachElement, clearShotMedia, editProjectShots, updateProjectElement } from '../lib/workflowEditor';
import { t } from '../lib/i18n';
import Select from './ui/Select.vue';

const props = defineProps<{ project: VideoWorkflowProject }>();
const emit = defineEmits<{ change: [project: VideoWorkflowProject] }>();
const ICONS = { character: UserRound, scene: MapPin, prop: Box };
const elementKinds: WorkflowElementKind[] = ['character', 'scene', 'prop'];
const DRAG_TYPE = 'application/x-olai-workflow';
type DragItem = { kind: 'shot' | 'element'; id: string };
type Selection = { kind: 'shot' | 'element'; id: string } | null;
const selection = ref<Selection>(null);
const filter = ref<WorkflowElementKind>('character');
const dragging = ref<DragItem | null>(null);
const dropTarget = ref<string | null>(null);
const announcement = ref('');
const shots = computed(() => props.project.shots || []);
const elements = computed(() => props.project.elements || []);
const totalDuration = computed(() => calculateTotalDuration(shots.value));
const selectedShot = computed(() => selection.value?.kind === 'shot' ? shots.value.find(shot => shot.id === selection.value!.id) : undefined);
const selectedElement = computed(() => selection.value?.kind === 'element' ? elements.value.find(element => element.id === selection.value!.id) : undefined);
const visibleElements = computed(() => elements.value.filter(element => element.kind === filter.value));
const unlinkedElements = computed(() => elements.value.filter(element => !selectedShot.value?.elementIds?.includes(element.id)));
function shotElements(shot: Shot) { return elements.value.filter(element => shot.elementIds?.includes(element.id)); }
function elementPlaceholder(kind: WorkflowElementKind) {
  return kind === 'character' ? t('外貌、发型、服装、性格，例如：短发女孩，穿黄色雨衣，勇敢好奇…') : kind === 'scene' ? t('地点、时间、光线、氛围，例如：雨后的老街，傍晚，霓虹倒映在水面…') : t('外观、材质、颜色、用途，例如：一台银色复古相机，皮质肩带…');
}
function commit(next: VideoWorkflowProject) { emit('change', next); }
function commitShots(next: Shot[]) { commit(editProjectShots(props.project, next)); }
function addShot(elementId?: string) {
  const shot = createEmptyShot(shots.value.length + 1);
  if (elementId) shot.elementIds = [elementId];
  commitShots([...shots.value, shot]);
  selection.value = { kind: 'shot', id: shot.id };
  announcement.value = t('已添加镜头 {number}', { number: shot.number });
}
function addElement(kind: WorkflowElementKind) {
  const element: WorkflowElement = { id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, kind, name: t('新{kind}', { kind: ELEMENT_LABELS[kind] }), description: '' };
  commit({ ...props.project, elements: [...elements.value, element] });
  filter.value = kind;
  selection.value = { kind: 'element', id: element.id };
}
function updateElement(updates: Partial<WorkflowElement>) {
  if (!selectedElement.value) return;
  commit(updateProjectElement(props.project, selectedElement.value.id, { ...selectedElement.value, ...updates }));
}
function deleteElement() {
  if (!selectedElement.value) return;
  commit(updateProjectElement(props.project, selectedElement.value.id, null));
  selection.value = null;
}
function updateShotField(updates: Partial<Shot>) {
  if (!selectedShot.value) return;
  commitShots(shots.value.map(shot => shot.id === selectedShot.value!.id ? clearShotMedia({ ...shot, ...updates }) : shot));
}
function setDuration(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isFinite(value) && value >= 0.5 && value <= 30) updateShotField({ duration: value });
}
function move(shotId: string, targetIndex: number) {
  const index = shots.value.findIndex(shot => shot.id === shotId);
  const next = moveShot(shots.value, index, targetIndex);
  if (next !== shots.value) {
    commitShots(next);
    announcement.value = t('镜头已移动到第 {position} 位', { position: targetIndex + 1 });
  }
}
function moveWithKeyboard(event: KeyboardEvent, shot: Shot) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  move(shot.id, shot.number - 1 + (event.key === 'ArrowLeft' ? -1 : 1));
}
function copyShot() {
  if (!selectedShot.value) return;
  const copy = duplicateShot(selectedShot.value, selectedShot.value.number + 1);
  const next = [...shots.value];
  next.splice(selectedShot.value.number, 0, copy);
  commitShots(next);
  selection.value = { kind: 'shot', id: copy.id };
}
function deleteShot() {
  if (!selectedShot.value) return;
  commitShots(shots.value.filter(shot => shot.id !== selectedShot.value!.id));
  selection.value = null;
}
function addElementToShot(elementId: string) {
  if (!selectedShot.value) return;
  commit(attachElement(props.project, selectedShot.value.id, elementId));
  announcement.value = t('元素已加入镜头');
}
function addElementFromSelect(value: string) {
  if (value) addElementToShot(value);
}
function detachElement(elementId: string) {
  if (!selectedShot.value) return;
  updateShotField({ elementIds: selectedShot.value.elementIds!.filter(id => id !== elementId) });
}
function startDrag(event: DragEvent, item: DragItem) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
  event.dataTransfer.effectAllowed = item.kind === 'shot' ? 'move' : 'copy';
  dragging.value = item;
}
function endDrag() { dragging.value = null; dropTarget.value = null; }
function allowDrop(event: DragEvent, target: string) {
  if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = dragging.value?.kind === 'shot' ? 'move' : 'copy';
  dropTarget.value = target;
}
function drop(event: DragEvent, shotId?: string) {
  event.preventDefault();
  endDrag();
  let item: DragItem;
  try { item = JSON.parse(event.dataTransfer?.getData(DRAG_TYPE) || ''); } catch { return; }
  if (!item || typeof item.id !== 'string') return;
  if (item.kind === 'shot') {
    move(item.id, shotId ? shots.value.findIndex(shot => shot.id === shotId) : shots.value.length - 1);
  } else if (item.kind === 'element' && elements.value.some(element => element.id === item.id)) {
    if (shotId) {
      commit(attachElement(props.project, shotId, item.id));
      selection.value = { kind: 'shot', id: shotId };
      announcement.value = t('元素已加入镜头');
    } else addShot(item.id);
  }
}
</script>
