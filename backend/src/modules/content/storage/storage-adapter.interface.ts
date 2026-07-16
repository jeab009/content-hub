/** Result of persisting an uploaded file through a StorageAdapter. */
export interface StoredFile {
  mediaUrl: string;
  fileSizeBytes: number;
  mimeType: string;
}

/**
 * Storage seam for uploaded content files. `LocalDiskStorageAdapter` is the
 * only implementation wired up for this demo; the interface is shaped so a
 * future S3/GCS-backed adapter (`save` returning a signed/public URL instead
 * of a local path) can be swapped in without touching ContentService or the
 * controller — same pattern as PublisherPort for platform adapters.
 */
export interface StorageAdapter {
  /**
   * Persists `buffer` under a server-generated name. `extension` MUST come
   * from a fixed allow-list resolved server-side from the sniffed MIME type
   * (never from the client-supplied filename) — see UploadValidationService.
   */
  save(buffer: Buffer, opts: { mimeType: string; extension: string }): Promise<StoredFile>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
