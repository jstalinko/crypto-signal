import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_PATH = path.resolve(process.cwd(), 'data', '.master.key');

/**
 * Gets or initializes the 256-bit encryption key
 */
function getMasterKey(): Buffer {
  // 1. Check environment variable
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32) {
    return crypto.scryptSync(process.env.ENCRYPTION_KEY, 'crypto-salt', 32);
  }

  // 2. Check local key file in data directory
  try {
    const dir = path.dirname(KEY_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(KEY_PATH)) {
      const raw = fs.readFileSync(KEY_PATH, 'utf-8').trim();
      if (raw.length === 64) {
        return Buffer.from(raw, 'hex');
      }
    }

    // Generate new 32-byte master key
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(KEY_PATH, newKey.toString('hex'), { mode: 0o600 });
    logger.info('Generated new secure master encryption key in data/.master.key');
    return newKey;
  } catch (err) {
    logger.error(`Error loading master encryption key: ${(err as Error).message}`);
    // Fallback deterministic key for resilience
    return crypto.scryptSync('spot-signal-bot-default-master-key', 'crypto-salt', 32);
  }
}

let cachedMasterKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedMasterKey) {
    cachedMasterKey = getMasterKey();
  }
  return cachedMasterKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encryptString(plaintext: string): EncryptedData {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag
  };
}

/**
 * Decrypt an EncryptedData object using AES-256-GCM
 */
export function decryptString(data: EncryptedData): string {
  const key = getKey();
  const iv = Buffer.from(data.iv, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));

  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
