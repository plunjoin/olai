// 同一 IP 的并发对话槽位。单实例内存计数，重启清零属预期行为；
// 每日额度与限速由数据库（quota）负责，这里只管“正在进行的请求”。

const active = new Map<string, number>();

/**
 * 尝试为该 IP 占用一个对话槽位。
 * 超过 limit 返回 null（调用方应返回 429）；成功返回幂等的释放函数。
 * limit <= 0 视为不限制并发，返回空释放函数。
 */
export function acquireChatSlot(ip: string, limit: number): (() => void) | null {
  if (limit <= 0) return () => {};
  const current = active.get(ip) ?? 0;
  if (current >= limit) return null;
  active.set(ip, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (active.get(ip) ?? 1) - 1;
    if (next > 0) active.set(ip, next);
    else active.delete(ip);
  };
}

/**
 * 包装上游响应流，在流完成、出错、被取消或超过 5 分钟后释放并发槽位。
 * 只透传字节，不改动内容；客户端取消会经 pipeTo 反向取消上游流。
 */
export function releaseOnStreamEnd(body: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  let released = false;
  const timer: ReturnType<typeof setTimeout> = setTimeout(finish, 300_000);
  (timer as { unref?: () => void }).unref?.();
  function finish() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    release();
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { controller.enqueue(chunk); },
    flush() { finish(); },
  });
  body.pipeTo(writable).catch(finish);
  return readable;
}
