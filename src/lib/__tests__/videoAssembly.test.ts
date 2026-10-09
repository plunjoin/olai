import { describe, expect, it } from 'vitest';
import { generateSRT, planAssembly, type Shot } from '../videoAssembly';

describe('videoAssembly', () => {
  const createShot = (id: number, duration: number, dialogue?: string): Shot => ({
    id: `shot-${id}`,
    number: id,
    duration,
    framing: '中景',
    cameraMovement: '固定',
    sceneDescription: `场景 ${id}`,
    dialogue,
    videoBlob: new Blob(['fake'], { type: 'video/mp4' }),
    videoStatus: 'completed',
  });

  describe('generateSRT', () => {
    it('生成带对白的字幕', () => {
      const shots: Shot[] = [
        createShot(1, 5, '第一句对白'),
        createShot(2, 3, '第二句对白'),
      ];
      
      const srt = generateSRT(shots);
      
      expect(srt).toContain('1\n00:00:00,000 --> 00:00:05,000\n第一句对白');
      expect(srt).toContain('2\n00:00:05,000 --> 00:00:08,000\n第二句对白');
    });

    it('跳过没有对白的镜头', () => {
      const shots: Shot[] = [
        createShot(1, 5, '有对白'),
        createShot(2, 3), // 无对白
        createShot(3, 4, '又有对白了'),
      ];
      
      const srt = generateSRT(shots);
      
      expect(srt).toContain('1\n00:00:00,000 --> 00:00:05,000\n有对白');
      expect(srt).toContain('2\n00:00:08,000 --> 00:00:12,000\n又有对白了');
      expect(srt).not.toContain('场景 2');
    });

    it('处理空镜头列表', () => {
      expect(generateSRT([])).toBe('');
    });

    it('正确计算累计时间', () => {
      const shots: Shot[] = [
        createShot(1, 2.5, '开始'),
        createShot(2, 3.7, '中间'),
        createShot(3, 1.8, '结束'),
      ];
      
      const srt = generateSRT(shots);
      
      expect(srt).toContain('00:00:00,000 --> 00:00:02,500');
      expect(srt).toContain('00:00:02,500 --> 00:00:06,200');
      expect(srt).toContain('00:00:06,200 --> 00:00:08,000');
    });

    it('格式化毫秒', () => {
      const shots: Shot[] = [
        createShot(1, 1.234, '测试'),
      ];
      
      const srt = generateSRT(shots);
      expect(srt).toContain('00:00:01,234');
    });
  });

  describe('planAssembly', () => {
    it('计算总时长和镜头数', () => {
      const shots: Shot[] = [
        createShot(1, 5),
        createShot(2, 3),
        createShot(3, 4),
      ];
      
      const plan = planAssembly({
        shots,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan.totalDuration).toBe(12);
      expect(plan.shotCount).toBe(3);
    });

    it('计算音乐裁剪时长和淡出', () => {
      const shots: Shot[] = [
        createShot(1, 10),
        createShot(2, 10),
      ];
      
      const musicBlob = new Blob(['fake'], { type: 'audio/mpeg' });
      
      // 音乐比视频长，需要裁剪和淡出
      const plan1 = planAssembly({
        shots,
        musicBlob,
        musicDuration: 180,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan1.musicTrimDuration).toBe(20);
      expect(plan1.needsMusicFade).toBe(true);
      
      // 音乐比视频短，不需要淡出
      const plan2 = planAssembly({
        shots,
        musicBlob,
        musicDuration: 15,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan2.musicTrimDuration).toBe(15);
      expect(plan2.needsMusicFade).toBe(false);
    });

    it('设置目标分辨率', () => {
      const shots: Shot[] = [createShot(1, 5)];
      
      const plan720 = planAssembly({
        shots,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan720.targetWidth).toBe(1280);
      expect(plan720.targetHeight).toBe(720);
      
      const plan1080 = planAssembly({
        shots,
        targetResolution: '1080p',
        targetFPS: 30,
      });
      
      expect(plan1080.targetWidth).toBe(1920);
      expect(plan1080.targetHeight).toBe(1080);
    });

    it('生成字幕文本', () => {
      const shots: Shot[] = [
        createShot(1, 5, '第一句'),
        createShot(2, 3, '第二句'),
      ];
      
      const plan = planAssembly({
        shots,
        includeSubtitles: true,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan.hasSubtitles).toBe(true);
      expect(plan.subtitleText).toContain('第一句');
      expect(plan.subtitleText).toContain('第二句');
    });

    it('只计算已完成的镜头', () => {
      const shots: Shot[] = [
        createShot(1, 5),
        { ...createShot(2, 3), videoStatus: 'pending' as const },
        { ...createShot(3, 4), videoStatus: 'failed' as const },
        createShot(4, 2),
      ];
      
      const plan = planAssembly({
        shots,
        targetResolution: '720p',
        targetFPS: 30,
      });
      
      expect(plan.shotCount).toBe(2); // 只有 1 和 4 完成
    });

    it('默认值', () => {
      const shots: Shot[] = [createShot(1, 5)];
      
      const plan = planAssembly({ shots });
      
      expect(plan.targetWidth).toBe(1280);
      expect(plan.targetHeight).toBe(720);
      expect(plan.targetFPS).toBe(30);
      expect(plan.hasSubtitles).toBe(false);
      expect(plan.needsMusicFade).toBe(false);
    });
  });
});
