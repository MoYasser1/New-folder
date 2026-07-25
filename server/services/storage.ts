import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.js';

const uploadRoot = resolve(process.cwd(), '.runtime-uploads');

export async function storeObject(storageKey: string, data: Buffer, mimeType: string) {
  if (config.STORAGE_PROVIDER === 'disabled') throw new Error('STORAGE_PROVIDER_DISABLED');
  if (config.STORAGE_PROVIDER === 'development') {
    await mkdir(uploadRoot, { recursive: true });
    await writeFile(resolve(uploadRoot, storageKey), data, { flag: 'wx' });
    return;
  }
  const response = await fetch(`${config.STORAGE_PROVIDER_URL!.replace(/\/$/, '')}/${encodeURIComponent(storageKey)}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${config.STORAGE_PROVIDER_TOKEN}`,
      'content-type': mimeType,
      'content-length': String(data.byteLength),
    },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`STORAGE_PROVIDER_ERROR_${response.status}`);
}

export async function readDevelopmentObject(storageKey: string) {
  if (config.STORAGE_PROVIDER !== 'development') throw new Error('LOCAL_STORAGE_UNAVAILABLE');
  return readFile(resolve(uploadRoot, storageKey));
}

export async function getObjectReadUrl(storageKey: string) {
  if (config.STORAGE_PROVIDER !== 'http') throw new Error('REMOTE_STORAGE_UNAVAILABLE');
  const endpoint = new URL(config.STORAGE_PROVIDER_URL!);
  endpoint.searchParams.set('key', storageKey);
  endpoint.searchParams.set('operation', 'read');
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${config.STORAGE_PROVIDER_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`STORAGE_PROVIDER_ERROR_${response.status}`);
  const payload = await response.json() as { url?: string };
  if (!payload.url || !URL.canParse(payload.url)) throw new Error('STORAGE_PROVIDER_INVALID_READ_URL');
  return payload.url;
}

export async function deleteObject(storageKey: string) {
  if (config.STORAGE_PROVIDER === 'development') {
    await unlink(resolve(uploadRoot, storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }
  if (config.STORAGE_PROVIDER !== 'http') throw new Error('STORAGE_PROVIDER_DISABLED');
  const endpoint = new URL(config.STORAGE_PROVIDER_URL!);
  endpoint.searchParams.set('key', storageKey);
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${config.STORAGE_PROVIDER_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`STORAGE_PROVIDER_ERROR_${response.status}`);
}
