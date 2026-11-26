import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { query } from '../../config/db';
import { logger } from '../../utils/logger';

const execFileAsync = promisify(execFile);

export interface CaesiumConfig {
  enabled: boolean;
  mode?: 'lossy' | 'lossless' | 'max_size';
  quality?: number; // 1-100, default 80
  max_size?: string; // e.g. '1MB', '500KB'
  width?: number | null;
  height?: number | null;
  keep_exif?: boolean; // default true
  keep_dates?: boolean; // default true
}

export const DEFAULT_CAESIUM_CONFIG: CaesiumConfig = {
  enabled: true,
  mode: 'lossy',
  quality: 80,
  max_size: '1MB',
  width: null,
  height: null,
  keep_exif: true,
  keep_dates: true
};

const SETTINGS_KEY = 'gdrive_caesium_default_config';

export class CaesiumService {
  private static cachedBinaryPath: string | null = null;

  /**
   * Resolve path to the caesiumclt binary.
   */
  static getBinaryPath(): string {
    if (this.cachedBinaryPath) {
      return this.cachedBinaryPath;
    }

    if (process.env.CAESIUM_BIN_PATH && fs.existsSync(process.env.CAESIUM_BIN_PATH)) {
      this.cachedBinaryPath = process.env.CAESIUM_BIN_PATH;
      return this.cachedBinaryPath;
    }

    const candidatePaths = [
      '/usr/local/bin/caesiumclt',
      '/usr/local/bin/caesium-clt',
      '/usr/bin/caesiumclt',
      '/opt/homebrew/bin/caesiumclt'
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        this.cachedBinaryPath = p;
        return this.cachedBinaryPath;
      }
    }

    // Default to PATH lookup
    return 'caesiumclt';
  }

  /**
   * Check if caesiumclt is installed and accessible.
   */
  static async isAvailable(): Promise<{ available: boolean; version?: string; binaryPath?: string }> {
    const bin = this.getBinaryPath();
    try {
      const { stdout } = await execFileAsync(bin, ['--version']);
      const versionStr = stdout.trim();
      return { available: true, version: versionStr, binaryPath: bin };
    } catch (err: any) {
      logger.warn(`[Caesium] caesiumclt check failed (${bin}): ${err.message}`);
      return { available: false };
    }
  }

  /**
   * Check if a file is supported by Caesium Image Compressor.
   */
  static isSupported(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'].includes(ext);
  }

  /**
   * Retrieve remembered default parameters from admin_settings.
   */
  static async getDefaultConfig(): Promise<CaesiumConfig> {
    try {
      const res = await query(`SELECT value FROM admin_settings WHERE key = $1`, [SETTINGS_KEY]);
      if (res.rows.length > 0 && res.rows[0].value) {
        return {
          ...DEFAULT_CAESIUM_CONFIG,
          ...res.rows[0].value
        };
      }
    } catch (err: any) {
      logger.warn(`[Caesium] Failed to load default config: ${err.message}`);
    }
    return { ...DEFAULT_CAESIUM_CONFIG };
  }

  /**
   * Persist default parameters in admin_settings to remember for future folders.
   */
  static async saveDefaultConfig(config: Partial<CaesiumConfig>): Promise<CaesiumConfig> {
    const current = await this.getDefaultConfig();
    const updated: CaesiumConfig = {
      ...current,
      ...config,
      // Normalize values
      enabled: config.enabled !== undefined ? Boolean(config.enabled) : current.enabled,
      mode: config.mode || current.mode || 'lossy',
      quality: config.quality !== undefined ? Math.min(100, Math.max(1, Number(config.quality))) : current.quality,
      max_size: config.max_size ? String(config.max_size).trim() : current.max_size,
      width: config.width ? Math.round(Number(config.width)) : null,
      height: config.height ? Math.round(Number(config.height)) : null,
      keep_exif: config.keep_exif !== undefined ? Boolean(config.keep_exif) : true,
      keep_dates: config.keep_dates !== undefined ? Boolean(config.keep_dates) : true
    };

    await query(
      `INSERT INTO admin_settings (key, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEY, JSON.stringify(updated)]
    );

    return updated;
  }

  /**
   * Compresses an image file using caesiumclt into a dedicated temporary directory.
   */
  static async compressImage(
    inputFilePath: string,
    config: Partial<CaesiumConfig>
  ): Promise<{
    outputPath: string;
    tempDir: string;
    originalSize: number;
    outputSize: number;
    savingsPercent: string;
  }> {
    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`Input file does not exist: ${inputFilePath}`);
    }

    const bin = this.getBinaryPath();
    const originalStats = fs.statSync(inputFilePath);
    const fileName = path.basename(inputFilePath);

    // Create unique temporary output directory
    const tempDir = path.join(os.tmpdir(), `caesium_${crypto.randomUUID()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const expectedOutputFile = path.join(tempDir, fileName);

    // Build caesiumclt command line arguments
    const args: string[] = [];

    const mode = config.mode || 'lossy';
    if (mode === 'lossless') {
      args.push('--lossless');
    } else if (mode === 'max_size' && config.max_size) {
      args.push('--max-size', String(config.max_size).trim());
    } else {
      const q = Math.min(100, Math.max(1, Number(config.quality) || 80));
      args.push('-q', String(q));
    }

    if (config.width && Number(config.width) > 0) {
      args.push('--width', String(Math.round(Number(config.width))), '--no-upscale');
    }

    if (config.height && Number(config.height) > 0) {
      args.push('--height', String(Math.round(Number(config.height))), '--no-upscale');
    }

    if (config.keep_exif !== false) {
      args.push('-e');
    }

    if (config.keep_dates !== false) {
      args.push('--keep-dates');
    }

    args.push('-O', 'all');
    args.push('-o', tempDir);
    args.push(inputFilePath);

    try {
      await execFileAsync(bin, args, { timeout: 60000 });

      if (!fs.existsSync(expectedOutputFile)) {
        throw new Error(`Caesium finished but output file not found at ${expectedOutputFile}`);
      }

      const outStats = fs.statSync(expectedOutputFile);
      const originalSize = originalStats.size;
      const outputSize = outStats.size;

      let savingsPercent = '0%';
      if (originalSize > 0) {
        const diff = originalSize - outputSize;
        const pct = ((diff / originalSize) * 100).toFixed(1);
        savingsPercent = `${pct}%`;
      }

      return {
        outputPath: expectedOutputFile,
        tempDir,
        originalSize,
        outputSize,
        savingsPercent
      };
    } catch (err: any) {
      // Clean up on failure
      await this.cleanupTempDir(tempDir);
      throw err;
    }
  }

  /**
   * Safely cleans up temporary directory.
   */
  static async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    } catch (err: any) {
      logger.warn(`[Caesium] Failed to clean up temp dir ${tempDir}: ${err.message}`);
    }
  }

  /**
   * Purge any stale caesium temporary directories left over from abrupt server restarts or killed jobs.
   */
  static async cleanupStaleTempDirs(maxAgeMs = 3600000): Promise<void> {
    try {
      const tmpBase = os.tmpdir();
      const entries = await fs.promises.readdir(tmpBase);
      const now = Date.now();
      for (const entry of entries) {
        if (entry.startsWith('caesium_')) {
          const fullPath = path.join(tmpBase, entry);
          try {
            const stats = await fs.promises.stat(fullPath);
            if (now - stats.mtimeMs > maxAgeMs) {
              await fs.promises.rm(fullPath, { recursive: true, force: true });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      logger.warn(`[Caesium] Stale temp cleanup warning: ${err.message}`);
    }
  }
}
