import exifr from 'exifr';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import { query } from '../../config/db';

export interface ExifMetadata {
  camera?: string | null;
  make?: string | null;
  model?: string | null;
  iso?: number | null;
  aperture?: number | null;
  focalLength?: number | null;
  gps?: { latitude: number; longitude: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp?: string | Date | null;
  dateTimeOriginal?: string | Date | null;
  DateTimeOriginal?: string | Date | null;
  createDate?: string | Date | null;
  CreateDate?: string | Date | null;
  modifyDate?: string | Date | null;
  ModifyDate?: string | Date | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  [key: string]: any;
}

export function parseExifDateTime(dateVal: any, offsetVal?: string | null): string | null {
  if (!dateVal) return null;

  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = dateVal.getUTCFullYear();
    const m = pad(dateVal.getUTCMonth() + 1);
    const d = pad(dateVal.getUTCDate());
    const hh = pad(dateVal.getUTCHours());
    const mm = pad(dateVal.getUTCMinutes());
    const ss = pad(dateVal.getUTCSeconds());
    const base = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
    if (offsetVal && /^[+-]\d{2}:?\d{2}$/.test(offsetVal.trim())) {
      const off = offsetVal.trim();
      return `${base}${off.includes(':') ? off : off.slice(0, 3) + ':' + off.slice(3)}`;
    }
    return base;
  }

  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    const match = trimmed.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(.*)$/);
    if (match) {
      const [, y, m, d, hh, mm, ss, ms, existingOffset] = match;
      const base = `${y}-${m}-${d}T${hh}:${mm}:${ss}${ms ? '.' + ms : ''}`;
      if (existingOffset && existingOffset.trim() && existingOffset.trim() !== 'Z') {
        return `${base}${existingOffset.trim()}`;
      }
      if (offsetVal && /^[+-]\d{2}:?\d{2}$/.test(offsetVal.trim())) {
        const off = offsetVal.trim();
        return `${base}${off.includes(':') ? off : off.slice(0, 3) + ':' + off.slice(3)}`;
      }
      return base;
    }
    return trimmed;
  }

  return null;
}

export class MetadataService {
  static async extractMetadata(mediaId: string, fullPath: string, mimeType?: string): Promise<ExifMetadata | null> {
    if (!fullPath) return null;

    try {
      const isImage = mimeType ? mimeType.startsWith('image/') : !mimeType?.startsWith('video/');
      let exifJson: ExifMetadata | null = null;

      if (isImage) {
        try {
          const rawData = await exifr.parse(fullPath, {
            tiff: true,
            exif: true,
            gps: true,
            translateKeys: true,
            translateValues: true,
            reviveValues: false,
          });

          if (rawData) {
            const make = rawData.Make || rawData.make || null;
            const model = rawData.Model || rawData.model || null;
            let camera: string | null = null;
            if (make && model) {
              camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
            } else {
              camera = model || make || null;
            }

            const iso = rawData.ISO || rawData.Iso || rawData.iso || null;
            const aperture = rawData.FNumber || rawData.ApertureValue || rawData.aperture || null;
            const focalLength = rawData.FocalLength || rawData.focalLength || null;
            const exposureTime = rawData.ExposureTime || rawData.exposureTime || null;
            const lensModel = rawData.LensModel || rawData.lensModel || null;
            
            let gps: { latitude: number; longitude: number } | null = null;
            let latitude: number | null = null;
            let longitude: number | null = null;

            if (rawData.latitude !== undefined && rawData.longitude !== undefined && rawData.latitude !== null && rawData.longitude !== null) {
              latitude = Number(rawData.latitude);
              longitude = Number(rawData.longitude);
              gps = { latitude, longitude };
            } else if (rawData.GPSLatitude !== undefined && rawData.GPSLongitude !== undefined && rawData.GPSLatitude !== null && rawData.GPSLongitude !== null) {
              latitude = Number(rawData.GPSLatitude);
              longitude = Number(rawData.GPSLongitude);
              gps = { latitude, longitude };
            }

            const offset = rawData.OffsetTimeOriginal || rawData.OffsetTime || rawData.OffsetTimeDigitized || null;
            const dtOriginal = parseExifDateTime(rawData.DateTimeOriginal || rawData.dateTimeOriginal, offset);
            const createDate = parseExifDateTime(rawData.CreateDate || rawData.createDate, offset);
            const modifyDate = parseExifDateTime(rawData.ModifyDate || rawData.modifyDate, offset);
            const timestamp = dtOriginal || createDate || modifyDate || null;

            const width = rawData.ExifImageWidth || rawData.ImageWidth || rawData.width || rawData.OrientedWidth || null;
            const height = rawData.ExifImageHeight || rawData.ImageHeight || rawData.height || rawData.OrientedHeight || null;

            exifJson = {
              camera,
              make,
              model,
              lensModel,
              iso,
              aperture,
              fNumber: aperture,
              exposureTime,
              focalLength,
              gps,
              latitude,
              longitude,
              timestamp,
              dateTimeOriginal: dtOriginal,
              DateTimeOriginal: dtOriginal,
              createDate: createDate || dtOriginal,
              CreateDate: createDate || dtOriginal,
              modifyDate,
              ModifyDate: modifyDate,
              width,
              height,
            };
          }
        } catch (exifErr: any) {
          console.warn(`[MetadataService] EXIF parse warning for ${fullPath}:`, exifErr.message);
        }
      } else {
        try {
          let videoDate: string | null = null;
          let width: number | null = null;
          let height: number | null = null;
          let duration: number | null = null;
          let camera: string | null = null;
          let make: string | null = null;
          let model: string | null = null;
          let gps: { latitude: number; longitude: number } | null = null;
          let latitude: number | null = null;
          let longitude: number | null = null;

          try {
            const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
              ffmpeg.ffprobe(fullPath, (err, data) => err ? reject(err) : resolve(data));
            });

            const formatTags: Record<string, any> = probeData.format?.tags || {};
            const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
            const streamTags: Record<string, any> = videoStream?.tags || {};

            if (probeData.format?.duration) {
              duration = parseFloat(String(probeData.format.duration));
            }

            if (videoStream?.width && videoStream?.height) {
              const rotate = streamTags.rotate || formatTags.rotate;
              if (rotate === '90' || rotate === '270' || rotate === 90 || rotate === 270) {
                width = videoStream.height;
                height = videoStream.width;
              } else {
                width = videoStream.width;
                height = videoStream.height;
              }
            }

            make = formatTags['com.apple.quicktime.make'] || formatTags.make || null;
            model = formatTags['com.apple.quicktime.model'] || formatTags.model || null;
            if (make && model) {
              camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
            } else {
              camera = model || make || null;
            }

            const locationTag = formatTags['com.apple.quicktime.location.ISO6709'] || formatTags.location;
            if (locationTag && typeof locationTag === 'string') {
              const locMatch = locationTag.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
              if (locMatch) {
                latitude = parseFloat(locMatch[1]);
                longitude = parseFloat(locMatch[2]);
                gps = { latitude, longitude };
              }
            }

            const rawCreationDate = formatTags['com.apple.quicktime.creationdate'] ||
                                    formatTags.creation_time ||
                                    streamTags.creation_time ||
                                    formatTags.date ||
                                    formatTags.DateTimeOriginal;

            if (rawCreationDate) {
              videoDate = parseExifDateTime(rawCreationDate);
            }
          } catch (probeErr: any) {
            console.warn(`[MetadataService] ffprobe warning for ${fullPath}:`, probeErr.message);
          }

          if (!videoDate) {
            try {
              const stat = await fs.promises.stat(fullPath);
              videoDate = stat.mtime.toISOString();
            } catch (statErr: any) {
              console.warn(`[MetadataService] fs.stat fallback warning for ${fullPath}:`, statErr.message);
            }
          }

          exifJson = {
            camera,
            make,
            model,
            width,
            height,
            duration,
            createDate: videoDate,
            CreateDate: videoDate,
            dateTimeOriginal: videoDate,
            DateTimeOriginal: videoDate,
            timestamp: videoDate,
            gps,
            latitude,
            longitude,
          };
        } catch (videoErr: any) {
          console.warn(`[MetadataService] Video metadata warning for ${fullPath}:`, videoErr.message);
        }
      }

      const width = exifJson?.width || null;
      const height = exifJson?.height || null;
      await query(
        `UPDATE media_files 
         SET exif_json = $1, 
             img_width = COALESCE(img_width, $2), 
             img_height = COALESCE(img_height, $3), 
             updated_at = NOW() 
         WHERE id = $4`,
        [exifJson ? JSON.stringify(exifJson) : '{}', width, height, mediaId]
      );

      return exifJson;
    } catch (err: any) {
      console.error(`[MetadataService] Failed for mediaId ${mediaId}:`, err.message);
      return null;
    }
  }
}
