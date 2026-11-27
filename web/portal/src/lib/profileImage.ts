// 头像上传前的浏览器端处理：居中裁成正方形并缩到固定尺寸，
// 避免把手机原图（可能十几 MB）直接传上去，也不依赖服务端图像库。

export const AVATAR_IMAGE_SIZE = 256;
export const AVATAR_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarFileError = 'type' | 'size';

// 封面是横跨整列的长条，按 3:1 裁切后压到一张小图。
export const BANNER_IMAGE_WIDTH = 1200;
export const BANNER_IMAGE_HEIGHT = 400;
export const BANNER_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const BANNER_FILE_TYPES = AVATAR_FILE_TYPES;

export function avatarFileError(file: Pick<Blob, 'type' | 'size'>): AvatarFileError | null {
  if (!(AVATAR_FILE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > AVATAR_FILE_MAX_BYTES) return 'size';
  return null;
}

/** 封面沿用头像的类型与体积限制，只是允许更大的图片。 */
export function bannerFileError(file: Pick<Blob, 'type' | 'size'>): AvatarFileError | null {
  if (!(BANNER_FILE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > BANNER_FILE_MAX_BYTES) return 'size';
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

/** 封面裁成宽幅长条：从中间取一条横带，缩到固定尺寸后编码为 WebP。 */
export async function wideBannerBlob(file: Blob): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadImage(file);
  }
  try {
    if (!source.width || !source.height) throw new Error('empty image');
    const target = BANNER_IMAGE_WIDTH / BANNER_IMAGE_HEIGHT;
    // 先算出能铺满整条封面的最大裁切框，再居中截取。
    let width = source.width;
    let height = Math.round(source.width / target);
    if (height > source.height) {
      height = source.height;
      width = Math.round(source.height * target);
    }
    const canvas = document.createElement('canvas');
    canvas.width = BANNER_IMAGE_WIDTH;
    canvas.height = BANNER_IMAGE_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, (source.width - width) / 2, (source.height - height) / 2, width, height, 0, 0, BANNER_IMAGE_WIDTH, BANNER_IMAGE_HEIGHT);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    if ('close' in source) source.close();
  }
}
