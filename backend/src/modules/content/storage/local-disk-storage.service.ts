import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppConfig } from '../../../config/configuration';
import { StorageAdapter, StoredFile } from './storage-adapter.interface';

/**
 * Local-disk StorageAdapter for the demo deployment. Filenames are always
 * `${randomUUID()}.${extension}` — never derived from the client-supplied
 * original filename — which is what prevents path traversal
 * (`../../etc/passwd`) and null-byte/extension-spoofing tricks regardless of
 * what a malicious client sends as the upload's filename (security
 * condition #1). `extension` itself is only ever one of the fixed
 * server-resolved values from UploadValidationService, never client input.
 */
@Injectable()
export class LocalDiskStorageAdapter implements StorageAdapter {
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);
  private readonly storageDir: string;

  constructor(configService: ConfigService) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) {
      throw new Error('App config not loaded');
    }
    this.storageDir = resolve(appConfig.upload.storageDir);
  }

  async save(buffer: Buffer, opts: { mimeType: string; extension: string }): Promise<StoredFile> {
    await mkdir(this.storageDir, { recursive: true });

    const filename = `${randomUUID()}.${opts.extension}`;
    const destination = resolve(this.storageDir, filename);

    // Defense in depth: resolve() above already strips any `..` segments
    // from a well-formed extension, but confirm the final path never
    // escapes storageDir before writing, in case opts.extension is ever
    // widened carelessly in the future.
    if (!destination.startsWith(this.storageDir)) {
      throw new Error('Resolved upload destination escaped the storage directory');
    }

    await writeFile(destination, buffer);
    this.logger.log(`Stored upload as ${filename} (${buffer.length} bytes, ${opts.mimeType})`);

    return {
      mediaUrl: `/uploads/${filename}`,
      fileSizeBytes: buffer.length,
      mimeType: opts.mimeType,
    };
  }
}
