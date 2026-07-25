import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('hashes with a unique salt and verifies without storing plaintext', async () => {
    const first = await hashPassword('StrongPassword@2026');
    const second = await hashPassword('StrongPassword@2026');
    expect(first).not.toBe(second);
    expect(first).not.toContain('StrongPassword@2026');
    await expect(verifyPassword('StrongPassword@2026', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false);
  });
});
