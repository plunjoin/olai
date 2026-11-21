// 头像上传前的浏览器端处理：居中裁成正方形并缩到固定尺寸，
// 避免把手机原图（可能十几 MB）直接传上去，也不依赖服务端图像库。

export const AVATAR_IMAGE_SIZE = 256;
export const AVATAR_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarFileError = 'type' | 'size';

export function avatarFileError(file: Pick<Blob, 'type' | 'size'>): AvatarFileError | null {
  if (!(AVATAR_FILE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > AVATAR_FILE_MAX_BYTES) return 'size';
  return null;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function squareAvatarBlob(file: Blob): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    // imageOrientation keeps portrait photos upright even with EXIF rotation.
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadImage(file);
  }
  try {
    if (!source.width || !source.height) throw new Error('empty image');
    const side = Math.min(source.width, source.height);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_IMAGE_SIZE;
    canvas.height = AVATAR_IMAGE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    if ('close' in source) source.close();
  }
}
