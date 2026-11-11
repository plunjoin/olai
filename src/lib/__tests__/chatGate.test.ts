import { describe, expect, it } from 'vitest';
import { acquireChatSlot, releaseOnStreamEnd } from '../server/chatGate';

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

describe('chat concurrency gate', () => {
  it('rejects slots beyond the limit and frees them on release', () => {
    const first = acquireChatSlot('1.2.3.4', 2);
    const second = acquireChatSlot('1.2.3.4', 2);
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(acquireChatSlot('1.2.3.4', 2)).toBeNull();
    // 其他 IP 不受影响
    expect(acquireChatSlot('5.6.7.8', 2)).toBeTypeOf('function');
    first!(); second!();
    expect(acquireChatSlot('1.2.3.4', 2)).toBeTypeOf('function');
  });

  it('treats zero or negative limits as unlimited', () => {
    for (let i = 0; i < 30; i++) expect(acquireChatSlot('1.2.3.4', 0)).toBeTypeOf('function');
    expect(acquireChatSlot('1.2.3.4', -1)).toBeTypeOf('function');
  });

  it('releases only once and cleans up empty entries', () => {
    const release = acquireChatSlot('9.9.9.9', 1)!;
    release(); release();
    const again = acquireChatSlot('9.9.9.9', 1);
    expect(again).toBeTypeOf('function');
    again!();
  });

  it('releases the slot when the wrapped stream finishes', async () => {
    let released = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('hello')); controller.close(); },
    });
    const stream = releaseOnStreamEnd(body, () => { released++; });
    expect(await new Response(stream).text()).toBe('hello');
    await tick();
    expect(released).toBe(1);
  });

  it('releases the slot when the wrapped stream is cancelled', async () => {
    let released = 0;
    const body = new ReadableStream<Uint8Array>({ start() { /* never closes */ } });
    const stream = releaseOnStreamEnd(body, () => { released++; });
    await stream.cancel();
    await tick();
    expect(released).toBe(1);
  });

  it('releases the slot when the upstream stream errors', async () => {
    let released = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('x')); controller.error(new Error('upstream')); },
    });
    const stream = releaseOnStreamEnd(body, () => { released++; });
    await expect(new Response(stream).text()).rejects.toThrow();
    await tick();
    expect(released).toBe(1);
  });
});
