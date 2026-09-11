import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('base64url');
    const derivedKey = await this.derive(password, salt);

    return [
      'scrypt',
      String(COST),
      String(BLOCK_SIZE),
      String(PARALLELIZATION),
      salt,
      derivedKey.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, storedHash: string | undefined): Promise<boolean> {
    if (!storedHash) {
      await this.derive(password, 'authentication-timing-protection');
      return false;
    }

    const [algorithm, cost, blockSize, parallelization, salt, encodedHash] = storedHash.split('$');

    if (
      algorithm !== 'scrypt' ||
      Number(cost) !== COST ||
      Number(blockSize) !== BLOCK_SIZE ||
      Number(parallelization) !== PARALLELIZATION ||
      !salt ||
      !encodedHash
    ) {
      return false;
    }

    const expectedHash = Buffer.from(encodedHash, 'base64url');
    const actualHash = await this.derive(password, salt);

    return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
  }

  private derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        KEY_LENGTH,
        { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION },
        (error, derivedKey) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(derivedKey);
        },
      );
    });
  }
}
