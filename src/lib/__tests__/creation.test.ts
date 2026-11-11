import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageDimensions, normalizeRatio } from '../generation';
import { composeSong, newSong, parseSong, songLyrics, sungLines } from '../music';
import { songPrompt } from '../server/songPrompt';
import { buildGeneration, InputError } from '../server/generation';
import { SERVER_MODELS, serverModel } from '../server/aiConfig';
import { base64Blob, consumeSSE, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, videoContent } from '../api';
import { DEFAULT_SETTINGS } from '../types';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('creation configuration and public request contracts', () => {
  it('reads native media responses without requiring text output', () => {
    expect(mediaOutputs({ choices: [{ message: { images: [{ image_url: { url: 'https://example.com/photo.png' } }] } }] }, 'image')[0].url).toBe('https://example.com/photo.png');
    expect(mediaOutputs({ choices: [{ message: { audio: { data: 'AQID', format: 'mp3' } } }] }, 'music')[0]).toEqual({ base64: 'AQID', mime: 'audio/mpeg' });
    expect(mediaOutputs({ choices: [{ message: { content: '![video](data:video/mp4;base64,AQID)' } }] }, 'video')[0]).toEqual({ base64: 'AQID', mime: 'video/mp4' });
  });
  it('sends structured image preferences, never a provider request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetchMock);
    await generateImage({ prompt: 'Flowers', aspectRatio: '2.35:1', imageSize: '4K', reasoningEffort: 'minimal' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate/image');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: 'Flowers', aspectRatio: '2.35:1', imageSize: '4K', reasoningEffort: 'minimal' });
    expect(fetchMock.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });
  it('sends structured song and duration instead of a private music prompt', async () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetchMock);
    await generateAudio({ prompt: '夏天', song, duration: 180 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate/music');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: '夏天', song, duration: 180 });
  });
  it('sends video options and a base64 reference through the public video route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetchMock);
    const options = { aspect_ratio: '9:16', seconds: 8, resolution: '4K', reasoning_effort: 'high' };
    await generateVideo({ prompt: 'flowers', options, inputImage: new Blob([new Uint8Array([1, 2, 3])]), extendFrom: 'job_previous' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate/video');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: 'flowers', options, inputReference: 'AQID', extendFrom: 'job_previous' });
  });
  it('reads only generated video content from Interactions steps', () => {
    expect(mediaOutputs({ steps: [{ type: 'user_input', content: [{ type: 'video', data: 'reference', mime_type: 'video/mp4' }] }, { type: 'model_output', content: [{ type: 'video', data: 'AQID', mime_type: 'video/mp4' }] }] }, 'video')).toEqual([{ base64: 'AQID', url: undefined, mime: 'video/mp4' }]);
  });
  it('does not treat chat text or an image as a generated video', () => {
    expect(mediaOutputs({ choices: [{ message: { content: '这里是视频的创作建议。' } }] }, 'video')).toEqual([]);
    expect(mediaOutputs({ choices: [{ message: { content: '![image](data:image/png;base64,AQID)' } }] }, 'video')).toEqual([]);
  });
  it('keeps internal model identifiers out of visible service errors', () => {
    expect(publicServiceError('Model lyria-3.5 unavailable')).not.toContain('lyria');
    expect(publicServiceError('每日额度不足')).toBe('上游创作服务额度已用完或请求受限，请稍后重试。');
    expect(publicServiceError('网络连接失败')).toBe('网络连接失败');
  });
  it('does not put credentials, engine identifiers or private presets in client defaults', () => {
    for (const field of ['key', 'apiKey', 'chatModel', 'imageModel', 'musicModel', 'videoModel', 'systemPrompt']) expect(DEFAULT_SETTINGS).not.toHaveProperty(field);
    for (const model of Object.values(SERVER_MODELS)) expect(JSON.stringify(DEFAULT_SETTINGS)).not.toContain(model);
  });
  it('preserves auto composition and accepts positive custom ratios', () => {
    expect(imageDimensions('auto', '4K')).toBeUndefined();
    expect(normalizeRatio(' 2.35：1 ')).toBe('2.35:1');
    expect(imageDimensions('16:9', '4K')).toBe('4096x2304');
    expect(() => normalizeRatio('0:1')).toThrow();
    expect(() => normalizeRatio('-1:2')).toThrow();
    expect(() => normalizeRatio('wide')).toThrow();
  });
  it('does not retry failed public music generation through a provider endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"每日额度不足"}}', { status: 502 })); vi.stubGlobal('fetch', fetchMock);
    await expect(generateAudio({ prompt: 'a song' })).rejects.toThrow('上游创作服务额度已用完或请求受限');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate/music');
  });
  it('packages Markdown PCM output as WAV using the returned sample rate', async () => {
    const [output] = mediaOutputs({ choices: [{ message: { content: '![media](data:audio/pcm;rate=48000;base64,AAECAw==)' } }] }, 'music');
    const blob = base64Blob(output.base64!, output.mime);
    const header = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav'); expect(blob.size).toBe(48);
    expect(header.getUint32(24, true)).toBe(48000); expect(header.getUint32(40, true)).toBe(4);
  });
  it('downloads video using same-origin authentication and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } })); vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect((await videoContent('job_abc123', signal)).type).toBe('video/mp4');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/videos/job_abc123/content');
    expect(fetchMock.mock.calls[0][1].headers.has('Authorization')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', signal });
  });
  it('retains a 409 content status and rejects JSON masquerading as a video', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 409 })).mockResolvedValueOnce(Response.json({ error: 'no video' })); vi.stubGlobal('fetch', fetchMock);
    await expect(videoContent('job_abc123')).rejects.toMatchObject({ status: 409 });
    await expect(videoContent('job_abc123')).rejects.toThrow('服务未返回可播放的视频文件');
  });
  it('handles split UTF-8 SSE content and the documented error marker', async () => {
    const makeStream = (deltas: string[]) => {
      const bytes = new TextEncoder().encode(deltas.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
      return new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    };
    const text: string[] = [];
    await consumeSSE(makeStream(['你好', '世界']), value => text.push(value)); expect(text.join('')).toBe('你好世界');
    await expect(consumeSSE(makeStream(['[Err', 'or] 每日额度不足']), () => {})).rejects.toThrow('上游创作服务额度已用完或请求受限');
  });
});

describe('server generation builders', () => {
  it('normalizes Veo sizes and forces 8 seconds for 4K, ignoring arbitrary size fields', () => {
    vi.stubEnv('AI_VIDEO_MODEL', 'veo-3.1-fast-generate-preview');
    const built = buildGeneration('generate/video', { prompt: 'flowers', options: { aspect_ratio: '9:16', seconds: 4, resolution: '4K', reasoning_effort: 'high', size: 'fake-size' } });
    expect(built).toEqual({ kind: 'video', path: 'videos', payload: { model: serverModel('video'), prompt: 'flowers\n创意丰富程度：high。', size: '2160x3840', seconds: 8 } });
    for (const [ratio, resolution, seconds, size] of [['16:9', '720p', 5, '1280x720'], ['9:16', '1080p', 6, '1080x1920'], ['16:9', '4K', 4, '3840x2160']] as const) {
      expect(buildGeneration('generate/video', { prompt: 'test', options: { aspect_ratio: ratio, resolution, seconds } }).payload.size).toBe(size);
    }
  });
  it('routes the server-selected Omni engine through chat with video preferences', () => {
    vi.stubEnv('AI_VIDEO_MODEL', SERVER_MODELS.video); vi.stubEnv('AI_VIDEO_OMNI_ASYNC', 'false');
    const built = buildGeneration('generate/video', { prompt: 'flowers', options: { aspect_ratio: '9:16', seconds: 10, resolution: '4K', reasoning_effort: 'high' } });
    expect(built.path).toBe('chat/completions'); expect(built.kind).toBe('video');
    expect(Object.keys(built.payload).sort()).toEqual(['messages', 'model', 'resolution', 'stream']);
    expect(built.payload).toMatchObject({ model: serverModel('video'), stream: false, resolution: '4k' });
    for (const preference of ['生成视频', 'flowers', '10 秒', '9:16', '4K', 'high']) expect(built.payload.messages[0].content).toContain(preference);
  });
  it.each([2, 15, 3.5])('rejects unsupported Omni duration %s on the server', seconds => {
    vi.stubEnv('AI_VIDEO_MODEL', SERVER_MODELS.video); vi.stubEnv('AI_VIDEO_OMNI_ASYNC', 'false');
    expect(() => buildGeneration('generate/video', { prompt: 'flowers', options: { seconds } })).toThrow(InputError);
  });
  it('builds image provider fields and fallback only on the server', () => {
    vi.stubEnv('AI_IMAGE_API_MODE', 'auto'); vi.stubEnv('AI_IMAGE_MODEL', SERVER_MODELS.image);
    const built = buildGeneration('generate/image', { prompt: 'Flowers', aspectRatio: '2.35:1', imageSize: '4K', reasoningEffort: 'minimal' });
    expect(built.path).toBe('chat/completions'); expect(built.kind).toBe('image');
    expect(Object.keys(built.payload).sort()).toEqual(['image_size', 'max_tokens', 'messages', 'model', 'stream']);
    expect(built.payload.messages[0].content).toContain('只生成图片');
    expect(built.payload.messages[0].content).toContain('2.35:1');
    expect(built.payload.messages[0].content).toContain('minimal');
    expect(built.payload.messages[0].content).not.toContain('4K');
    expect(built.payload).toMatchObject({ model: serverModel('image'), image_size: '4K', max_tokens: 8192 });
    expect(built.fallback).toMatchObject({ path: 'images/generations', payload: { size: '4096x1743', n: 1, response_format: 'b64_json' } });
    expect(built.fallback!.payload.image_size).toBeUndefined();
  });
  it('puts song structure and optional duration in native audio text on the server', () => {
    vi.stubEnv('AI_AUDIO_API_MODE', 'native');
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const built = buildGeneration('generate/music', { song, duration: 180 });
    expect(built.path).toBe('chat/completions'); expect(built.kind).toBe('music');
    expect(Object.keys(built.payload).sort()).toEqual(['messages', 'model', 'stream']);
    expect(built.payload.model).toBe(serverModel('music'));
    expect(built.payload.messages[0].content).toContain('夏天的风');
    expect(built.payload.messages[0].content).toContain('Target duration: 180 seconds.');
    expect(buildGeneration('generate/music', { song }).payload.messages[0].content).not.toContain('Target duration:');
  });
  it('uses speech fields only when upstream audio is configured by the server', () => {
    vi.stubEnv('AI_AUDIO_API_MODE', 'upstream'); vi.stubEnv('AI_MUSIC_MODEL', 'tts-1');
    expect(buildGeneration('generate/music', { prompt: '你好', voice: 'alloy' })).toEqual({ kind: 'music', path: 'audio/speech', payload: { model: 'tts-1', input: '你好', voice: 'alloy', speed: 1, response_format: 'mp3' } });
  });
  it.each(['model', 'key', 'apiKey', 'systemPrompt', 'system'])('rejects client-supplied private field %s', field => {
    expect(() => buildGeneration('generate/image', { prompt: 'flowers', [field]: 'override' })).toThrow(InputError);
  });
});

describe('shared composer format', () => {
  it('preserves repeated sections and separates arrangement from exported lyrics', () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风\n吹过你的窗'; song.sections[1].direction = '吉他渐入'; song.sections.push({ ...song.sections[1], id: 'repeat' });
    const parsed = parseSong(JSON.stringify(song));
    expect(parsed.sections.filter(s => s.type === 'verse')).toHaveLength(2);
    expect(songPrompt(parsed)).toContain('Direction: 吉他渐入'); expect(songLyrics(parsed)).toContain('[verse]');
    expect(songLyrics(parsed)).not.toContain('吉他'); expect(sungLines(parsed)).not.toContain('[verse]');
  });
  it('does not export lyrics for instrumental compositions', () => {
    const song = newSong(); song.instrumental = true; song.sections[1].lyrics = 'not sung'; const parsed = parseSong(JSON.stringify(song));
    expect(parsed.sections[1].lyrics).toBe(''); expect(songLyrics(parsed)).toBe(''); expect(sungLines(parsed)).toBe('');
    expect(songPrompt(parsed)).toContain('Instrumental only. No vocals.'); expect(songPrompt(parsed)).not.toContain('not sung');
  });
  it('rejects broken optimization output instead of generating an unstructured song', () => {
    expect(() => parseSong('not json')).toThrow(); expect(() => parseSong('{"sections":[]}')).toThrow();
    expect(() => parseSong(JSON.stringify({ ...newSong(), sections: [{ type: 'random', direction: '', lyrics: '' }] }))).toThrow();
  });
  it('sends composition intent, keeping the engine and preset on the server', async () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(song) } }] })); vi.stubGlobal('fetch', fetchMock);
    expect((await composeSong('夏天的故事', '流行', false)).sections[1].lyrics).toBe('夏天的风');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ action: 'compose-song', inspiration: '夏天的故事', style: '流行', instrumental: false });
    const built = buildGeneration('chat/completions', body);
    expect(built.payload.model).toBe(serverModel('chat')); expect(built.payload.response_format).toBeUndefined();
    expect(built.payload.messages[0].content).toContain('只返回 JSON'); expect(built.payload.messages[1].content).toContain('夏天的故事');
  });
});
