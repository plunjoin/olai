export interface ImageResolution { width: number; height: number }

export function imageResolutionWarning(resolution: ImageResolution | undefined, target: unknown): string | undefined {
  const minimum = ({ '1K': 1024, '2K': 2048, '4K': 3840 } as Record<string, number>)[String(target)];
  if (!resolution || !minimum || Math.max(resolution.width, resolution.height) >= minimum) return;
  return `实际图片为 ${resolution.width} × ${resolution.height} 像素，未达到所选 ${target}。当前服务未按目标分辨率返回图片。`;
}

// Read the original file without resizing or re-encoding it.
export async function readImageResolution(source: Blob | string): Promise<ImageResolution> {
  const objectURL = typeof source === 'string' ? undefined : URL.createObjectURL(source);
  try {
    return await new Promise<ImageResolution>((resolve, reject) => {
      const image = new Image();
      const finish = (error?: Error) => {
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        if (error) { image.src = ''; reject(error); }
        else resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      const timer = setTimeout(() => finish(new Error('图片尺寸读取超时。')), 10_000);
      image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error('图片尺寸无效。'));
      image.onerror = () => finish(new Error('无法读取图片尺寸。'));
      image.src = objectURL || source as string;
    });
  } finally { if (objectURL) URL.revokeObjectURL(objectURL); }
}
