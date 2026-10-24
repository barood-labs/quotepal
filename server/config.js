import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 8790),
  paypalEnv: process.env.PAYPAL_ENV || 'mock',
  paypalBase: process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com',
  paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  merchantEmail: process.env.MERCHANT_EMAIL || 'merchant@example.com',
  aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
  dataDir: join(root, 'data'),
  pricebookPath: join(root, 'data', 'pricebook.json'),
  storePath: join(root, 'data', 'store.json'),
};

export function loadPricebook() {
  return JSON.parse(readFileSync(config.pricebookPath, 'utf8'));
}
