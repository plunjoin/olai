import { describe, expect, it } from 'vitest';
import { attachElement, editProjectShots, updateProjectElement } from '../workflowEditor';
import { buildKeyframePrompt, buildScriptPrompt, buildShotListPrompt, buildVideoPrompt, createEmptyShot, createWorkflowProject, moveShot, validateShotList, type VideoWorkflowProject, type WorkflowElement } from '../videoWorkflow';

const character: WorkflowElement = { id: 'girl', kind: 'character', name: '小雨', description: '短发，黄色雨衣' };
const scene: WorkflowElement = { id: 'street', kind: 'scene', name: '老街', description: '雨后霓虹倒影' };
function fixture(): VideoWorkflowProject {
  return {
    ...createWorkflowProject('寻找未来的信'),
    elements: [character, scene], stage: 'complete', finalVideoStatus: 'completed', finalVideoUrl: 'old-final',
    styleBible: { appearance: '短发', wardrobe: '雨衣', artStyle: '写实', palette: '暖色' },
    shots: [1, 2].map(number => ({ ...createEmptyShot(number), id: `shot-${number}`, sceneDescription: `画面 ${number}`, elementIds: number === 1 ? ['girl'] : [], keyframeStatus: 'completed', keyframeUrl: 'old-frame', videoStatus: 'completed', videoUrl: 'old-video' })),
  };
}

describe('workflow editor', () => {
  it('attaches reusable elements without duplicates and invalidates affected media', () => {
    const project = fixture();
    const next = attachElement(project, 'shot-2', 'girl');
    expect(next.shots![1].elementIds).toEqual(['girl']);
    expect(next.shots![1].videoStatus).toBeUndefined();
    expect(next.shots![0].videoStatus).toBe('completed');
    expect(next.finalVideoUrl).toBeUndefined();
    expect(next.stage).toBe('shotlist');
    expect(attachElement(next, 'shot-2', 'girl')).toBe(next);
    expect(attachElement(next, 'missing', 'girl')).toBe(next);
    expect(attachElement(next, 'shot-2', 'missing')).toBe(next);
  });

  it('editing a shared setting invalidates only referencing shots; deletion removes references', () => {
    const project = fixture();
    const updated = updateProjectElement(project, 'girl', { ...character, description: '红色雨衣' });
    expect(updated.shots![0].keyframeStatus).toBeUndefined();
    expect(updated.shots![1].keyframeStatus).toBe('completed');
    expect(project.shots![0].keyframeStatus).toBe('completed');
    const deleted = updateProjectElement(updated, 'girl', null);
    expect(deleted.elements).toEqual([scene]);
    expect(deleted.shots![0].elementIds).toEqual([]);
  });

  it('reordering keeps reusable clips but discards obsolete assembly', () => {
    const project = fixture();
    const next = editProjectShots(project, moveShot(project.shots!, 0, 1));
    expect(next.shots!.map(shot => shot.id)).toEqual(['shot-2', 'shot-1']);
    expect(next.shots!.map(shot => shot.number)).toEqual([1, 2]);
    expect(next.shots![1].videoUrl).toBe('old-video');
    expect(next.finalVideoStatus).toBeUndefined();
  });

  it('supports manual creation and older projects without elements', () => {
    const project = createWorkflowProject('手工故事');
    delete project.elements;
    const next = editProjectShots(project, [createEmptyShot(1)]);
    expect(next.script).toBe('手工故事');
    expect(next.styleBible?.artStyle).toBeTruthy();
    expect(buildKeyframePrompt(next.shots![0], next.styleBible!)).not.toContain('undefined');
  });

  it('uses all project settings for planning and only assigned elements for each generation', () => {
    const project = fixture();
    for (const prompt of [buildScriptPrompt(project.idea, 30, project.elements), buildShotListPrompt(project.idea, project.styleBible!, 30, project.elements)]) {
      expect(prompt).toContain(character.description);
      expect(prompt).toContain(scene.description);
    }
    for (const prompt of [buildKeyframePrompt(project.shots![0], project.styleBible!, project.elements), buildVideoPrompt(project.shots![0], project.styleBible!, true, project.elements), buildVideoPrompt(project.shots![0], project.styleBible!, false, project.elements)]) {
      expect(prompt).toContain(character.description);
      expect(prompt).not.toContain(scene.description);
    }
  });

  it('accepts known element references from AI planning and rejects unknown or duplicate IDs', () => {
    const shots = validateShotList([{ duration: 4, sceneDescription: '老街', elementIds: ['girl', 'girl', 'invented', 42] }], [character]);
    expect(shots[0].elementIds).toEqual(['girl']);
  });
});
