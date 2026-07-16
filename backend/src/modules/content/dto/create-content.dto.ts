import { ContentType, LicensingStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_AGE = 120;

export class CreateContentDto {
  @IsEnum(ContentType)
  type!: ContentType;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  // Populated from the upload step's response (POST /content/upload),
  // never taken as an arbitrary client-supplied external URL — the
  // controller only accepts a mediaUrl that matches the local storage
  // adapter's own `/uploads/...` prefix (see ContentService.assertMediaUrlIsOwned).
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  mediaUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  targetAgeMin!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  targetAgeMax!: number;

  @IsEnum(LicensingStatus)
  licensingStatus!: LicensingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  licenseNotes?: string;

  @IsOptional()
  @IsDateString()
  licenseExpiresAt?: string;

  /** true = create directly as `ready`; false/omitted = `draft` ("Save Draft" vs "Mark Ready"). */
  @IsOptional()
  markReady?: boolean;

  @IsOptional()
  @IsInt()
  fileSizeBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;
}
