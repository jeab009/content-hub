import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../../config/configuration';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ContentAssetService } from './content-asset.service';
import { CopyrightGateService } from './copyright-gate.service';
import { UploadValidationService } from './upload-validation.service';
import { LocalDiskStorageAdapter } from './storage/local-disk-storage.service';
import { STORAGE_ADAPTER } from './storage/storage-adapter.interface';

/**
 * Phase 2 CMS module: content CRUD, multipart upload (magic-byte validated,
 * local-disk stored behind the StorageAdapter seam), per-platform content
 * assets, and the copyright gate that makes `ready` unreachable while
 * `copyrightCleared != cleared`.
 *
 * Multer is configured with NO `storage`/`dest` option on purpose — that is
 * multer's documented memory-storage mode, which hands the handler a
 * `buffer` (required for magic-byte sniffing) and never writes a temp file
 * with a client-controlled name to disk. The stream-level `fileSize` cap is
 * the larger of the two category ceilings; the exact per-category limit is
 * enforced after sniffing in UploadValidationService.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig>('app');
        if (!appConfig) {
          throw new Error('App config not loaded');
        }
        return {
          limits: {
            fileSize: Math.max(appConfig.upload.maxImageBytes, appConfig.upload.maxVideoBytes),
            files: 1,
          },
        };
      },
    }),
  ],
  controllers: [ContentController],
  providers: [
    ContentService,
    ContentAssetService,
    CopyrightGateService,
    UploadValidationService,
    AdminGuard,
    { provide: STORAGE_ADAPTER, useClass: LocalDiskStorageAdapter },
  ],
  exports: [ContentService, CopyrightGateService],
})
export class ContentModule {}
