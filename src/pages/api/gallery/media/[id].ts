import type { APIRoute } from 'astro';
import { galleryFailure, galleryMedia } from '../../../../lib/server/gallery';
import { MediaError } from '../../../../lib/server/media';

export const prerender = false;
export const GET: APIRoute = async context => {
  try { return await galleryMedia(context); }
  catch (error) { return galleryFailure(error, context.request.method === 'HEAD'); }
};
export const HEAD = GET;
export const ALL: APIRoute = context => galleryFailure(new MediaError(405, 'GALLERY_METHOD', '不支持此请求方法。'), context.request.method === 'HEAD');
