import {
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
} from '@prisma/client';
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

/** All fields optional — partial update (edit modal reuses the create form's field set). */
export class UpdateContentDto {
  @IsOptional()
  @IsEnum(ContentType)
  type?: ContentType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  targetAgeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  targetAgeMax?: number;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsEnum(LicensingStatus)
  licensingStatus?: LicensingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  licenseNotes?: string;

  @IsOptional()
  @IsDateString()
  licenseExpiresAt?: string;

  // --- Phase 2 compliance fields. Setting `copyrightCleared: cleared` must
  // pass the copyright gate, and setting `status: ready` additionally
  // requires the (merged) record to already be cleared — see ContentService.
  @IsOptional()
  @IsEnum(ContentPillar)
  contentPillar?: ContentPillar;

  @IsOptional()
  @IsEnum(CopyrightClearance)
  copyrightCleared?: CopyrightClearance;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  copyrightNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  copyrightEvidenceUrl?: string;
}
