import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64Blob, chat, extractImagesFromContent, generateImage, mediaOutputs, publicServiceError, request, safeMediaURL } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('public API authentication and chat contract', () => {
  it('uses the session cookie, removes bearer credentials and preserves request options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await request('generate/image', { method: 'POST', signal, headers: { Authorization: 'Bearer private', 'X-Request-Id': 'request-1' }, body: JSON.stringify({ prompt: 'flowers' }) });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/generate/image');
    const init = fetchMock.mock.calls[0][1];
    expect(init).toMatchObject({ method: 'POST', signal, credentials: 'same-origin' });
    expect(init.headers.has('Authorization')).toBe(false);
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(init.headers.get('X-Request-Id')).toBe('request-1');
  });

  it('sends only chat action, temperature and valid conversational messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '你好' } }] })); vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    const onText = vi.fn();
    await chat([
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: '', interrupted: true },
      { id: '3', role: 'assistant', content: 'failed response', error: 'failed' },
      { id: '4', role: 'assistant', content: 'hi' },
    ], .4, signal, onText);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/completions');
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'chat', temperature: .4, stream: true, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] });
    expect(onText).toHaveBeenCalledWith('你好');
  });

  it('retains the HTTP status without leaking raw provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Private provider rejected API key' } }, { status: 503 })));
    await expect(request('generate/image')).rejects.toMatchObject({ status: 503, message: '创作服务暂时无法完成请求，请重试或检查服务连接。' });
  });
});

describe('safeMediaURL', () => {
  it('allows http and https URLs', () => {
    expect(safeMediaURL('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(safeMediaURL('http://example.com/audio.mp3')).toBe('http://example.com/audio.mp3');
  });

  it('allows data URLs for image, audio, and video', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(safeMediaURL(dataUrl)).toBe(dataUrl);
  });

  it('throws on unsupported protocols', () => {
    expect(() => safeMediaURL('javascript:alert(1)')).toThrow();
    expect(() => safeMediaURL('ftp://example.com')).toThrow();
  });
});

describe('extractImagesFromContent', () => {
  it('extracts data: image URI from markdown format', () => {
    const content = '\n![media](data:image/jpeg;base64,/9j/4AAQSkZJRg==)\n';
    const images = extractImagesFromContent(content);
    expect(images).toHaveLength(1);
    expect(images[0].base64).toBe('/9j/4AAQSkZJRg==');
    expect(images[0].mime).toBe('image/jpeg');
    expect(images[0].alt).toBe('media');
  });

  it('extracts https URL from markdown format', () => {
    const content = '这是生成的图片：\n![被浓雾笼罩的森林](https://example.com/forest.png)\n希望你喜欢！';
    const images = extractImagesFromContent(content);
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('https://example.com/forest.png');
    expect(images[0].mime).toBe('image/png');
    expect(images[0].alt).toBe('被浓雾笼罩的森林');
  });

  it('extracts multiple images from response', () => {
    const content = '生成了2张图片：\n![img1](data:image/png;base64,AQID)\n![img2](https://example.com/2.jpg)';
    const images = extractImagesFromContent(content);
    expect(images).toHaveLength(2);
    expect(images[0].base64).toBe('AQID');
    expect(images[1].url).toBe('https://example.com/2.jpg');
  });

  it('falls back to raw data URI without markdown syntax', () => {
    const content = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2wAA';
    const images = extractImagesFromContent(content);
    expect(images).toHaveLength(1);
    expect(images[0].mime).toBe('image/webp');
    expect(images[0].base64).toBe('UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2wAA');
  });
});

describe('mediaOutputs', () => {
  it('parses standard OpenAI format with b64_json', () => {
    const json = {
      data: [{ b64_json: 'AQID' }],
    };
    const outputs = mediaOutputs(json, 'image');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].base64).toBe('AQID');
    expect(outputs[0].mime).toBe('image/png');
  });

  it('parses native chat/completions format with choices[0].message.content', () => {
    const json = {
      choices: [{
        message: {
          role: 'assistant',
          content: '\n![media](data:image/jpeg;base64,/9j/4AAQSkZJRg==)\n',
        },
      }],
    };
    const outputs = mediaOutputs(json, 'image');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].base64).toBe('/9j/4AAQSkZJRg==');
    expect(outputs[0].mime).toBe('image/jpeg');
  });

  it('parses url responses', () => {
    const json = {
      output: [{ url: 'https://example.com/music.mp3' }],
    };
    const outputs = mediaOutputs(json, 'music');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].url).toBe('https://example.com/music.mp3');
    expect(outputs[0].mime).toBe('audio/mpeg');
  });
});

describe('base64Blob', () => {
  it('creates a Blob with correct mime type and content', async () => {
    // 'AQID' is base64 for bytes [1, 2, 3]
    const blob = base64Blob('AQID', 'image/png');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('cleans whitespace and newlines in base64 string', async () => {
    const blob = base64Blob('AQ ID\n', 'image/jpeg');
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(3);
  });
});

describe('publicServiceError', () => {
  it('identifies rate limit errors from status code', () => {
    expect(publicServiceError('Model not available', 429)).toBe('上游创作服务额度已用完或请求受限，请稍后重试。');
  });

  it('identifies rate limit errors from message content', () => {
    expect(publicServiceError('Rate limit exceeded for ai.google.dev/gemini-api')).toBe('上游创作服务额度已用完或请求受限，请稍后重试。');
    expect(publicServiceError('Quota exceeded, please retry later')).toBe('上游创作服务额度已用完或请求受限，请稍后重试。');
    expect(publicServiceError('请求过于频繁')).toBe('上游创作服务额度已用完或请求受限，请稍后重试。');
  });

  it('masks model names in generic errors', () => {
    const result = publicServiceError('Model gemini-3.5-flash not found');
    expect(result).toBe('创作服务暂时无法完成请求，请重试或检查服务连接。');
    expect(result).not.toContain('gemini');
  });

  it('preserves safe local messages and masks raw provider errors or credential details', () => {
    expect(publicServiceError('网络连接失败')).toBe('网络连接失败');
    expect(publicServiceError('Invalid API key')).toBe('创作服务暂时无法完成请求，请重试或检查服务连接。');
    expect(publicServiceError('密钥无效')).toBe('创作服务暂时无法完成请求，请重试或检查服务连接。');
  });
});

describe('generateImage', () => {
  it('handles upstream 502 with informative message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: 'error code: 502' }),
    });

    try {
      await expect(generateImage({
        prompt: 'test prompt',
      })).rejects.toThrow('创作服务暂时无法完成请求，请重试或检查服务连接。');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
