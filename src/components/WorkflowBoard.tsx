import { useState, type DragEvent } from 'react';
import { ArrowLeft, ArrowRight, Box, Check, Copy, Film, GripVertical, Layers, MapPin, Plus, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react';
import { calculateTotalDuration, createEmptyShot, duplicateShot, ELEMENT_LABELS, moveShot, type Shot, type VideoWorkflowProject, type WorkflowElement, type WorkflowElementKind } from '../lib/videoWorkflow';
import { attachElement, clearShotMedia, editProjectShots, updateProjectElement } from '../lib/workflowEditor';
import { t } from '../lib/i18n';
import '../styles/workflow.css';

const ICONS = { character: UserRound, scene: MapPin, prop: Box };
const DRAG_TYPE = 'application/x-olai-workflow';
type DragItem = { kind: 'shot' | 'element'; id: string };
type Selection = { kind: 'shot' | 'element'; id: string } | null;

export default function WorkflowBoard({ project, onChange }: {
  project: VideoWorkflowProject;
  onChange: (project: VideoWorkflowProject) => void;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [filter, setFilter] = useState<WorkflowElementKind>('character');
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const shots = project.shots || [];
  const elements = project.elements || [];
  const selectedShot = selection?.kind === 'shot' ? shots.find(shot => shot.id === selection.id) : undefined;
  const selectedElement = selection?.kind === 'element' ? elements.find(element => element.id === selection.id) : undefined;

  function commitShots(next: Shot[]) { onChange(editProjectShots(project, next)); }
  function addShot(elementId?: string) {
    const shot = createEmptyShot(shots.length + 1);
    if (elementId) shot.elementIds = [elementId];
    commitShots([...shots, shot]);
    setSelection({ kind: 'shot', id: shot.id });
    setAnnouncement(t('已添加镜头 {number}', { number: shot.number }));
  }
  function addElement(kind: WorkflowElementKind) {
    const element: WorkflowElement = { id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, kind, name: t('新{kind}', { kind: ELEMENT_LABELS[kind] }), description: '' };
    onChange({ ...project, elements: [...elements, element] });
    setFilter(kind);
    setSelection({ kind: 'element', id: element.id });
  }
  function updateShot(updates: Partial<Shot>) {
    if (!selectedShot) return;
    commitShots(shots.map(shot => shot.id === selectedShot.id ? clearShotMedia({ ...shot, ...updates }) : shot));
  }
  function move(shotId: string, targetIndex: number) {
    const index = shots.findIndex(shot => shot.id === shotId);
    const next = moveShot(shots, index, targetIndex);
    if (next !== shots) {
      commitShots(next);
      setAnnouncement(t('镜头已移动到第 {position} 位', { position: targetIndex + 1 }));
    }
  }
  function startDrag(event: DragEvent, item: DragItem) {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
    event.dataTransfer.effectAllowed = item.kind === 'shot' ? 'move' : 'copy';
    setDragging(item);
  }
  function endDrag() { setDragging(null); setDropTarget(null); }
  function allowDrop(event: DragEvent, target: string) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragging?.kind === 'shot' ? 'move' : 'copy';
    setDropTarget(target);
  }
  function drop(event: DragEvent, shotId?: string) {
    event.preventDefault();
    endDrag();
    let item: DragItem;
    try { item = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)); } catch { return; }
    if (!item || typeof item.id !== 'string') return;
    if (item.kind === 'shot') {
      move(item.id, shotId ? shots.findIndex(shot => shot.id === shotId) : shots.length - 1);
    } else if (item.kind === 'element' && elements.some(element => element.id === item.id)) {
      if (shotId) {
        onChange(attachElement(project, shotId, item.id));
        setSelection({ kind: 'shot', id: shotId });
        setAnnouncement(t('元素已加入镜头'));
      } else addShot(item.id);
    }
  }

  return (
    <section className="wf-editor" aria-label={t('短片分镜编辑器')}>
      <div className="wf-editor-bar"><span><Layers size={17} /> {t('创作工作台')}</span><span className="wf-muted">{t('拖入元素，让故事成形')}</span></div>
      <div className="wf-editor-layout">
        <aside className="wf-elements" aria-label={t('元素库')}>
          <div className="wf-panel-title"><h3>{t('元素库')}</h3><span>{elements.length}</span></div>
          <div className="wf-element-tabs" aria-label={t('元素分类')}>
            {(Object.keys(ELEMENT_LABELS) as WorkflowElementKind[]).map(kind => {
              const Icon = ICONS[kind];
              return <button key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)}><Icon size={15} />{ELEMENT_LABELS[kind]}</button>;
            })}
          </div>
          <p className="wf-hint">{t('拖到镜头里复用，也可选中镜头后点击 ＋')}</p>
          <div className="wf-element-list">
            {elements.filter(element => element.kind === filter).map(element => {
              const Icon = ICONS[element.kind];
              return <div key={element.id} className={`wf-element-card ${selectedElement?.id === element.id ? 'is-selected' : ''}`} draggable onDragStart={event => startDrag(event, { kind: 'element', id: element.id })} onDragEnd={endDrag}>
                <button className="wf-element-main" onClick={() => setSelection({ kind: 'element', id: element.id })} aria-label={t('编辑{kind}：{name}', { kind: ELEMENT_LABELS[element.kind], name: element.name })}>
                  <span className={`wf-element-icon ${element.kind}`}><Icon size={21} /></span>
                  <span><strong>{element.name}</strong><small>{element.description || t('点击完善设定')}</small></span>
                </button>
                <button className="wf-icon-button" disabled={!selectedShot} title={selectedShot ? t('加入选中镜头') : t('先选择一个镜头')} aria-label={t('将{name}加入选中镜头', { name: element.name })} onClick={() => { if (selectedShot) { onChange(attachElement(project, selectedShot.id, element.id)); setAnnouncement(t('元素已加入镜头')); } }}><Plus size={15} /></button>
              </div>;
            })}
            {!elements.some(element => element.kind === filter) && <div className="wf-element-empty">{t('还没有{kind}', { kind: ELEMENT_LABELS[filter] })}<br /><span>{t('创建专属于这个故事的设定')}</span></div>}
          </div>
          <button className="wf-add-element" onClick={() => addElement(filter)}><Plus size={16} />{t('新建{kind}', { kind: ELEMENT_LABELS[filter] })}</button>
          <div className="wf-library-note"><Check size={15} /><span>{t('同一元素可用于多个镜头，修改设定会同步应用。')}</span></div>
        </aside>

        <div className="wf-board">
          <div className="wf-board-heading"><div><h3>{t('分镜画布')} <span>{t('{count} 个镜头', { count: shots.length })}</span></h3><p>{t('拖动镜头调整顺序 · 拖入人物、场景与道具')}</p></div><button className="wf-small-button" onClick={() => addShot()}><Plus size={15} />{t('添加镜头')}</button></div>
          <div className="wf-shot-grid">
            {shots.map(shot => (
              <article key={shot.id} className={`wf-shot ${selectedShot?.id === shot.id ? 'is-selected' : ''} ${dropTarget === shot.id ? 'is-drop-target' : ''} ${dragging?.id === shot.id ? 'is-dragging' : ''}`} onDragOver={event => allowDrop(event, shot.id)} onDragLeave={() => setDropTarget(null)} onDrop={event => drop(event, shot.id)}>
                <div className="wf-shot-top"><button className="wf-drag-handle" draggable onDragStart={event => startDrag(event, { kind: 'shot', id: shot.id })} onDragEnd={endDrag} title={t('拖动排序；也可用左右方向键移动')} aria-label={t('移动镜头 {number}', { number: shot.number })} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(shot.id, shot.number - 1 + (event.key === 'ArrowLeft' ? -1 : 1)); } }}><GripVertical size={16} /><span>{t('镜头 {number}', { number: String(shot.number).padStart(2, '0') })}</span></button><span>{shot.duration}s</span></div>
                <button className="wf-shot-body" onClick={() => setSelection({ kind: 'shot', id: shot.id })} aria-label={t('编辑镜头 {number}', { number: shot.number })}>
                  <div className="wf-shot-preview">{shot.keyframeUrl ? <img src={shot.keyframeUrl} alt={t('镜头 {number} 关键帧', { number: shot.number })} draggable={false} /> : <><Film size={28} /><span>{shot.framing} · {shot.cameraMovement}</span></>}</div>
                  <p>{shot.sceneDescription || t('点击填写这个镜头的故事…')}</p>
                  <div className="wf-shot-tags">{elements.filter(element => shot.elementIds?.includes(element.id)).map(element => { const Icon = ICONS[element.kind]; return <span key={element.id} className={element.kind}><Icon size={12} />{element.name}</span>; })}{!shot.elementIds?.length && <span className="wf-drop-hint">{t('＋ 拖入创作元素')}</span>}</div>
                </button>
              </article>
            ))}
            <button className={`wf-new-shot ${dropTarget === 'new' ? 'is-drop-target' : ''}`} onClick={() => addShot()} onDragOver={event => allowDrop(event, 'new')} onDragLeave={() => setDropTarget(null)} onDrop={event => drop(event)}><Plus size={26} /><strong>{shots.length ? t('添加下一个镜头') : t('从第一个镜头开始')}</strong><span>{t('点击创建，或把元素拖到这里')}</span></button>
          </div>
          <div className="wf-timeline"><div className="wf-timeline-title"><span><Film size={14} />{t('故事时间线')}</span><span>{t('{current}s / 目标 {target}s', { current: calculateTotalDuration(shots), target: project.targetLength || 30 })}</span></div><div className="wf-timeline-track">
            {shots.length ? shots.map(shot => <button key={shot.id} style={{ flexGrow: shot.duration }} className={selectedShot?.id === shot.id ? 'is-selected' : ''} onClick={() => setSelection({ kind: 'shot', id: shot.id })} title={t('镜头 {number} · {duration} 秒', { number: shot.number, duration: shot.duration })}>{String(shot.number).padStart(2, '0')}<small>{shot.duration}s</small></button>) : <p>{t('添加镜头后，在这里查看故事节奏')}</p>}
          </div></div>
        </div>

        <aside className="wf-inspector" aria-label={t('属性编辑')}>
          <div className="wf-panel-title"><h3><SlidersHorizontal size={16} />{selectedElement ? t('{kind}设定', { kind: ELEMENT_LABELS[selectedElement.kind] }) : t('镜头属性')}</h3>{selection && <button className="wf-icon-button" onClick={() => setSelection(null)} aria-label={t('关闭属性编辑')}><X size={15} /></button>}</div>
          {selectedElement ? <div className="wf-fields" key={selectedElement.id}>
            <label>{t('名称')}<input maxLength={60} value={selectedElement.name} onChange={event => onChange(updateProjectElement(project, selectedElement.id, { ...selectedElement, name: event.target.value }))} /></label>
            <label>{t('详细设定')}<textarea rows={7} value={selectedElement.description} onChange={event => onChange(updateProjectElement(project, selectedElement.id, { ...selectedElement, description: event.target.value }))} placeholder={selectedElement.kind === 'character' ? t('外貌、发型、服装、性格，例如：短发女孩，穿黄色雨衣，勇敢好奇…') : selectedElement.kind === 'scene' ? t('地点、时间、光线、氛围，例如：雨后的老街，傍晚，霓虹倒映在水面…') : t('外观、材质、颜色、用途，例如：一台银色复古相机，皮质肩带…')} /></label>
            <p className="wf-hint">{t('设定将用于关联镜头的关键帧和视频生成。')}</p>
            <button className="wf-danger-button" onClick={() => { onChange(updateProjectElement(project, selectedElement.id, null)); setSelection(null); }}><Trash2 size={14} />{t('删除元素')}</button>
          </div> : selectedShot ? <div className="wf-fields" key={selectedShot.id}>
            <div className="wf-selection-heading"><strong>{t('镜头 {number}', { number: String(selectedShot.number).padStart(2, '0') })}</strong><span>{selectedShot.videoStatus === 'completed' ? t('视频已就绪') : selectedShot.keyframeStatus === 'completed' ? t('关键帧已就绪') : t('待生成')}</span></div>
            <div className="wf-shot-tools"><button disabled={selectedShot.number === 1} onClick={() => move(selectedShot.id, selectedShot.number - 2)} aria-label={t('镜头前移')}><ArrowLeft size={15} /></button><button disabled={selectedShot.number === shots.length} onClick={() => move(selectedShot.id, selectedShot.number)} aria-label={t('镜头后移')}><ArrowRight size={15} /></button><button onClick={() => { const copy = duplicateShot(selectedShot, selectedShot.number + 1); const next = [...shots]; next.splice(selectedShot.number, 0, copy); commitShots(next); setSelection({ kind: 'shot', id: copy.id }); }} aria-label={t('复制镜头')}><Copy size={15} /></button><button onClick={() => { commitShots(shots.filter(shot => shot.id !== selectedShot.id)); setSelection(null); }} aria-label={t('删除镜头')}><Trash2 size={15} /></button></div>
            <label>{t('时长（秒）')}<input type="number" min={0.5} max={30} step={0.5} value={selectedShot.duration} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0.5 && value <= 30) updateShot({ duration: value }); }} /></label>
            <div className="wf-field-pair"><label>{t('景别')}<input value={selectedShot.framing} onChange={event => updateShot({ framing: event.target.value })} /></label><label>{t('运镜')}<input value={selectedShot.cameraMovement} onChange={event => updateShot({ cameraMovement: event.target.value })} /></label></div>
            <label>{t('画面描述')}<textarea rows={4} value={selectedShot.sceneDescription} onChange={event => updateShot({ sceneDescription: event.target.value })} placeholder={t('描述人物动作、故事情节与画面…')} /></label>
            <div className="wf-linked-elements"><span>{t('镜头元素')}</span>{elements.filter(element => selectedShot.elementIds?.includes(element.id)).map(element => <div key={element.id}><span>{ELEMENT_LABELS[element.kind]} · {element.name}</span><button className="wf-icon-button" aria-label={t('移除{name}', { name: element.name })} onClick={() => updateShot({ elementIds: selectedShot.elementIds!.filter(id => id !== element.id) })}><X size={13} /></button></div>)}<select aria-label={t('添加镜头元素')} value="" onChange={event => { if (event.target.value) onChange(attachElement(project, selectedShot.id, event.target.value)); }}><option value="">{t('＋ 选择人物 / 场景 / 道具')}</option>{elements.filter(element => !selectedShot.elementIds?.includes(element.id)).map(element => <option key={element.id} value={element.id}>{ELEMENT_LABELS[element.kind]} · {element.name}</option>)}</select></div>
            <label>{t('对白 / 旁白')}<textarea rows={2} value={selectedShot.dialogue || ''} onChange={event => updateShot({ dialogue: event.target.value })} placeholder={t('这个镜头中说的话…')} /></label>
            <label>{t('音效备注')}<input value={selectedShot.soundNotes || ''} onChange={event => updateShot({ soundNotes: event.target.value })} placeholder={t('雨声、脚步声…')} /></label>
          </div> : <div className="wf-inspector-empty"><SlidersHorizontal size={30} /><strong>{t('每个细节，都由你定义')}</strong><p>{t('选中镜头编辑画面与运镜，')}<br />{t('或点击元素完善人物和场景。')}</p></div>}
        </aside>
      </div>
      <div className="wf-sr-only" role="status" aria-live="polite">{announcement}</div>
    </section>
  );
}
