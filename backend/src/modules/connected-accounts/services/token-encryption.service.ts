import { Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../../../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * AES-256-GCM encryption for OAuth access/refresh tokens at rest
 * (approved architecture + security decisions). Single 32-byte master key
 * from APP_ENCRYPTION_KEY (base64), read from env only — never committed.
 *
 * Ciphertext format written to the DB: base64(iv || authTag || ciphertext).
 * This is the ONLY place in the codebase that touches the master key or
 * performs raw encrypt/decrypt — ConnectedAccountsService.getValidToken() is
 * the only sanctioned way other modules ever see a decrypted token; nothing
 * outside this service should call decrypt() directly.
 *
 * Key-compromise runbook: docs/security-decisions.md.
 */
@Injectable()
export class TokenEncryptionService implements OnModuleInit {
  private masterKey!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const appConfig = this.configService.get<AppConfig>('app');
    const keyBase64 = appConfig?.encryption.masterKeyBase64;

    if (!keyBase64) {
      throw new InternalServerErrorException('APP_ENCRYPTION_KEY is not configured');
    }

    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new InternalServerErrorException(
        `APP_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes, got ${key.length}`,
      );
    }

    this.masterKey = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encoded: string): string {
    const buffer = Buffer.from(encoded, 'base64');

    const iv = buffer.subarray(0, IV_LENGTH_BYTES);
    const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }
}
