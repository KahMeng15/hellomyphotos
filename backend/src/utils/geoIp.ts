import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import maxmind, { type CityResponse, type AsnResponse, type Reader } from 'maxmind';
import { redis } from '../config/redis';

export interface IpGeoInfo {
  ip: string;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  isp: string | null;
}

const CITY_DB_NAME = 'GeoLite2-City.mmdb';
const ASN_DB_NAME = 'GeoLite2-ASN.mmdb';
const MAX_DB_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (MaxMind updates weekly)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Check once every 24 hours

const MIRROR_URLS = {
  City: 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb',
  ASN: 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-ASN.mmdb'
};

let cityReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let updateInProgress = false;
let updateTimer: NodeJS.Timeout | null = null;

export function normalizeIp(ip: string): string {
  if (!ip) return 'unknown';
  let clean = ip.trim();
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7);
  }
  return clean;
}

export function isPrivateIp(ip: string): boolean {
  const clean = normalizeIp(ip);
  if (!clean || clean === 'unknown' || clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('169.254.') || clean.startsWith('127.')) return true;
  if (clean.startsWith('172.')) {
    const parts = clean.split('.');
    if (parts.length >= 2) {
      const sec = parseInt(parts[1], 10);
      if (sec >= 16 && sec <= 31) return true;
    }
  }
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) return true;
  return false;
}

export function findMmdbPath(filename: string): string | null {
  const candidates = [
    process.env.GEOIP_DIR ? path.join(process.env.GEOIP_DIR, filename) : null,
    path.resolve(process.cwd(), 'geoip', filename),
    path.resolve(process.cwd(), 'volumes/geoip', filename),
    path.resolve(process.cwd(), '../volumes/geoip', filename),
    path.resolve(process.cwd(), 'data/geoip', filename),
    path.join('/app/geoip', filename)
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

export function getGeoIpDir(): string {
  if (process.env.GEOIP_DIR) {
    try {
      fs.mkdirSync(process.env.GEOIP_DIR, { recursive: true });
      return process.env.GEOIP_DIR;
    } catch {}
  }

  const preferredDirs = [
    '/app/geoip',
    path.resolve(process.cwd(), '../volumes/geoip'),
    path.resolve(process.cwd(), 'volumes/geoip'),
    path.resolve(process.cwd(), 'geoip')
  ];

  for (const dir of preferredDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // try next directory
    }
  }

  return path.resolve(process.cwd(), 'geoip');
}

function isFileStale(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) > MAX_DB_AGE_MS;
  } catch {
    return true;
  }
}

async function extractMmdbFromTarGz(stream: NodeJS.ReadableStream, targetFilename: string): Promise<Buffer | null> {
  const gunzip = zlib.createGunzip();
  const decompressed = (stream as any).pipe(gunzip);

  const chunks: Buffer[] = [];
  let totalLen = 0;

  for await (const chunk of decompressed) {
    chunks.push(chunk as Buffer);
    totalLen += (chunk as Buffer).length;
  }
  const buf = Buffer.concat(chunks, totalLen);

  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    offset += 512;
    if (header[0] === 0) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    if (name.endsWith(targetFilename) || name.endsWith('/' + targetFilename)) {
      return buf.subarray(offset, offset + size);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return null;
}

export async function downloadDatabase(edition: 'City' | 'ASN'): Promise<boolean> {
  const filename = edition === 'City' ? CITY_DB_NAME : ASN_DB_NAME;
  const targetDir = getGeoIpDir();
  const destPath = path.join(targetDir, filename);
  const tmpPath = `${destPath}.tmp-${Date.now()}`;
  const licenseKey = process.env.MAXMIND_LICENSE_KEY;

  console.log(`[GeoIP] Downloading ${filename} to ${destPath}...`);

  try {
    // 1. Try official MaxMind download if license key is configured
    if (licenseKey) {
      try {
        console.log(`[GeoIP] Attempting official MaxMind download for ${edition}...`);
        const maxMindUrl = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-${edition}&license_key=${licenseKey}&suffix=tar.gz`;
        const res = await fetch(maxMindUrl);
        if (res.ok && res.body) {
          const buffer = await extractMmdbFromTarGz(Readable.fromWeb(res.body as any), filename);
          if (buffer && buffer.length >= 1_000_000) {
            fs.writeFileSync(tmpPath, buffer);
            fs.renameSync(tmpPath, destPath);
            console.log(`[GeoIP] Successfully downloaded and installed ${filename} from MaxMind (${buffer.length} bytes).`);
            return true;
          }
        }
        console.warn(`[GeoIP] Official MaxMind download returned status ${res.status}. Falling back to GitHub mirror.`);
      } catch (err: any) {
        console.warn(`[GeoIP] Official MaxMind download failed: ${err.message}. Falling back to mirror.`);
      }
    }

    // 2. Download from public GitHub mirror
    const mirrorUrl = MIRROR_URLS[edition];
    console.log(`[GeoIP] Fetching ${edition} from mirror: ${mirrorUrl}...`);
    const res = await fetch(mirrorUrl);
    if (!res.ok) {
      throw new Error(`Mirror returned HTTP ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
      throw new Error('Mirror response body was empty');
    }

    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmpPath));

    const stat = fs.statSync(tmpPath);
    if (stat.size < 1_000_000) {
      throw new Error(`Downloaded database file is too small (${stat.size} bytes), possible corruption.`);
    }

    fs.renameSync(tmpPath, destPath);
    console.log(`[GeoIP] Successfully downloaded and installed ${filename} (${stat.size} bytes).`);
    return true;
  } catch (err: any) {
    console.error(`[GeoIP] Failed to download ${filename}:`, err.message);
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    return false;
  }
}

export async function clearStaleGeoCache(): Promise<void> {
  try {
    const keys = await redis.keys('geo:*');
    if (keys.length > 0) {
      for (let i = 0; i < keys.length; i += 100) {
        await redis.del(...keys.slice(i, i + 100));
      }
      console.log(`[GeoIP] Cleared ${keys.length} cached geo entries from Redis.`);
    }
  } catch (err: any) {
    console.error('[GeoIP] Failed to clear Redis geo cache:', err.message);
  }
}

export async function reloadReaders(): Promise<void> {
  const cityPath = findMmdbPath(CITY_DB_NAME);
  if (cityPath) {
    try {
      cityReader = await maxmind.open<CityResponse>(cityPath);
      console.log(`[GeoIP] Loaded MaxMind City database from ${cityPath}`);
    } catch (err) {
      console.error(`[GeoIP] Error opening City database at ${cityPath}:`, err);
    }
  } else {
    console.warn('[GeoIP] GeoLite2-City.mmdb not found. Location resolution will be unavailable until downloaded.');
  }

  const asnPath = findMmdbPath(ASN_DB_NAME);
  if (asnPath) {
    try {
      asnReader = await maxmind.open<AsnResponse>(asnPath);
      console.log(`[GeoIP] Loaded MaxMind ASN database from ${asnPath}`);
    } catch (err) {
      console.error(`[GeoIP] Error opening ASN database at ${asnPath}:`, err);
    }
  } else {
    console.warn('[GeoIP] GeoLite2-ASN.mmdb not found. ISP resolution will be unavailable until downloaded.');
  }
}

export async function checkAndUpdateGeoIp(force = false): Promise<boolean> {
  if (updateInProgress) {
    console.log('[GeoIP] Update already in progress, skipping duplicate call.');
    return false;
  }
  updateInProgress = true;
  try {
    const cityPath = findMmdbPath(CITY_DB_NAME);
    const asnPath = findMmdbPath(ASN_DB_NAME);

    const cityNeedsUpdate = force || !cityPath || isFileStale(cityPath);
    const asnNeedsUpdate = force || !asnPath || isFileStale(asnPath);

    if (!cityNeedsUpdate && !asnNeedsUpdate && cityReader && asnReader) {
      return false;
    }

    console.log(`[GeoIP] Updating databases (cityNeedsUpdate: ${cityNeedsUpdate}, asnNeedsUpdate: ${asnNeedsUpdate})...`);

    let updated = false;
    if (cityNeedsUpdate) {
      const ok = await downloadDatabase('City');
      if (ok) updated = true;
    }
    if (asnNeedsUpdate) {
      const ok = await downloadDatabase('ASN');
      if (ok) updated = true;
    }

    if (updated || !cityReader || !asnReader) {
      await reloadReaders();
      await clearStaleGeoCache();
      console.log('[GeoIP] GeoIP databases updated and readers refreshed successfully.');
    }
    return updated;
  } catch (err: any) {
    console.error('[GeoIP] Error during database update:', err.message);
    return false;
  } finally {
    updateInProgress = false;
  }
}

export async function initGeoIp(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. Try loading existing databases first
      await reloadReaders();

      const cityPath = findMmdbPath(CITY_DB_NAME);
      const asnPath = findMmdbPath(ASN_DB_NAME);

      // 2. If databases are missing or stale, trigger download in background
      if (!cityPath || !asnPath || isFileStale(cityPath) || isFileStale(asnPath)) {
        checkAndUpdateGeoIp().catch(err => {
          console.error('[GeoIP] Background initial download error:', err);
        });
      }

      // 3. Schedule regular background updates (every 24 hours)
      if (!updateTimer) {
        updateTimer = setInterval(() => {
          checkAndUpdateGeoIp().catch(err => {
            console.error('[GeoIP] Background periodic update error:', err);
          });
        }, CHECK_INTERVAL_MS);
        if (updateTimer.unref) updateTimer.unref();
      }
    } catch (err) {
      console.error('[GeoIP] Error initializing GeoIP:', err);
    } finally {
      initialized = true;
    }
  })();

  return initPromise;
}

export async function lookupIp(ip: string): Promise<IpGeoInfo> {
  if (!initialized) {
    await initGeoIp();
  }

  const cleanIp = normalizeIp(ip);

  if (isPrivateIp(cleanIp)) {
    return {
      ip: cleanIp,
      country: 'Local / Private',
      countryCode: null,
      city: null,
      isp: 'Private Network'
    };
  }

  const cacheKey = `geo:${cleanIp}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed: IpGeoInfo = JSON.parse(cached);
      // If the cached entry is empty (missing country & isp), but we now have readers loaded,
      // bypass the stale empty cache and re-resolve so the admin sees the real location & isp!
      if (!parsed.country && !parsed.isp && (cityReader || asnReader)) {
        // Discard stale empty cache and re-resolve below
      } else {
        return parsed;
      }
    }
  } catch {
    // Redis get failure should not fail request
  }

  let city: string | null = null;
  let country: string | null = null;
  let countryCode: string | null = null;
  let isp: string | null = null;

  if (cityReader) {
    try {
      const res = cityReader.get(cleanIp);
      if (res) {
        country = res.country?.names?.en || res.registered_country?.names?.en || res.continent?.names?.en || null;
        countryCode = res.country?.iso_code || res.registered_country?.iso_code || null;
        city = res.city?.names?.en || res.subdivisions?.[0]?.names?.en || null;
      }
    } catch {
      // invalid IP format or not found
    }
  }

  if (asnReader) {
    try {
      const res = asnReader.get(cleanIp);
      if (res) {
        isp = res.autonomous_system_organization || (res.autonomous_system_number ? `AS${res.autonomous_system_number}` : null);
      }
    } catch {
      // invalid IP format or not found
    }
  }

  const result: IpGeoInfo = {
    ip: cleanIp,
    city,
    country,
    countryCode,
    isp
  };

  try {
    if (result.country || result.isp) {
      // Cache valid resolution for 30 days
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400 * 30);
    } else {
      // If database is not loaded yet or lookup failed, only cache for 30 seconds
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    }
  } catch {
    // ignore redis write error
  }

  return result;
}

export function getGeoIpStatus() {
  const dir = getGeoIpDir();
  const cityPath = findMmdbPath(CITY_DB_NAME);
  const asnPath = findMmdbPath(ASN_DB_NAME);

  return {
    cityLoaded: !!cityReader,
    asnLoaded: !!asnReader,
    cityPath,
    asnPath,
    targetDir: dir,
    cityStats: cityPath && fs.existsSync(cityPath) ? {
      sizeBytes: fs.statSync(cityPath).size,
      updatedAt: fs.statSync(cityPath).mtime
    } : null,
    asnStats: asnPath && fs.existsSync(asnPath) ? {
      sizeBytes: fs.statSync(asnPath).size,
      updatedAt: fs.statSync(asnPath).mtime
    } : null,
    hasLicenseKey: !!process.env.MAXMIND_LICENSE_KEY,
    updateInProgress
  };
}
