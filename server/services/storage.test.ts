import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { deleteObject, getObjectReadUrl, storeObject } from './storage.js';

describe('private HTTP storage adapter', () => {
  const original = {
    provider: config.STORAGE_PROVIDER,
    url: config.STORAGE_PROVIDER_URL,
    token: config.STORAGE_PROVIDER_TOKEN,
  };

  beforeEach(() => {
    Object.assign(config, {
      STORAGE_PROVIDER: 'http',
      STORAGE_PROVIDER_URL: 'https://storage.example/objects',
      STORAGE_PROVIDER_TOKEN: 'storage-secret',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(config, {
      STORAGE_PROVIDER: original.provider,
      STORAGE_PROVIDER_URL: original.url,
      STORAGE_PROVIDER_TOKEN: original.token,
    });
  });

  it('uploads bytes with authorization, type, and encoded object key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await storeObject('folder unsafe.png', Buffer.from('bytes'), 'image/png');
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://storage.example/objects/folder%20unsafe.png');
    expect(options.headers).toMatchObject({
      authorization: 'Bearer storage-secret', 'content-type': 'image/png', 'content-length': '5',
    });
  });

  it('requests a short-lived private read URL without returning the storage key itself', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: 'https://cdn.example/signed/file?expires=123',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const url = await getObjectReadUrl('private.png');
    expect(url).toContain('cdn.example/signed');
    const [requestUrl, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.searchParams.get('key')).toBe('private.png');
    expect(options.headers).toMatchObject({ authorization: 'Bearer storage-secret' });
  });

  it('treats an already missing remote object as an idempotent delete', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(deleteObject('missing.png')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
