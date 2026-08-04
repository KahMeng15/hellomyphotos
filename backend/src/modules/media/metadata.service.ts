import exifr from 'exifr';
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
  width?: number | null;
  height?: number | null;
  [key: string]: any;
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
            reviveValues: true,
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

            const timestamp = rawData.DateTimeOriginal || rawData.CreateDate || rawData.ModifyDate || rawData.dateTimeOriginal || null;
            const width = rawData.ExifImageWidth || rawData.ImageWidth || rawData.width || rawData.OrientedWidth || null;
            const height = rawData.ExifImageHeight || rawData.ImageHeight || rawData.height || rawData.OrientedHeight || null;

            exifJson = {
              camera,
              make,
              model,
              iso,
              aperture,
              focalLength,
              gps,
              latitude,
              longitude,
              timestamp,
              width,
              height,
            };
          }
        } catch (exifErr: any) {
          console.warn(`[MetadataService] EXIF parse warning for ${fullPath}:`, exifErr.message);
        }
      }

      await query(
        `UPDATE media_files SET exif_json = $1, updated_at = NOW() WHERE id = $2`,
        [exifJson ? JSON.stringify(exifJson) : '{}', mediaId]
      );

      return exifJson;
    } catch (err: any) {
      console.error(`[MetadataService] Failed for mediaId ${mediaId}:`, err.message);
      return null;
    }
  }
}
