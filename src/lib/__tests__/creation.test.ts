import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageDimensions, normalizeRatio } from '../generation';
import { composeSong, newSong, parseSong, songLyrics, songPrompt, sungLines } from '../music';
import { base64Blob, consumeSSE, generateAudio, generateImage, generateVideo, mediaOutputs, publicServiceError, videoContent } from '../api';
import { DEFAULT_SETTINGS } from '../types';

afterEach(() => vi.unstubAllGlobals());
describe('creation configuration and request contracts', () => {
  it('reads native media responses without requiring text output', () => {
    expect(mediaOutputs({ choices: [{ message: { images: [{ image_url: { url: 'https://example.com/photo.png' } }] } }] }, 'image')[0].url).toBe('https://example.com/photo.png');
    expect(mediaOutputs({ choices: [{ message: { audio: { data: 'AQID', format: 'mp3' } } }] }, 'music')[0]).toEqual({ base64: 'AQID', mime: 'audio/mpeg' });
    expect(mediaOutputs({ choices: [{ message: { content: '![video](data:video/mp4;base64,AQID)' } }] }, 'video')[0]).toEqual({ base64: 'AQID', mime: 'video/mp4' });
  });
  it('creates a Veo video task with only supported parameters and normalizes 4K', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"id":"task-1","status":"in_progress"}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await generateVideo({ key: 'test-key', model: 'veo-3.1-fast-generate-preview', prompt: 'flowers', options: { aspect_ratio: '9:16', seconds: 8, resolution: '4K', reasoning_effort: 'high', size: 'fake-size' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/videos');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'veo-3.1-fast-generate-preview', prompt: 'flowers\n创意丰富程度：high。', size: '480x848', seconds: 8 });
  });
  it('routes Omni through chat completions with video preferences in the prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await generateVideo({ key: 'test-key', model: 'gemini-omni-1.1-flash', prompt: 'flowers', options: { aspect_ratio: '9:16', seconds: 10, resolution: '4K', reasoning_effort: 'high' }, mode: 'chat' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'resolution', 'stream']);
    expect(body.model).toBe('gemini-omni-1.1-flash');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    for (const preference of ['生成视频', 'flowers', '10 秒', '9:16', '4K', 'high']) expect(body.messages[0].content).toContain(preference);
  });
  it('rejects Omni durations outside its supported range before making a request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(generateVideo({ key: '', model: 'gemini-omni-1.1-flash', prompt: 'flowers', options: { seconds: 15 }, mode: 'chat' })).rejects.toThrow('3–10 秒');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reads only generated Omni video content from Interactions steps', () => {
    expect(mediaOutputs({ steps: [{ type: 'user_input', content: [{ type: 'video', data: 'reference', mime_type: 'video/mp4' }] }, { type: 'model_output', content: [{ type: 'video', data: 'AQID', mime_type: 'video/mp4' }] }] }, 'video')).toEqual([{ base64: 'AQID', url: undefined, mime: 'video/mp4' }]);
  });
  it('does not treat chat text or an image as a generated video', () => {
    expect(mediaOutputs({ choices: [{ message: { content: '这里是视频的创作建议。' } }] }, 'video')).toEqual([]);
    expect(mediaOutputs({ choices: [{ message: { content: '![image](data:image/png;base64,AQID)' } }] }, 'video')).toEqual([]);
  });
  it('keeps internal model identifiers out of visible service errors', () => {
    expect(publicServiceError('Model lyria-3.5 unavailable')).not.toContain('lyria');
    expect(publicServiceError('每日额度不足')).toBe('每日额度不足');
  });
  it('uses the requested creative engines', () => {
    expect([DEFAULT_SETTINGS.chatModel, DEFAULT_SETTINGS.musicModel, DEFAULT_SETTINGS.imageModel, DEFAULT_SETTINGS.videoModel]).toEqual(['gemini-3.5-flash', 'lyria-3.5', 'gemini-3.1-flash-image', 'veo-3.1-lite-generate-preview']);
  });
  it('preserves auto composition and accepts positive custom ratios', () => {
    expect(imageDimensions('auto', '4K')).toBeUndefined();
    expect(normalizeRatio(' 2.35：1 ')).toBe('2.35:1');
    expect(imageDimensions('16:9', '4K')).toBe('4096x2304');
    expect(() => normalizeRatio('0:1')).toThrow();
    expect(() => normalizeRatio('-1:2')).toThrow();
    expect(() => normalizeRatio('wide')).toThrow();
  });
  it('expresses image preferences as text and uses supported passthrough fields', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await generateImage({ key: '', model: DEFAULT_SETTINGS.imageModel, prompt: 'Flowers', aspectRatio: '2.35:1', imageSize: '4K', reasoningEffort: 'minimal', size: imageDimensions('2.35:1', '4K') });
    const native = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(native).sort()).toEqual(['image_size', 'max_tokens', 'messages', 'model', 'stream']);
    expect(native.messages[0].content).toContain('只生成图片');
    expect(native.messages[0].content).toContain('2.35:1');
    expect(native.messages[0].content).not.toContain('4K');
    expect(native.messages[0].content).toContain('minimal');
    expect(native.image_size).toBe('4K');
    expect(native.max_tokens).toBe(8192);
    const fallback = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fallback.size).toBe('4096x1743');
    expect(fallback.n).toBe(1);
    expect(fallback.response_format).toBe('b64_json');
    expect(fallback.image_size).toBeUndefined();
  });
  it('puts song structure and duration in native audio text', async () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await generateAudio({ key: '', model: DEFAULT_SETTINGS.musicModel, prompt: songPrompt(song), musicPath: 'generations', song, duration: 180 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
    expect(body.messages[0].content).toContain('夏天的风');
    expect(body.messages[0].content).toContain('Target duration: 180 seconds.');
  });
  it('omits duration for music generation when not specified', async () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await generateAudio({ key: '', model: DEFAULT_SETTINGS.musicModel, prompt: songPrompt(song), musicPath: 'generations', song });
    const nativeBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(nativeBody.messages[0].content).not.toContain('Target duration:');
    expect(nativeBody.messages[0].content).toContain('夏天的风');
  });
  it('does not redirect failed native music generation to an undocumented music API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"每日额度不足"}}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateAudio({ key: '', model: 'lyria-3.5', prompt: 'a song' })).rejects.toThrow('每日额度不足');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('uses speech input and voice fields for explicit upstream audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    await generateAudio({ key: '', model: 'tts-1', prompt: '你好', mode: 'upstream', voice: 'alloy' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/audio/speech');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'tts-1', input: '你好', voice: 'alloy', speed: 1, response_format: 'mp3' });
  });
  it('packages Markdown PCM output as WAV using the returned sample rate', async () => {
    const [output] = mediaOutputs({ choices: [{ message: { content: '![media](data:audio/pcm;rate=48000;base64,AAECAw==)' } }] }, 'music');
    const blob = base64Blob(output.base64!, output.mime);
    const header = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(48);
    expect(header.getUint32(24, true)).toBe(48000);
    expect(header.getUint32(40, true)).toBe(4);
  });
  it('downloads video through the authenticated content route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await videoContent('video_abc123', 'test-key')).type).toBe('video/mp4');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/videos/video_abc123/content');
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-key');
  });
  it('retains a 409 content status and rejects JSON masquerading as a video', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 409 })).mockResolvedValueOnce(Response.json({ error: 'no video' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(videoContent('video_abc123', '')).rejects.toMatchObject({ status: 409 });
    await expect(videoContent('video_abc123', '')).rejects.toThrow('服务未返回可播放的视频文件');
  });
  it('handles split UTF-8 SSE content and the documented error marker', async () => {
    const makeStream = (deltas: string[]) => {
      const bytes = new TextEncoder().encode(deltas.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
      return new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    };
    const text: string[] = [];
    await consumeSSE(makeStream(['你好', '世界']), value => text.push(value));
    expect(text.join('')).toBe('你好世界');
    await expect(consumeSSE(makeStream(['[Err', 'or] 每日额度不足']), () => {})).rejects.toThrow('每日额度不足');
  });
});
describe('shared composer format', () => {
  it('preserves repeated sections and separates arrangement from exported lyrics', () => {
    const song = newSong();
    song.sections[1].lyrics = '夏天的风\n吹过你的窗';
    song.sections[1].direction = '吉他渐入';
    song.sections.push({ ...song.sections[1], id: 'repeat' });
    const parsed = parseSong(JSON.stringify(song));
    expect(parsed.sections.filter(s => s.type === 'verse')).toHaveLength(2);
    expect(songPrompt(parsed)).toContain('Direction: 吉他渐入');
    expect(songLyrics(parsed)).toContain('[verse]');
    expect(songLyrics(parsed)).not.toContain('吉他');
    expect(sungLines(parsed)).not.toContain('[verse]');
  });
  it('does not export lyrics for instrumental compositions', () => {
    const song = newSong(); song.instrumental = true; song.sections[1].lyrics = 'not sung';
    const parsed = parseSong(JSON.stringify(song));
    expect(parsed.sections[1].lyrics).toBe('');
    expect(songLyrics(parsed)).toBe('');
    expect(sungLines(parsed)).toBe('');
  });
  it('rejects broken optimization output instead of generating an unstructured song', () => {
    expect(() => parseSong('not json')).toThrow();
    expect(() => parseSong('{"sections":[]}')).toThrow();
    expect(() => parseSong(JSON.stringify({ ...newSong(), sections: [{ type: 'random', direction: '', lyrics: '' }] }))).toThrow();
  });
  it('uses the default text engine to convert inspiration to the composer format', async () => {
    const song = newSong(); song.sections[1].lyrics = '夏天的风';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(song) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await composeSong('', DEFAULT_SETTINGS.chatModel, '夏天的故事', '流行', false)).sections[1].lyrics).toBe('夏天的风');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gemini-3.5-flash');
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toContain('只返回 JSON');
  });
});

