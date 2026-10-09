import { describe, expect, it, vi } from 'vitest';
import { base64Blob, extractImagesFromContent, generateImage, mediaOutputs, publicServiceError, safeMediaURL } from './api';

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

  it('preserves non-sensitive error messages', () => {
    expect(publicServiceError('网络连接失败')).toBe('网络连接失败');
    expect(publicServiceError('Invalid API key')).toBe('Invalid API key');
  });
});

describe('generateImage', () => {
  it('handles upstream 502 with informative message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: async () => ({ message: 'error code: 502' }),
    });

    try {
      await expect(generateImage({
        key: 'test',
        model: 'gemini-3.1-flash-image',
        prompt: 'test prompt',
        mode: 'upstream',
      })).rejects.toThrow(/图片专用接口调用失败/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
