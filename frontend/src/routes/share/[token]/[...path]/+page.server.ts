import { API_BASE } from '$lib/api/media';
import type { PageServerLoad } from './$types';

const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v'
]);

export const load: PageServerLoad = async ({ params, fetch, url, request, getClientAddress }) => {
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

  // Forward User-Agent and Referer from incoming request, plus query string (UTM/ref tags).
  // This is critical for analytics tracking and for social crawlers (WhatsApp, Facebook, etc.).
  const userAgent = request.headers.get('user-agent') || '';
  const referer = request.headers.get('referer') || '';
  const search = url.search || '';

  const forwardHeaders: Record<string, string> = {};
  if (userAgent) forwardHeaders['user-agent'] = userAgent;
  if (referer) forwardHeaders['referer'] = referer;
  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders['cookie'] = cookie;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    forwardHeaders['x-forwarded-for'] = forwardedFor;
  } else {
    try {
      forwardHeaders['x-forwarded-for'] = getClientAddress();
    } catch (e) {}
  }
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) forwardHeaders['cf-connecting-ip'] = cfConnectingIp;
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) forwardHeaders['x-real-ip'] = xRealIp;

  try {
    const res = await fetch(
      `${API_BASE}/api/shares/${token}${folderPath ? '/' + encodeURIComponent(folderPath) : ''}${search}`,
      { headers: forwardHeaders }
    );
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403 && data.error === 'turnstile_required') {
        return { turnstileRequired: true, token, files: [], directories: [] };
      }
      if ((res.status === 401 || res.status === 429) && data.passwordRequired) {
        return {
          passwordRequired: true,
          folderName: data.folderName,
          token,
          files: [],
          directories: [],
          pageUrl: url.href,
          origin: url.origin,
          turnstileRequired: false,
          isLockedOut: Boolean(data.isLockedOut),
          lockoutMessage: data.lockoutMessage || (res.status === 429 ? data.error : '')
        };
      }
      throw new Error('Share not found');
    }
    if (data.passwordRequired) {
      return {
        passwordRequired: true,
        folderName: data.folderName,
        token,
        files: [],
        directories: [],
        pageUrl: url.href,
        origin: url.origin,
        turnstileRequired: false,
        isLockedOut: Boolean(data.isLockedOut),
        lockoutMessage: data.lockoutMessage || ''
      };
    }
    if (data.expired) {
      return {
        expired: true,
        isDisabled: data.isDisabled,
        isExpired: data.isExpired,
        isLockdown: data.isLockdown,
        folderName: data.folderName,
        folderPath: data.folderPath,
        token,
        files: [],
        directories: [],
        pageUrl: url.href,
        origin: url.origin
      };
    }
    return {
      share: data.share,
      files: data.files,
      directories: data.directories || [],
      folderCoverId: data.folderCoverId,
      folderCoverBoundingBox: data.folderCoverBoundingBox || null,
      folderCoverImgWidth: data.folderCoverImgWidth || null,
      folderCoverImgHeight: data.folderCoverImgHeight || null,
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
