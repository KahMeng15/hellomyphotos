import { API_BASE } from '$lib/api/media';
import type { PageServerLoad } from './$types';

const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'
]);

export const load: PageServerLoad = async ({ params, fetch, url, request }) => {
  const { token, path } = params;
  let folderPath = path || '';
  let selectedFile: string | undefined;

  if (folderPath) {
    const lastSlash = folderPath.lastIndexOf('/');
    const lastSegment = lastSlash >= 0 ? folderPath.slice(lastSlash + 1) : folderPath;
    const dot = lastSegment.lastIndexOf('.');
    if (dot > 0) {
      const ext = lastSegment.slice(dot + 1).toLowerCase();
      if (MEDIA_EXTENSIONS.has(ext)) {
        selectedFile = lastSegment;
        folderPath = lastSlash >= 0 ? folderPath.slice(0, lastSlash) : '';
      }
    }
  }

  // Forward the real User-Agent from the incoming request.
  // This is critical for social crawlers (WhatsApp, Facebook, etc.) — the backend checks
  // the UA to skip the Turnstile security challenge. Universal fetch (+page.ts) doesn't
  // have access to the raw request, so it couldn't forward the UA. Server load can.
  const userAgent = request.headers.get('user-agent') || '';

  try {
    const res = await fetch(
      `${API_BASE}/api/shares/${token}${folderPath ? '/' + encodeURIComponent(folderPath) : ''}`,
      { headers: userAgent ? { 'user-agent': userAgent } : {} }
    );
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403 && data.error === 'turnstile_required') {
        return { turnstileRequired: true, token, files: [], directories: [] };
      }
      throw new Error('Share not found');
    }
    return {
      share: data.share,
      files: data.files,
      directories: data.directories || [],
      folderCoverId: data.folderCoverId,
      folderDescription: data.folderDescription || '',
      baseFolderPath: data.baseFolderPath || '',
      folderPath: data.folderPath || folderPath,
      selectedFile,
      token,
      person: data.person || null,
      personCoverMediaId: data.personCoverMediaId || null,
      personCoverBoundingBox: data.personCoverBoundingBox || null,
      personCoverImgWidth: data.personCoverImgWidth || null,
      personCoverImgHeight: data.personCoverImgHeight || null,
      pageUrl: url.href,
      origin: url.origin
    };
  } catch (error: any) {
    if (error.message === 'Share not found') {
      return { error: 'Invalid or expired share link', files: [] };
    }
    return { error: 'Failed to find share link', files: [] };
  }
};
