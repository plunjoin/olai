/** Long revision chains send the previous image back as a reference; oversized
 * renders are re-encoded so the data URL stays within the request limit. */
export async function referenceImageBlob(source: Blob, maxSize = 1536): Promise<Blob> {
  if (source.size <= 4 * 1024 * 1024 || typeof document === 'undefined' || typeof Image === 'undefined') return source;
  const url = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image decode failed'));
      element.src = url;
    });
    const width = image.naturalWidth || maxSize;
    const height = image.naturalHeight || maxSize;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob || source), 'image/jpeg', 0.88));
  } catch {
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}
