import { ConfigService } from '@nestjs/config';
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
  UploadValidationService,
  sniffMimeType,
} from './upload-validation.service';

const MAX_IMAGE_BYTES = 1024;
const MAX_VIDEO_BYTES = 4096;

function fakeConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue({
      upload: { maxImageBytes: MAX_IMAGE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES },
    }),
  } as unknown as ConfigService;
}

/** A structurally valid buffer of `size` bytes starting with real JPEG magic bytes. */
function jpegBuffer(size = 64): Buffer {
  const buffer = Buffer.alloc(size);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  return buffer;
}

function pngBuffer(size = 64): Buffer {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}

function mp4Buffer(size = 64): Buffer {
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32BE(size, 0); // box size
  buffer.write('ftypisom', 4, 'ascii'); // box type + major brand
  return buffer;
}

describe('sniffMimeType (magic-byte detection)', () => {
  it('detects JPEG from its signature', () => {
    expect(sniffMimeType(jpegBuffer())).toEqual(
      expect.objectContaining({ mimeType: 'image/jpeg', extension: 'jpg', category: 'image' }),
    );
  });

  it('detects PNG from its signature', () => {
    expect(sniffMimeType(pngBuffer())).toEqual(
      expect.objectContaining({ mimeType: 'image/png', extension: 'png', category: 'image' }),
    );
  });

  it('detects MP4 from its ftyp box', () => {
    expect(sniffMimeType(mp4Buffer())).toEqual(
      expect.objectContaining({ mimeType: 'video/mp4', extension: 'mp4', category: 'video' }),
    );
  });

  it('returns null for plain text regardless of any claimed Content-Type', () => {
    expect(sniffMimeType(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBeNull();
  });

  it('returns null for a GIF (off the allow-list)', () => {
    expect(sniffMimeType(Buffer.from('GIF89a............'))).toBeNull();
  });

  it('returns null for an empty/truncated buffer', () => {
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
    expect(sniffMimeType(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG cut short
  });
});

describe('UploadValidationService', () => {
  let service: UploadValidationService;

  beforeEach(() => {
    service = new UploadValidationService(fakeConfigService());
  });

  it('accepts a JPEG within the image size limit', () => {
    expect(service.validate(jpegBuffer(MAX_IMAGE_BYTES)).mimeType).toBe('image/jpeg');
  });

  it('accepts a PNG within the image size limit', () => {
    expect(service.validate(pngBuffer()).mimeType).toBe('image/png');
  });

  it('accepts an MP4 within the video size limit', () => {
    expect(service.validate(mp4Buffer(MAX_VIDEO_BYTES)).mimeType).toBe('video/mp4');
  });

  it('rejects a spoofed upload whose bytes are not a real JPEG/PNG/MP4', () => {
    // Simulates Content-Type: image/jpeg + photo.jpg filename with a script
    // body — the service never sees (or trusts) either, only the bytes.
    expect(() => service.validate(Buffer.from('<script>alert(1)</script>'))).toThrow(
      UnsupportedFileTypeError,
    );
  });

  it('rejects an image over the image limit', () => {
    expect(() => service.validate(jpegBuffer(MAX_IMAGE_BYTES + 1))).toThrow(FileTooLargeError);
  });

  it('applies the video (not image) ceiling to MP4s — larger than an image may be, still accepted', () => {
    expect(service.validate(mp4Buffer(MAX_IMAGE_BYTES + 1)).mimeType).toBe('video/mp4');
  });

  it('rejects a video over the video limit', () => {
    expect(() => service.validate(mp4Buffer(MAX_VIDEO_BYTES + 1))).toThrow(FileTooLargeError);
  });

  it('exposes the larger ceiling as the stream-level multer cap', () => {
    expect(service.streamLevelMaxBytes).toBe(MAX_VIDEO_BYTES);
  });

  it('refuses to construct when app config is missing', () => {
    const emptyConfig = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    expect(() => new UploadValidationService(emptyConfig)).toThrow('App config not loaded');
  });
});
