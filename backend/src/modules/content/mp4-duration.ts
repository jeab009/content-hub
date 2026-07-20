/**
 * Best-effort MP4 duration parser (Phase 6, WBS 6A.6).
 *
 * Reads the `moov > mvhd` atom's `timescale` + `duration` fields and returns
 * whole seconds. Same spirit and neighbourhood as the hand-rolled magic-byte
 * sniffer in `upload-validation.service.ts` — no `ffprobe`/`ffmpeg` binary in
 * the container (the same reasoning that chose `pdfkit` over headless Chrome
 * in Phase 5).
 *
 * NEVER THROWS. Any failure — truncated buffer, absent `moov`/`mvhd` box, a
 * fragmented MP4 reporting duration 0, an unexpected `mvhd` version, a
 * corrupt box size — returns `null`, not an error. This is what backs risk
 * R7: duration capture must NEVER block an upload. Facebook/YouTube/TikTok/
 * LINE have no duration requirement at all, so `UploadValidationService`'s
 * existing behaviour for them must be unchanged whether this returns a
 * number or `null` — see `upload-validation.service.spec.ts`, which passes
 * with zero edits.
 */

const BOX_HEADER_SIZE = 8;
/** `size==1` means the box uses a 64-bit "largesize" field right after the header. */
const EXTENDED_SIZE_MARKER = 1;
/** `size==0` means "this box extends to the end of the enclosing range". */
const TO_END_OF_RANGE_MARKER = 0;

interface Mp4Box {
  type: string;
  /** Offset of the first byte AFTER the header (and largesize, if present). */
  bodyStart: number;
  /** Exclusive end offset of the whole box. */
  end: number;
}

/** Reads one box header at `offset`, bounded by `limit`. Returns null on any malformed input. */
function readBoxAt(buffer: Buffer, offset: number, limit: number): Mp4Box | null {
  if (offset < 0 || offset + BOX_HEADER_SIZE > limit) {
    return null;
  }

  const declaredSize = buffer.readUInt32BE(offset);
  const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');

  if (declaredSize === EXTENDED_SIZE_MARKER) {
    return readExtendedSizeBox(buffer, offset, limit, type);
  }

  const end = declaredSize === TO_END_OF_RANGE_MARKER ? limit : offset + declaredSize;
  if (end <= offset || end > limit) {
    return null;
  }
  return { type, bodyStart: offset + BOX_HEADER_SIZE, end };
}

function readExtendedSizeBox(
  buffer: Buffer,
  offset: number,
  limit: number,
  type: string,
): Mp4Box | null {
  const largeSizeOffset = offset + BOX_HEADER_SIZE;
  if (largeSizeOffset + 8 > limit) {
    return null;
  }
  const largeSize = buffer.readBigUInt64BE(largeSizeOffset);
  if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const end = offset + Number(largeSize);
  if (end <= offset || end > limit) {
    return null;
  }
  return { type, bodyStart: largeSizeOffset + 8, end };
}

/** Scans sibling boxes within `[start, limit)` for the first one of `type`. */
function findBox(buffer: Buffer, start: number, limit: number, type: string): Mp4Box | null {
  let offset = start;
  while (offset < limit) {
    const box = readBoxAt(buffer, offset, limit);
    if (!box) {
      return null;
    }
    if (box.type === type) {
      return box;
    }
    offset = box.end;
  }
  return null;
}

/** `timescale`/`duration` → whole seconds, or null for any non-positive/non-finite input. */
function toWholeSeconds(timescale: number, duration: number): number | null {
  if (!Number.isFinite(timescale) || timescale <= 0) {
    return null;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return Math.round(duration / timescale);
}

/**
 * `mvhd` layout: version(1) + flags(3), then either
 *   v0: creation_time(4) + modification_time(4) + timescale(4) + duration(4)
 *   v1: creation_time(8) + modification_time(8) + timescale(4) + duration(8)
 * Any other version is unrecognized and yields null.
 */
function readMvhdDurationSeconds(buffer: Buffer, mvhd: Mp4Box): number | null {
  const version = buffer.readUInt8(mvhd.bodyStart);
  const afterVersionFlags = mvhd.bodyStart + 4;

  if (version === 0) {
    const timescaleOffset = afterVersionFlags + 4 + 4;
    const durationOffset = timescaleOffset + 4;
    if (durationOffset + 4 > mvhd.end) {
      return null;
    }
    return toWholeSeconds(
      buffer.readUInt32BE(timescaleOffset),
      buffer.readUInt32BE(durationOffset),
    );
  }

  if (version === 1) {
    const timescaleOffset = afterVersionFlags + 8 + 8;
    const durationOffset = timescaleOffset + 4;
    if (durationOffset + 8 > mvhd.end) {
      return null;
    }
    const duration = buffer.readBigUInt64BE(durationOffset);
    if (duration > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return toWholeSeconds(buffer.readUInt32BE(timescaleOffset), Number(duration));
  }

  return null;
}

/**
 * Parses whole-second video duration from an MP4 buffer's `moov > mvhd` box.
 * See the module docblock: this NEVER throws.
 */
export function parseMp4DurationSeconds(buffer: Buffer): number | null {
  try {
    const moov = findBox(buffer, 0, buffer.length, 'moov');
    if (!moov) {
      return null;
    }
    const mvhd = findBox(buffer, moov.bodyStart, moov.end, 'mvhd');
    if (!mvhd) {
      return null;
    }
    return readMvhdDurationSeconds(buffer, mvhd);
  } catch {
    return null;
  }
}
