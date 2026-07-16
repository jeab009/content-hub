import { Content } from '@prisma/client';

export class ContentResponseDto {
  id!: string;
  type!: string;
  title!: string;
  mediaUrl!: string;
  caption!: string | null;
  targetAgeMin!: number;
  targetAgeMax!: number;
  status!: string;
  licensingStatus!: string;
  licenseNotes!: string | null;
  licenseExpiresAt!: Date | null;
  fileSizeBytes!: string | null;
  mimeType!: string | null;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(content: Content): ContentResponseDto {
    const dto = new ContentResponseDto();
    dto.id = content.id;
    dto.type = content.type;
    dto.title = content.title;
    dto.mediaUrl = content.mediaUrl;
    dto.caption = content.caption;
    dto.targetAgeMin = content.targetAgeMin;
    dto.targetAgeMax = content.targetAgeMax;
    dto.status = content.status;
    dto.licensingStatus = content.licensingStatus;
    dto.licenseNotes = content.licenseNotes;
    dto.licenseExpiresAt = content.licenseExpiresAt;
    // BigInt doesn't serialize via JSON.stringify by default — stringified
    // here so the HTTP layer never has to special-case it.
    dto.fileSizeBytes = content.fileSizeBytes !== null ? content.fileSizeBytes.toString() : null;
    dto.mimeType = content.mimeType;
    dto.createdBy = content.createdBy;
    dto.createdAt = content.createdAt;
    dto.updatedAt = content.updatedAt;
    return dto;
  }
}
