import type { PageLoad } from './$types';
import { fetchTimeline } from '$lib/api/media';

export const load: PageLoad = async (event) => {
  const { fetch } = event;
  const signal = (event as any).signal;
  const files = await fetchTimeline(fetch, signal);
  return { files };
};
