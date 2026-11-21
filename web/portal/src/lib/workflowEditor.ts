import { duplicateShot, type Shot, type VideoWorkflowProject, type WorkflowElement } from './videoWorkflow';

export function clearShotMedia(shot: Shot): Shot {
  return { ...duplicateShot(shot, shot.number), id: shot.id };
}

// Any timeline edit makes an existing assembly obsolete. Unchanged shots remain reusable.
export function editProjectShots(project: VideoWorkflowProject, shots: Shot[]): VideoWorkflowProject {
  return {
    ...project,
    shots: shots.map((shot, index) => ({ ...shot, number: index + 1 })),
    stage: 'shotlist',
    script: project.script || project.idea,
    styleBible: project.styleBible || { appearance: '遵循镜头中的人物设定', wardrobe: '遵循人物设定', artStyle: '电影写实', palette: '自然色调' },
    finalVideoBlob: undefined, finalVideoUrl: undefined, finalVideoStatus: undefined, finalVideoError: undefined,
  };
}

export function attachElement(project: VideoWorkflowProject, shotId: string, elementId: string): VideoWorkflowProject {
  if (!project.elements?.some(element => element.id === elementId)) return project;
  const shot = project.shots?.find(item => item.id === shotId);
  if (!shot || shot.elementIds?.includes(elementId)) return project;
  return editProjectShots(project, project.shots!.map(item => item.id === shotId
    ? clearShotMedia({ ...item, elementIds: [...(item.elementIds || []), elementId] }) : item));
}

export function updateProjectElement(project: VideoWorkflowProject, elementId: string, value: WorkflowElement | null): VideoWorkflowProject {
  const elements = (project.elements || []).flatMap(element => element.id === elementId ? (value ? [value] : []) : [element]);
  const affected = project.shots?.some(shot => shot.elementIds?.includes(elementId));
  if (!affected) return { ...project, elements };
  const shots = project.shots!.map(shot => shot.elementIds?.includes(elementId)
    ? clearShotMedia({ ...shot, elementIds: value ? shot.elementIds : shot.elementIds.filter(id => id !== elementId) }) : shot);
  return editProjectShots({ ...project, elements }, shots);
}
