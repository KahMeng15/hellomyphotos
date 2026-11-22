import path from 'path';
import fs from 'fs';

const defaultMediaDir = fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../volumes/media_ro');
export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || defaultMediaDir);

const defaultStagingDir = fs.existsSync('/app/staging') ? '/app/staging' : path.resolve(process.cwd(), '../volumes/staging_rw');
export const STAGING_ROOT = path.resolve(process.env.STAGING_ROOT || defaultStagingDir);

const defaultCacheDir = fs.existsSync('/app/cache') ? '/app/cache' : path.resolve(process.cwd(), '../volumes/cache_rw');
export const CACHE_ROOT = path.resolve(process.env.CACHE_ROOT || defaultCacheDir);

// Ensure staging directory exists
if (!fs.existsSync(STAGING_ROOT)) {
  try {
    fs.mkdirSync(STAGING_ROOT, { recursive: true });
  } catch (err: any) {
    console.warn(`[MediaPath] Could not create STAGING_ROOT at ${STAGING_ROOT}:`, err.message);
  }
}

/**
 * Resolves the absolute path of a media file on disk.
 * Handles files located in the permanent read-only library (MEDIA_ROOT)
 * as well as temporary files uploaded to live tethered sessions (STAGING_ROOT).
 */
export function resolveMediaFullPath(folderPath: string | null | undefined, fileName: string): string {
  const fp = (folderPath || '').replace(/\\/g, '/').replace(/^\/+/, '');

  // 1. Explicit 'staging/' prefix in folderPath (e.g. 'staging/sessionId')
  if (fp.startsWith('staging/') || fp === 'staging') {
    const sub = fp.replace(/^staging\/?/, '');
    return path.join(STAGING_ROOT, sub, fileName);
  }

  // 2. Direct presence in staging directory
  const stagingCandidate = path.join(STAGING_ROOT, fp, fileName);
  if (fs.existsSync(stagingCandidate)) {
    return stagingCandidate;
  }

  // 3. Fallback to standard permanent media library
  return path.join(MEDIA_ROOT, fp, fileName);
}

/**
 * Checks if a media file exists on disk, and whether it resides in STAGING_ROOT.
 */
export function checkMediaExists(folderPath: string | null | undefined, fileName: string): { exists: boolean; isStaged: boolean; fullPath: string } {
  const fp = (folderPath || '').replace(/\\/g, '/').replace(/^\/+/, '');

  if (fp.startsWith('staging/') || fp === 'staging') {
    const sub = fp.replace(/^staging\/?/, '');
    const p = path.join(STAGING_ROOT, sub, fileName);
    if (fs.existsSync(p)) return { exists: true, isStaged: true, fullPath: p };
  }

  const stagingPath = path.join(STAGING_ROOT, fp, fileName);
  if (fs.existsSync(stagingPath)) {
    return { exists: true, isStaged: true, fullPath: stagingPath };
  }

  const mediaPath = path.join(MEDIA_ROOT, fp, fileName);
  if (fs.existsSync(mediaPath)) {
    return { exists: true, isStaged: false, fullPath: mediaPath };
  }

  return { exists: false, isStaged: false, fullPath: stagingPath };
}

/**
 * Checks if a folder exists in either MEDIA_ROOT or STAGING_ROOT.
 */
export function checkFolderExists(folderPath: string | null | undefined): { exists: boolean; inMedia: boolean; inStaging: boolean } {
  const fp = (folderPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const inMedia = fs.existsSync(path.join(MEDIA_ROOT, fp));
  const inStaging = fs.existsSync(path.join(STAGING_ROOT, fp));
  return { exists: inMedia || inStaging, inMedia, inStaging };
}
