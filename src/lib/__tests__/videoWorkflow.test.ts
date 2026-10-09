import { describe, expect, it } from 'vitest';
import {
  addShot,
  buildKeyframePrompt,
  buildMusicPrompt,
  buildScriptPrompt,
  buildShotListPrompt,
  buildVideoPrompt,
  calculateTotalDuration,
  createWorkflowProject,
  duplicateShot,
  moveShot,
  parseRetryAfter,
  planContinuousShots,
  removeShot,
  type Shot,
  type StyleBible,
  updateShot,
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

  describe('shot editing operations', () => {
    it('添加镜头并重新编号', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1 },
        { ...shot, id: '2', number: 2 },
      ];
      
      const result = addShot(shots, 0); // 在第一个镜头后添加
      expect(result).toHaveLength(3);
      expect(result[1].number).toBe(2);
      expect(result[2].number).toBe(3);
    });

    it('删除镜头并重新编号', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1 },
        { ...shot, id: '2', number: 2 },
        { ...shot, id: '3', number: 3 },
      ];
      
      const result = removeShot(shots, '2');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('3');
      expect(result[1].number).toBe(2); // 重新编号
    });

    it('移动镜头并重新编号', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1 },
        { ...shot, id: '2', number: 2 },
        { ...shot, id: '3', number: 3 },
      ];
      
      const result = moveShot(shots, 0, 2); // 把第一个移到最后
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('3');
      expect(result[2].id).toBe('1');
      expect(result.map(s => s.number)).toEqual([1, 2, 3]);
    });

    it('复制镜头清除生成内容', () => {
      const original: Shot = {
        ...shot,
        id: '1',
        number: 1,
        keyframeUrl: 'http://example.com/keyframe.jpg',
        keyframeStatus: 'completed',
        videoUrl: 'http://example.com/video.mp4',
        videoStatus: 'completed',
      };
      
      const duplicate = duplicateShot(original, 2);
      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.number).toBe(2);
      expect(duplicate.sceneDescription).toBe(original.sceneDescription);
      expect(duplicate.keyframeUrl).toBeUndefined();
      expect(duplicate.videoUrl).toBeUndefined();
    });

    it('更新镜头字段', () => {
      const updated = updateShot(shot, {
        duration: 8,
        sceneDescription: '新描述',
      });
      
      expect(updated.duration).toBe(8);
      expect(updated.sceneDescription).toBe('新描述');
      expect(updated.framing).toBe(shot.framing); // 未改变的字段保持
    });
  });

  describe('planContinuousShots', () => {
    it('将镜头分段到 30 秒以内', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1, duration: 15 },
        { ...shot, id: '2', number: 2, duration: 10 },
        { ...shot, id: '3', number: 3, duration: 12 },
        { ...shot, id: '4', number: 4, duration: 8 },
      ];
      
      const { segments, totalGenerations } = planContinuousShots(shots, 30);
      
      // 第一段: 15 + 10 = 25s
      // 第二段: 12 + 8 = 20s
      expect(segments).toHaveLength(2);
      expect(segments[0]).toHaveLength(2);
      expect(segments[1]).toHaveLength(2);
      
      // 第一段需要 3 次生成（25 / 10 = 2.5 -> 3）
      // 第二段需要 2 次生成（20 / 10 = 2）
      expect(totalGenerations).toBe(5);
    });

    it('单个超长镜头独立成段', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1, duration: 35 },
        { ...shot, id: '2', number: 2, duration: 5 },
      ];
      
      const { segments } = planContinuousShots(shots, 30);
      
      expect(segments).toHaveLength(2);
      expect(segments[0][0].id).toBe('1');
      expect(segments[1][0].id).toBe('2');
    });

    it('计算生成次数向上取整', () => {
      const shots: Shot[] = [
        { ...shot, id: '1', number: 1, duration: 9 },
        { ...shot, id: '2', number: 2, duration: 9 },
        { ...shot, id: '3', number: 3, duration: 9 },
      ];
      
      const { totalGenerations } = planContinuousShots(shots, 30);
      
      // 27 秒 / 10 = 2.7 -> 3 次
      expect(totalGenerations).toBe(3);
    });
  });

  describe('parseRetryAfter', () => {
    it('解析秒数', () => {
      expect(parseRetryAfter('60')).toBe(60);
      expect(parseRetryAfter('3600')).toBe(3600);
    });

    it('解析 HTTP 日期', () => {
      const future = new Date(Date.now() + 120000); // 2 分钟后
      const retryAfter = future.toUTCString();
      const result = parseRetryAfter(retryAfter);
      
      expect(result).toBeGreaterThan(100);
      expect(result).toBeLessThan(130);
    });

    it('返回 null 当无法解析', () => {
      expect(parseRetryAfter(null)).toBeNull();
      expect(parseRetryAfter('')).toBeNull();
      expect(parseRetryAfter('invalid')).toBeNull();
    });
  });
});
