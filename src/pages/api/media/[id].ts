import type { APIRoute } from 'astro';
import { downloadMedia, mediaFailure, MediaError } from '../../../lib/server/media';

export const prerender = false;
export const GET: APIRoute = async context => {
  try { return await downloadMedia(context); }
  catch (error) { return mediaFailure(error, context.request.method === 'HEAD'); }
};
export const HEAD = GET;
export const ALL: APIRoute = () => mediaFailure(new MediaError(405, 'MEDIA_METHOD', '不支持此请求方法。'));
