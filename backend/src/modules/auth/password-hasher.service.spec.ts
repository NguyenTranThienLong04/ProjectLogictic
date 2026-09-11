import { PasswordHasherService } from './password-hasher.service.js';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('hashes passwords with a unique salt and verifies the original value', async () => {
    const firstHash = await hasher.hash('StrongPassword!123');
    const secondHash = await hasher.hash('StrongPassword!123');

    expect(firstHash).not.toBe(secondHash);
    await expect(hasher.verify('StrongPassword!123', firstHash)).resolves.toBe(true);
    await expect(hasher.verify('WrongPassword!123', firstHash)).resolves.toBe(false);
  });

  it('performs a timing-protection derivation for unknown accounts', async () => {
    await expect(hasher.verify('StrongPassword!123', undefined)).resolves.toBe(false);
  });
});
