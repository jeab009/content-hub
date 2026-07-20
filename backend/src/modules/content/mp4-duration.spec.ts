import { parseMp4DurationSeconds } from './mp4-duration';

/** Builds one MP4 box: 4-byte big-endian size + 4-byte ASCII type + body. */
function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

/** A box declaring size=0 ("extends to end of the enclosing range"). */
function boxToEndOfRange(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

/** A box using the 64-bit "largesize" extension (declared size field == 1). */
function boxExtendedSize(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, 'ascii');
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
}

function mvhdV0Body(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(20); // version+flags(4) + creation(4) + modification(4) + timescale(4) + duration(4)
  body.writeUInt8(0, 0);
  body.writeUInt32BE(0, 4); // creation_time
  body.writeUInt32BE(0, 8); // modification_time
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return body;
}

function mvhdV1Body(timescale: number, duration: bigint): Buffer {
  const body = Buffer.alloc(32); // version+flags(4) + creation(8) + modification(8) + timescale(4) + duration(8)
  body.writeUInt8(1, 0);
  body.writeBigUInt64BE(0n, 4); // creation_time
  body.writeBigUInt64BE(0n, 12); // modification_time
  body.writeUInt32BE(timescale, 20);
  body.writeBigUInt64BE(duration, 24);
  return body;
}

function ftypBox(): Buffer {
  const body = Buffer.from('isomisom', 'ascii');
  return box('ftyp', body);
}

describe('parseMp4DurationSeconds', () => {
  it('reads a v0 mvhd atom: timescale 30000, duration 900000 -> 30s', () => {
    const mvhd = box('mvhd', mvhdV0Body(30000, 900000));
    const moov = box('moov', mvhd);
    const file = Buffer.concat([ftypBox(), moov]);

    expect(parseMp4DurationSeconds(file)).toBe(30);
  });

  it('reads a v1 (64-bit) mvhd atom', () => {
    const mvhd = box('mvhd', mvhdV1Body(1000, 42_000n));
    const moov = box('moov', mvhd);
    const file = Buffer.concat([ftypBox(), moov]);

    expect(parseMp4DurationSeconds(file)).toBe(42);
  });

  it('rounds to the nearest whole second', () => {
    const mvhd = box('mvhd', mvhdV0Body(1000, 1499)); // 1.499s -> 1
    const moov = box('moov', mvhd);
    expect(parseMp4DurationSeconds(Buffer.concat([ftypBox(), moov]))).toBe(1);
  });

  it('finds mvhd even when other sibling boxes precede it inside moov', () => {
    const trak = box('trak', Buffer.from('irrelevant-sibling-box', 'ascii'));
    const mvhd = box('mvhd', mvhdV0Body(600, 18000)); // 30s
    const moov = box('moov', Buffer.concat([trak, mvhd]));
    const file = Buffer.concat([ftypBox(), moov]);

    expect(parseMp4DurationSeconds(file)).toBe(30);
  });

  it('handles a size=0 ("to end of range") moov box', () => {
    const mvhd = box('mvhd', mvhdV0Body(90000, 5_400_000)); // 60s
    const moov = boxToEndOfRange('moov', mvhd);
    const file = Buffer.concat([ftypBox(), moov]);

    expect(parseMp4DurationSeconds(file)).toBe(60);
  });

  it('handles a size==1 (64-bit largesize) moov box', () => {
    const mvhd = box('mvhd', mvhdV0Body(1000, 10_000)); // 10s
    const moov = boxExtendedSize('moov', mvhd);
    const file = Buffer.concat([ftypBox(), moov]);

    expect(parseMp4DurationSeconds(file)).toBe(10);
  });

  it('returns null when there is no moov box at all', () => {
    expect(parseMp4DurationSeconds(ftypBox())).toBeNull();
  });

  it('returns null when moov exists but has no mvhd child', () => {
    const trak = box('trak', Buffer.from('no mvhd here', 'ascii'));
    const moov = box('moov', trak);
    expect(parseMp4DurationSeconds(Buffer.concat([ftypBox(), moov]))).toBeNull();
  });

  it('returns null for an mvhd with an unrecognized version byte', () => {
    const body = mvhdV0Body(1000, 5000);
    body.writeUInt8(2, 0); // version 2 does not exist
    const mvhd = box('mvhd', body);
    const moov = box('moov', mvhd);
    expect(parseMp4DurationSeconds(Buffer.concat([ftypBox(), moov]))).toBeNull();
  });

  it('returns null for a zero timescale', () => {
    const mvhd = box('mvhd', mvhdV0Body(0, 5000));
    const moov = box('moov', mvhd);
    expect(parseMp4DurationSeconds(Buffer.concat([ftypBox(), moov]))).toBeNull();
  });

  it('returns null for a zero duration (a fragmented MP4 that reports 0)', () => {
    const mvhd = box('mvhd', mvhdV0Body(1000, 0));
    const moov = box('moov', mvhd);
    expect(parseMp4DurationSeconds(Buffer.concat([ftypBox(), moov]))).toBeNull();
  });

  it('returns null for a truncated mvhd body (cut mid-duration-field)', () => {
    const mvhd = box('mvhd', mvhdV0Body(1000, 5000));
    const moov = box('moov', mvhd);
    const file = Buffer.concat([ftypBox(), moov]);
    expect(parseMp4DurationSeconds(file.subarray(0, file.length - 10))).toBeNull();
  });

  it('returns null for a corrupt box size that would read past the buffer', () => {
    const bad = Buffer.alloc(8);
    bad.writeUInt32BE(0xffffffff, 0); // absurd size
    bad.write('moov', 4, 'ascii');
    expect(parseMp4DurationSeconds(bad)).toBeNull();
  });

  it('returns null for a box size smaller than the header itself', () => {
    const bad = Buffer.alloc(8);
    bad.writeUInt32BE(4, 0); // smaller than the 8-byte header
    bad.write('moov', 4, 'ascii');
    expect(parseMp4DurationSeconds(bad)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(parseMp4DurationSeconds(Buffer.alloc(0))).toBeNull();
  });

  it('returns null (never throws) for arbitrary non-MP4 bytes', () => {
    expect(parseMp4DurationSeconds(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('never throws across a spread of random buffers (fuzz-lite, deterministic seed)', () => {
    let seed = 42;
    const nextByte = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    };
    for (let trial = 0; trial < 50; trial += 1) {
      const length = trial * 3;
      const buffer = Buffer.alloc(length);
      for (let i = 0; i < length; i += 1) {
        buffer[i] = nextByte();
      }
      expect(() => parseMp4DurationSeconds(buffer)).not.toThrow();
    }
  });
});
