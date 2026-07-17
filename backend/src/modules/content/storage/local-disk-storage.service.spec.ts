import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorageAdapter } from './local-disk-storage.service';

function fakeConfigService(storageDir: string): ConfigService {
  return {
    get: jest.fn().mockReturnValue({ upload: { storageDir } }),
  } as unknown as ConfigService;
}

describe('LocalDiskStorageAdapter', () => {
  let baseDir: string;
  let storageDir: string;
  let adapter: LocalDiskStorageAdapter;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'content-hub-storage-spec-'));
    // Nested so a `..`-style escape has room to climb without leaving tmpfs.
    storageDir = join(baseDir, 'nested', 'uploads');
    adapter = new LocalDiskStorageAdapter(fakeConfigService(storageDir));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('writes the buffer under a server-generated uuid filename and returns its metadata', async () => {
    const payload = Buffer.from('jpeg-bytes-here');

    const stored = await adapter.save(payload, { mimeType: 'image/jpeg', extension: 'jpg' });

    expect(stored.mediaUrl).toMatch(/^\/uploads\/[a-f0-9-]{36}\.jpg$/);
    expect(stored.fileSizeBytes).toBe(payload.length);
    expect(stored.mimeType).toBe('image/jpeg');

    const files = await readdir(storageDir);
    expect(files).toHaveLength(1);
    await expect(readFile(join(storageDir, files[0]))).resolves.toEqual(payload);
  });

  it('never uses a client-supplied filename — two saves of the same input get distinct uuid names', async () => {
    const payload = Buffer.from('same-bytes');

    const first = await adapter.save(payload, { mimeType: 'image/png', extension: 'png' });
    const second = await adapter.save(payload, { mimeType: 'image/png', extension: 'png' });

    expect(first.mediaUrl).not.toBe(second.mediaUrl);
    await expect(readdir(storageDir)).resolves.toHaveLength(2);
  });

  it('rejects a path-traversal attempt via the extension and writes nothing outside the storage dir', async () => {
    await expect(
      adapter.save(Buffer.from('payload'), {
        mimeType: 'image/jpeg',
        extension: 'jpg/../../../../escaped',
      }),
    ).rejects.toThrow('escaped the storage directory');

    // Nothing may have landed in the parent directories the traversal aimed at.
    const parentEntries = await readdir(baseDir, { recursive: true });
    expect(parentEntries.filter((entry) => String(entry).includes('escaped'))).toHaveLength(0);
  });
});
