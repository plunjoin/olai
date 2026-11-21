/** Composer attachments are kept in memory only for the next request. */
export const ATTACHMENT_ACCEPT = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
  '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yaml', '.yml',
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
].join(',');

export const MAX_ATTACHMENTS = 6;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_TEXT_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_ATTACHMENT_PROMPT = 80_000;

export type ImageAttachment = {
  id: string;
  kind: 'image';
  name: string;
  mime: string;
  size: number;
  file: File;
  preview: string;
};
export type TextAttachment = {
  id: string;
  kind: 'text';
  name: string;
  mime: string;
  size: number;
  text: string;
};
export type ComposerAttachment = ImageAttachment | TextAttachment;

/** The message shown to the user; callers translate it with t(). */
export class AttachmentError extends Error {}

const uid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Text and images are the only attachments the composer accepts. */
export function attachmentKind(file: File): 'image' | 'text' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/')) return 'text';
  if (/^application\/(json|xml|x-yaml|yaml)$/i.test(file.type)) return 'text';
  if (/\.(txt|md|markdown|csv|json|log|ya?ml)$/i.test(file.name)) return 'text';
  return null;
}

export async function readComposerAttachment(file: File): Promise<ComposerAttachment> {
  const kind = attachmentKind(file);
  if (!kind) throw new AttachmentError('仅支持图片、TXT、Markdown 等文本附件。');
  if (kind === 'image') {
    if (file.size > MAX_IMAGE_BYTES) throw new AttachmentError('图片不能超过 6 MB。');
    return {
      id: uid(),
      kind,
      name: file.name || 'image',
      mime: file.type || 'image/png',
      size: file.size,
      file,
      preview: URL.createObjectURL(file),
    };
  }
  if (file.size > MAX_TEXT_BYTES) throw new AttachmentError('文本附件不能超过 256 KB。');
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new AttachmentError('附件读取失败，请重试。');
  }
  if (!text.trim()) throw new AttachmentError('附件内容为空。');
  return {
    id: uid(),
    kind,
    name: file.name || 'attachment.txt',
    mime: file.type || 'text/plain',
    size: file.size,
    text: text.slice(0, MAX_TEXT_CHARS),
  };
}

/** Text files become labelled blocks in the prompt sent to the model. */
export function attachmentPrompt(attachments: readonly ComposerAttachment[]): string {
  const texts = attachments.filter((attachment): attachment is TextAttachment => attachment.kind === 'text');
  if (!texts.length) return '';
  const prompt = texts
    .map(attachment => `【附件：${attachment.name}】\n${attachment.text.trim()}`)
    .join('\n\n');
  if (prompt.length <= MAX_ATTACHMENT_PROMPT) return prompt;
  return `${prompt.slice(0, MAX_ATTACHMENT_PROMPT)}\n\n（附件内容过长，已截断。）`;
}

export function attachmentImages(attachments: readonly ComposerAttachment[]): File[] {
  return attachments.filter((attachment): attachment is ImageAttachment => attachment.kind === 'image').map(attachment => attachment.file);
}

/** A small durable image preview for the saved conversation record. */
export async function attachmentThumbnail(file: File, maxSize = 512): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return '';
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image decode failed'));
      element.src = source;
    });
    const width = image.naturalWidth || maxSize;
    const height = image.naturalHeight || maxSize;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Object URLs are local to the attachment and must be released when it leaves the composer. */
export function releaseAttachment(attachment: ComposerAttachment) {
  if (attachment.kind === 'image') URL.revokeObjectURL(attachment.preview);
}

export function releaseAllAttachments(attachments: readonly ComposerAttachment[]) {
  attachments.forEach(releaseAttachment);
}
