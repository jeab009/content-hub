import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ContentService } from './content.service';
import { ContentAssetService } from './content-asset.service';
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
  UploadValidationService,
  ValidatedUpload,
} from './upload-validation.service';
import { STORAGE_ADAPTER, StorageAdapter } from './storage/storage-adapter.interface';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentQueryDto } from './dto/list-content-query.dto';
import { CreateContentAssetDto } from './dto/create-content-asset.dto';
import { ContentResponseDto } from './dto/content-response.dto';
import { ContentAssetResponseDto } from './dto/content-asset-response.dto';
import { UploadResponseDto } from './dto/upload-response.dto';

/**
 * Minimal shape of the multer memory-storage file object this controller
 * consumes. Declared locally instead of using `Express.Multer.File` so the
 * build doesn't need `@types/multer` (multer itself ships with
 * `@nestjs/platform-express`) — only these fields are ever read, and
 * `originalname` is deliberately NOT among them: the client-supplied
 * filename is never trusted or used (see LocalDiskStorageAdapter).
 */
interface UploadedMultipartFile {
  buffer: Buffer;
  size: number;
}

/**
 * Phase 2 CMS API. Guard stack per the approved security model:
 * - SessionAuthGuard (authentication) + AdminGuard (authorization,
 *   role re-read from DB) on every route, and
 * - CsrfGuard on every mutating route (same pattern as
 *   ConnectedAccountsController's DELETE).
 */
@Controller('api/contents')
@UseGuards(SessionAuthGuard, AdminGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentAssetService: ContentAssetService,
    private readonly uploadValidationService: UploadValidationService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @Body() dto: CreateContentDto,
    @CurrentUserId() userId: string,
  ): Promise<ContentResponseDto> {
    const content = await this.contentService.create(dto, userId);
    return ContentResponseDto.fromEntity(content);
  }

  /**
   * Multipart upload → magic-byte validation → storage adapter. Declared
   * before the `:id` routes so the literal `upload` segment can never be
   * captured as a content id. The FileInterceptor's stream-level size cap
   * comes from MulterModule registration in ContentModule.
   */
  @Post('upload')
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @CurrentUserId() userId: string,
  ): Promise<UploadResponseDto> {
    if (!file?.buffer) {
      throw new BadRequestException('Missing multipart file field "file"');
    }

    let validated: ValidatedUpload;
    try {
      validated = this.uploadValidationService.validate(file.buffer);
    } catch (error) {
      throw this.toUploadHttpError(error, userId);
    }

    const stored = await this.storage.save(file.buffer, {
      mimeType: validated.mimeType,
      extension: validated.extension,
    });

    this.auditLog.record({
      actor: userId,
      action: 'content_uploaded',
      result: 'success',
      meta: { mediaUrl: stored.mediaUrl, mimeType: stored.mimeType, bytes: stored.fileSizeBytes },
    });

    return { ...stored, durationSeconds: validated.durationSeconds };
  }

  @Get()
  async list(@Query() query: ListContentQueryDto): Promise<ContentResponseDto[]> {
    const contents = await this.contentService.list(query);
    return contents.map(ContentResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ContentResponseDto> {
    return ContentResponseDto.fromEntity(await this.contentService.findOne(id));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContentDto,
    @CurrentUserId() userId: string,
  ): Promise<ContentResponseDto> {
    return ContentResponseDto.fromEntity(await this.contentService.update(id, dto, userId));
  }

  /** Soft delete: archives the content (status = archived), never a hard DELETE row removal. */
  @Delete(':id')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.contentService.archive(id, userId);
  }

  @Post(':id/assets')
  @UseGuards(CsrfGuard)
  async addAsset(
    @Param('id', ParseUUIDPipe) contentId: string,
    @Body() dto: CreateContentAssetDto,
    @CurrentUserId() userId: string,
  ): Promise<ContentAssetResponseDto> {
    const asset = await this.contentAssetService.add(contentId, dto, userId);
    return ContentAssetResponseDto.fromEntity(asset);
  }

  @Get(':id/assets')
  async listAssets(
    @Param('id', ParseUUIDPipe) contentId: string,
  ): Promise<ContentAssetResponseDto[]> {
    const assets = await this.contentAssetService.list(contentId);
    return assets.map(ContentAssetResponseDto.fromEntity);
  }

  @Delete(':id/assets/:assetId')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsset(
    @Param('id', ParseUUIDPipe) contentId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.contentAssetService.remove(contentId, assetId, userId);
  }

  /**
   * Maps the upload validator's domain errors to HTTP errors (400/413) and
   * audits the rejection; anything unexpected is rethrown untouched for the
   * global RedactingExceptionFilter to handle as a 500.
   */
  private toUploadHttpError(error: unknown, userId: string): HttpException {
    if (error instanceof UnsupportedFileTypeError) {
      this.auditUploadRejection(userId, 'unsupported_file_type');
      return new BadRequestException(error.message);
    }
    if (error instanceof FileTooLargeError) {
      this.auditUploadRejection(userId, 'file_too_large');
      return new PayloadTooLargeException(error.message);
    }
    throw error;
  }

  private auditUploadRejection(userId: string, reason: string): void {
    this.auditLog.record({
      actor: userId,
      action: 'content_uploaded',
      result: 'failure',
      meta: { reason },
    });
  }
}
