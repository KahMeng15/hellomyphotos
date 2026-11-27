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
  const cleanFolder = path.normalize(folderPath || '').replace(/^(\.\.[\/\\])+/, '').replace(/^[/\\]+/, '');
  const cleanFileName = path.basename(fileName);
  const fp = cleanFolder.replace(/\\/g, '/');

  // 1. Explicit 'staging/' prefix in folderPath (e.g. 'staging/sessionId')
  if (fp.startsWith('staging/') || fp === 'staging') {
    const sub = fp.replace(/^staging\/?/, '');
    const p = path.resolve(STAGING_ROOT, sub, cleanFileName);
    if (p.startsWith(STAGING_ROOT)) {
      return p;
    }
  }

  // 2. Direct presence in staging directory
  const stagingCandidate = path.resolve(STAGING_ROOT, fp, cleanFileName);
  if (stagingCandidate.startsWith(STAGING_ROOT) && fs.existsSync(stagingCandidate)) {
    return stagingCandidate;
  }

  // 3. Fallback to standard permanent media library
  const mediaCandidate = path.resolve(MEDIA_ROOT, fp, cleanFileName);
  if (mediaCandidate.startsWith(MEDIA_ROOT)) {
    return mediaCandidate;
  }

  return stagingCandidate;
}

/**
 * Checks if a media file exists on disk, and whether it resides in STAGING_ROOT.
 */
export function checkMediaExists(folderPath: string | null | undefined, fileName: string): { exists: boolean; isStaged: boolean; fullPath: string } {
  const cleanFolder = path.normalize(folderPath || '').replace(/^(\.\.[\/\\])+/, '').replace(/^[/\\]+/, '');
  const cleanFileName = path.basename(fileName);
  const fp = cleanFolder.replace(/\\/g, '/');

  if (fp.startsWith('staging/') || fp === 'staging') {
    const sub = fp.replace(/^staging\/?/, '');
    const p = path.resolve(STAGING_ROOT, sub, cleanFileName);
    if (p.startsWith(STAGING_ROOT) && fs.existsSync(p)) {
      return { exists: true, isStaged: true, fullPath: p };
    }
  }

  const stagingPath = path.resolve(STAGING_ROOT, fp, cleanFileName);
  if (stagingPath.startsWith(STAGING_ROOT) && fs.existsSync(stagingPath)) {
    return { exists: true, isStaged: true, fullPath: stagingPath };
  }

  const mediaPath = path.resolve(MEDIA_ROOT, fp, cleanFileName);
  if (mediaPath.startsWith(MEDIA_ROOT) && fs.existsSync(mediaPath)) {
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
