import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config';

export interface AccessClaims { sub: string; roles: string[]; permissions: string[]; }
export interface AudioPlaybackClaims { audioId: string; }

const jwtKey = new TextEncoder().encode(config.jwtSecret);
const encryptionKey = createHash('sha256').update(config.integrationMasterKey).digest();

export const newId = () => randomUUID();
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export async function signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const token = await new SignJWT({ roles: claims.roles, permissions: claims.permissions })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(jwtKey);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, jwtKey);
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : [];
  const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter((permission): permission is string => typeof permission === 'string') : [];
  if (!payload.sub) throw new Error('Token subject missing');
  return { sub: payload.sub, roles, permissions };
}

/** Admin ilovasidagi native player uchun qisqa muddatli, storage'ni oshkor
 * qilmaydigan playback tokeni. Token faqat bitta audio ID uchun yaroqli. */
export async function signAudioPlaybackToken(audioId: string): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const token = await new SignJWT({ scope: 'audio:playback' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('xorazm-api')
    .setAudience('xorazm-audio')
    .setSubject(audioId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(jwtKey);
  return { token, expiresAt };
}

export async function verifyAudioPlaybackToken(token: string, audioId: string): Promise<AudioPlaybackClaims> {
  const { payload } = await jwtVerify(token, jwtKey, {
    issuer: 'xorazm-api',
    audience: 'xorazm-audio',
  });
  if (payload.sub !== audioId || payload.scope !== 'audio:playback') {
    throw new Error('Audio playback tokeni noto‘g‘ri.');
  }
  return { audioId };
}

export function encryptSecret(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, fingerprint: hashToken(value), maskedHint: `••••${value.slice(-4)}` };
}

export function decryptSecret(ciphertext: Buffer, nonce: Buffer): string {
  const authTag = ciphertext.subarray(-16);
  const encrypted = ciphertext.subarray(0, -16);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
