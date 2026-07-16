import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { TokenEncryptionService } from './token-encryption.service';

function serviceWithKey(keyBase64: string): TokenEncryptionService {
  const configService = {
    get: () => ({ encryption: { masterKeyBase64: keyBase64 } }),
  } as unknown as ConfigService;
  const service = new TokenEncryptionService(configService);
  service.onModuleInit();
  return service;
}

describe('TokenEncryptionService', () => {
  const validKey = randomBytes(32).toString('base64');

  it('round-trips a plaintext token through encrypt/decrypt', () => {
    const service = serviceWithKey(validKey);
    const plaintext = 'EAABsbCS1234567890TokenValueHere';

    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const service = serviceWithKey(validKey);
    const plaintext = 'same-token-value';

    expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext));
  });

  it('throws if the configured key is not exactly 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => serviceWithKey(shortKey)).toThrow(/32 bytes/);
  });

  it('fails to decrypt if ciphertext was tampered with (GCM auth tag check)', () => {
    const service = serviceWithKey(validKey);
    const encrypted = service.encrypt('sensitive-value');
    const tampered = encrypted.slice(0, -4) + 'abcd';

    expect(() => service.decrypt(tampered)).toThrow();
  });
});
