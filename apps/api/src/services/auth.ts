import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const DEV_SECRET = 'overflowgo-dev-secret-change-me';
const DEFAULT_TTL_HOURS = 12;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim()) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return DEV_SECRET;
}

export function tokenTtlHours(): number {
  const raw = Number(process.env.JWT_EXPIRES_IN_HOURS ?? DEFAULT_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signDriverToken(driverId: string): string {
  return jwt.sign({ sub: driverId, role: 'driver' }, jwtSecret(), {
    expiresIn: `${tokenTtlHours()}h`,
  });
}

export function verifyDriverToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (
      typeof payload === 'object' &&
      payload !== null &&
      payload.role === 'driver' &&
      typeof payload.sub === 'string'
    ) {
      return payload.sub;
    }
  } catch {
    // Invalid or expired token.
  }
  return null;
}
