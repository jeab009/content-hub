export class UploadResponseDto {
  mediaUrl!: string;
  fileSizeBytes!: number;
  mimeType!: string;
  /**
   * Best-effort MP4 duration (Phase 6, WBS 6A.6) — null for images and for
   * any video whose duration could not be parsed. Courtesy information only;
   * the Shopee placement boundary re-derives/re-validates it server-side
   * rather than trusting this value (same rule as wasOverride).
   */
  durationSeconds!: number | null;
}
