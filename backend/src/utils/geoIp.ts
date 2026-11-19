import path from 'path';
import fs from 'fs';
import maxmind, { type CityResponse, type AsnResponse, type Reader } from 'maxmind';
import { redis } from '../config/redis';

export interface IpGeoInfo {
  ip: string;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  isp: string | null;
}

let cityReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

function findMmdbPath(filename: string): string | null {
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

export async function initGeoIp(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const cityPath = findMmdbPath('GeoLite2-City.mmdb');
      if (cityPath) {
        cityReader = await maxmind.open<CityResponse>(cityPath);
        console.log(`[GeoIP] Loaded MaxMind City database from ${cityPath}`);
      } else {
        console.warn('[GeoIP] GeoLite2-City.mmdb not found. Place it in volumes/geoip/ or backend/geoip/ to enable location resolution.');
      }

      const asnPath = findMmdbPath('GeoLite2-ASN.mmdb');
      if (asnPath) {
        asnReader = await maxmind.open<AsnResponse>(asnPath);
        console.log(`[GeoIP] Loaded MaxMind ASN database from ${asnPath}`);
      } else {
        console.warn('[GeoIP] GeoLite2-ASN.mmdb not found. Place it in volumes/geoip/ or backend/geoip/ to enable ISP resolution.');
      }
    } catch (err) {
      console.error('[GeoIP] Error initializing MaxMind reader:', err);
    } finally {
      initialized = true;
    }
  })();

  return initPromise;
}

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.') || ip.startsWith('127.')) return true;
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    if (parts.length >= 2) {
      const sec = parseInt(parts[1], 10);
      if (sec >= 16 && sec <= 31) return true;
    }
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

export async function lookupIp(ip: string): Promise<IpGeoInfo> {
  if (!initialized) {
    await initGeoIp();
  }

  if (isPrivateIp(ip)) {
    return {
      ip,
      country: 'Local / Private',
      countryCode: null,
      city: null,
      isp: 'Private Network'
    };
  }

  const cacheKey = `geo:${ip}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
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
      const res = cityReader.get(ip);
      if (res) {
        country = res.country?.names?.en || null;
        countryCode = res.country?.iso_code || null;
        city = res.city?.names?.en || res.subdivisions?.[0]?.names?.en || null;
      }
    } catch {
      // invalid IP format or not found
    }
  }

  if (asnReader) {
    try {
      const res = asnReader.get(ip);
      if (res) {
        isp = res.autonomous_system_organization || (res.autonomous_system_number ? `AS${res.autonomous_system_number}` : null);
      }
    } catch {
      // invalid IP format or not found
    }
  }

  const result: IpGeoInfo = {
    ip,
    city,
    country,
    countryCode,
    isp
  };

  try {
    // Cache for 30 days
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400 * 30);
  } catch {
    // ignore redis write error
  }

  return result;
}
