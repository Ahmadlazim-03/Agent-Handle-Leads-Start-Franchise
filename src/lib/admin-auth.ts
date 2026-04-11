import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ADMIN_PASSWORD,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_DURATION_SECONDS,
  ADMIN_USERNAME,
} from '@/lib/admin-auth-shared';

export {
  ADMIN_PASSWORD,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_DURATION_SECONDS,
  ADMIN_USERNAME,
};

const ADMIN_AUTH_SIGNING_SECRET =
  process.env.ADMIN_AUTH_SIGNING_SECRET?.trim() ||
  'wa-lead-agent-admin-auth-secret';

function parseOptionalBoolean(value: string | undefined): boolean | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return null;
}

function shouldUseSecureCookie(hostname?: string): boolean {
  const forcedSecureCookieFlag = parseOptionalBoolean(
    process.env.ADMIN_AUTH_COOKIE_SECURE
  );
  if (forcedSecureCookieFlag !== null) {
    return forcedSecureCookieFlag;
  }

  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  if (!hostname) {
    return true;
  }

  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized !== 'localhost' && normalized !== '127.0.0.1' && normalized !== '::1';
}

function signPayload(payload: string): string {
  return createHmac('sha256', ADMIN_AUTH_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
}

function safeCompareHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminCredentialValid(
  username: string,
  password: string
): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export function createAdminSessionToken(): string {
  const expiresAt =
    Math.floor(Date.now() / 1000) + ADMIN_SESSION_DURATION_SECONDS;
  const payload = `${ADMIN_USERNAME}:${expiresAt}`;
  const signature = signPayload(payload);

  return `${ADMIN_USERNAME}.${expiresAt}.${signature}`;
}

export function verifyAdminSessionToken(token: string): boolean {
  const normalized = token.trim();
  if (!normalized) {
    return false;
  }

  const parts = normalized.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [usernamePart, expiresAtPart, signaturePart] = parts;
  if (usernamePart !== ADMIN_USERNAME) {
    return false;
  }

  const expiresAt = Number(expiresAtPart);
  if (!Number.isInteger(expiresAt)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) {
    return false;
  }

  const expectedSignature = signPayload(`${usernamePart}:${expiresAt}`);
  return safeCompareHex(expectedSignature, signaturePart);
}

export function getAdminSessionCookieOptions(hostname?: string): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(hostname),
    path: '/',
    maxAge: ADMIN_SESSION_DURATION_SECONDS,
  };
}
