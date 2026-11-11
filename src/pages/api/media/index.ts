import type { APIRoute } from 'astro';
import { mediaFailure, MediaError, uploadMedia } from '../../../lib/server/media';

export const prerender = false;
export const POST: APIRoute = async context => {
  try { return await uploadMedia(context); }
  catch (error) { return mediaFailure(error); }
};
export const ALL: APIRoute = () => mediaFailure(new MediaError(405, 'MEDIA_METHOD', '不支持此请求方法。'));
