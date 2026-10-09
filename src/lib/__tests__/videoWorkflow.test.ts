import { describe, expect, it } from 'vitest';
import {
  buildKeyframePrompt,
  buildMusicPrompt,
  buildScriptPrompt,
  buildShotListPrompt,
  buildVideoPrompt,
  calculateTotalDuration,
  createWorkflowProject,
  type Shot,
  type StyleBible,
  validateShotList,
} from '../videoWorkflow';

describe('videoWorkflow', () => {
  const styleBible: StyleBible = {
    appearance: '年轻女性，黑色长发，东亚面孔',
    wardrobe: '白色连衣裙，简约现代',
    artStyle: '电影写实风格',
    palette: '暖色调，金色阳光',
  };

  const shot: Shot = {
    id: 'shot-1',
    number: 1,
    duration: 5,
    framing: '中景',
    cameraMovement: '推进',
    sceneDescription: '女主角站在海边，微笑着看向远方',
    dialogue: '这是最美好的一天',
  };

  describe('validateShotList', () => {
    it('验证合法的镜头列表', () => {
      const input = [
        {
          duration: 5,
          sceneDescription: '开场镜头',
          framing: '远景',
          cameraMovement: '固定',
        },
        {
          duration: 3,
          sceneDescription: '特写镜头',
        },
      ];
      
      const shots = validateShotList(input);
      expect(shots).toHaveLength(2);
      expect(shots[0].number).toBe(1);
      expect(shots[0].duration).toBe(5);
      expect(shots[0].sceneDescription).toBe('开场镜头');
      expect(shots[0].framing).toBe('远景');
      expect(shots[1].number).toBe(2);
      expect(shots[1].framing).toBe('中景'); // 默认值
    });

    it('拒绝空数组', () => {
      expect(() => validateShotList([])).toThrow('不能为空');
    });

    it('拒绝非数组', () => {
      expect(() => validateShotList({ shots: [] })).toThrow('必须是数组');
    });

    it('拒绝缺少场景描述的镜头', () => {
      expect(() => validateShotList([{ duration: 5 }])).toThrow('缺少场景描述');
    });

    it('拒绝无效时长', () => {
      expect(() => validateShotList([
        { duration: 0, sceneDescription: 'test' },
      ])).toThrow('时长必须');
      
      expect(() => validateShotList([
        { duration: -1, sceneDescription: 'test' },
      ])).toThrow('时长必须');
      
      expect(() => validateShotList([
        { duration: 31, sceneDescription: 'test' },
      ])).toThrow('时长必须');
    });

    it('为镜头生成唯一 ID', () => {
      const input = [
        { duration: 5, sceneDescription: 'shot 1' },
        { duration: 3, sceneDescription: 'shot 2' },
      ];
      
      const shots = validateShotList(input);
      expect(shots[0].id).toBeTruthy();
      expect(shots[1].id).toBeTruthy();
      expect(shots[0].id).not.toBe(shots[1].id);
    });
  });

  describe('buildScriptPrompt', () => {
    it('构建编剧提示词包含必要元素', () => {
      const prompt = buildScriptPrompt('一个关于梦想的故事', 30);
      
      expect(prompt).toContain('一个关于梦想的故事');
      expect(prompt).toContain('30 秒');
      expect(prompt).toContain('styleBible');
      expect(prompt).toContain('只返回 JSON');
    });
  });

  describe('buildShotListPrompt', () => {
    it('构建分镜提示词包含脚本和风格圣经', () => {
      const prompt = buildShotListPrompt(
        '女主角在海边回忆过去',
        styleBible,
        30
      );
      
      expect(prompt).toContain('女主角在海边回忆过去');
      expect(prompt).toContain(styleBible.appearance);
      expect(prompt).toContain(styleBible.artStyle);
      expect(prompt).toContain('30 秒');
      expect(prompt).toContain('只返回 JSON 数组');
    });
  });

  describe('buildKeyframePrompt', () => {
    it('构建关键帧提示词包含场景和风格', () => {
      const prompt = buildKeyframePrompt(shot, styleBible);
      
      expect(prompt).toContain(shot.sceneDescription);
      expect(prompt).toContain(styleBible.artStyle);
      expect(prompt).toContain(styleBible.palette);
      expect(prompt).toContain(styleBible.appearance);
      expect(prompt).toContain(shot.framing);
    });
  });

  describe('buildVideoPrompt', () => {
    it('有关键帧时使用简洁描述', () => {
      const prompt = buildVideoPrompt(shot, styleBible, true);
      
      expect(prompt).toContain(shot.sceneDescription);
      expect(prompt).toContain(shot.cameraMovement);
      expect(prompt).toContain(styleBible.artStyle);
      // 应该比关键帧提示词简短
      expect(prompt.length).toBeLessThan(
        buildKeyframePrompt(shot, styleBible).length + 100
      );
    });

    it('无关键帧时使用完整描述', () => {
      const prompt = buildVideoPrompt(shot, styleBible, false);
      
      expect(prompt).toContain(shot.sceneDescription);
      expect(prompt).toContain(styleBible.appearance);
      expect(prompt).toContain(styleBible.wardrobe);
    });

    it('固定镜头不添加运动描述', () => {
      const staticShot = { ...shot, cameraMovement: '固定' };
      const prompt = buildVideoPrompt(staticShot, styleBible, true);
      
      expect(prompt).not.toContain('镜头固定');
    });
  });

  describe('buildMusicPrompt', () => {
    it('构建配乐提示词包含脚本和时长', () => {
      const prompt = buildMusicPrompt(
        '女主角在海边回忆过去的美好时光',
        styleBible,
        25
      );
      
      expect(prompt).toContain('女主角在海边');
      expect(prompt).toContain('25 秒');
      expect(prompt).toContain('纯音乐');
      expect(prompt).toContain(styleBible.artStyle);
    });
  });

  describe('calculateTotalDuration', () => {
    it('计算镜头总时长', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1, duration: 5 },
        { ...shot, id: '2', number: 2, duration: 3 },
        { ...shot, id: '3', number: 3, duration: 7 },
      ];
      
      expect(calculateTotalDuration(shots)).toBe(15);
    });

    it('空数组返回 0', () => {
      expect(calculateTotalDuration([])).toBe(0);
    });
  });

  describe('createWorkflowProject', () => {
    it('创建新项目的初始状态', () => {
      const project = createWorkflowProject('测试创意', 45);
      
      expect(project.id).toContain('workflow-');
      expect(project.title).toBe('测试创意');
      expect(project.idea).toBe('测试创意');
      expect(project.targetLength).toBe(45);
      expect(project.stage).toBe('init');
      expect(project.createdAt).toBeGreaterThan(0);
      expect(project.updatedAt).toBe(project.createdAt);
    });

    it('默认目标时长为 30 秒', () => {
      const project = createWorkflowProject('测试');
      expect(project.targetLength).toBe(30);
    });

    it('截断过长的标题', () => {
      const longIdea = 'a'.repeat(100);
      const project = createWorkflowProject(longIdea);
      expect(project.title.length).toBe(50);
    });
  });
});
