import type { PageLoad } from './$types';
import { fetchTimeline } from '$lib/api/media';

export const load: PageLoad = async ({ fetch }) => {
  const files = await fetchTimeline(fetch);
  return { files };
};
