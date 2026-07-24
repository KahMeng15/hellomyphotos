import type { PageLoad } from './$types';
import { fetchTimeline } from '$lib/api/media';

export const load: PageLoad = async () => {
  const files = await fetchTimeline();
  return { files };
};
