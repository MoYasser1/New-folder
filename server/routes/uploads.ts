import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authorization.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { devMediaAssets } from '../db/dev-store.js';
import { deleteObject, getObjectReadUrl, readDevelopmentObject, storeObject } from '../services/storage.js';
import { writeAuditLog } from '../services/audit.js';

const purposeSchema = z.enum(['avatar', 'project_artifact', 'lesson_media', 'lesson_download']);
const staffRoles = new Set(['instructor', 'content_editor', 'super_admin']);
const allowedTypes: Record<z.infer<typeof purposeSchema>, RegExp> = {
  avatar: /^image\/(jpeg|png|webp)$/,
  project_artifact: /^(application\/pdf|application\/zip|image\/(jpeg|png|webp))$/,
  lesson_media: /^(video\/mp4|audio\/mpeg|image\/(jpeg|png|webp))$/,
  lesson_download: /^(application\/pdf|application\/zip|text\/plain)$/,
};
const hasSignature = (mimeType: string, data: Buffer) => {
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  if (mimeType === 'image/webp') return data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'application/pdf') return data.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'application/zip') return data[0] === 0x50 && data[1] === 0x4b && [3, 5, 7].includes(data[2] ?? -1) && [4, 6, 8].includes(data[3] ?? -1);
  if (mimeType === 'video/mp4') return data.subarray(4, 8).toString() === 'ftyp';
  if (mimeType === 'audio/mpeg') return data.subarray(0, 3).toString() === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0);
  return mimeType === 'text/plain';
};
const safeOriginalFilename = (filename: string) => Array.from(filename)
  .filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  })
  .join('')
  .slice(0, 255) || 'upload';

export async function uploadRoutes(app: FastifyInstance) {
  app.get('/account/uploads', { preHandler: requireUser }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      return { data: [...devMediaAssets.values()]
        .filter((asset) => asset.ownerId === request.user!.id)
        .map((asset) => ({
          id: asset.id, purpose: asset.purpose, filename: asset.filename, mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes, createdAt: asset.createdAt, url: `/api/uploads/${asset.id}`,
        })) };
    }
    const result = await db.query(
      `SELECT id,purpose,original_filename filename,mime_type "mimeType",size_bytes "sizeBytes",
       created_at "createdAt",('/api/uploads/'||id::text) url
       FROM media_assets WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.post('/uploads/:purpose', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const params = z.object({ purpose: purposeSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (['lesson_media', 'lesson_download'].includes(params.data.purpose) && !staffRoles.has(request.user!.role)) {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    const file = await request.file({ limits: { files: 1, fileSize: config.UPLOAD_MAX_BYTES } });
    if (!file) return reply.code(400).send({ code: 'FILE_REQUIRED' });
    if (!allowedTypes[params.data.purpose].test(file.mimetype)) {
      await file.toBuffer().catch(() => undefined);
      return reply.code(415).send({ code: 'FILE_TYPE_NOT_ALLOWED' });
    }
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      return reply.code(413).send({ code: 'FILE_TOO_LARGE' });
    }
    if (!data.byteLength) return reply.code(400).send({ code: 'EMPTY_FILE' });
    if (!hasSignature(file.mimetype, data)) return reply.code(415).send({ code: 'FILE_SIGNATURE_INVALID' });
    const id = randomUUID();
    const extension = file.filename.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]?.toLowerCase() || '';
    const storageKey = `${id}${extension}`;
    await storeObject(storageKey, data, file.mimetype);
    const safeFilename = safeOriginalFilename(file.filename);
    const asset = {
      id, ownerId: request.user!.id, purpose: params.data.purpose, filename: safeFilename,
      mimeType: file.mimetype, sizeBytes: data.byteLength, storageKey, createdAt: new Date().toISOString(),
    };
    try {
      if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) devMediaAssets.set(id, asset);
      else await db.query(
        `INSERT INTO media_assets(id,owner_id,purpose,original_filename,mime_type,size_bytes,storage_key)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, asset.ownerId, asset.purpose, asset.filename, asset.mimeType, asset.sizeBytes, asset.storageKey],
      );
    } catch (error) {
      await deleteObject(storageKey).catch(() => undefined);
      throw error;
    }
    await writeAuditLog(request, 'media.upload', 'media_asset', id, {
      purpose: asset.purpose, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
    });
    return reply.code(201).send({ data: { ...asset, storageKey: undefined, url: `/api/uploads/${id}` } });
  });

  app.get('/uploads/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    let asset: { ownerId: string; mimeType: string; storageKey: string } | undefined;
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) asset = devMediaAssets.get(params.data.id);
    else {
      const result = await db.query<{ ownerId: string; mimeType: string; storageKey: string }>(
        `SELECT owner_id "ownerId",mime_type "mimeType",storage_key "storageKey"
         FROM media_assets WHERE id=$1 AND deleted_at IS NULL AND status='ready'`, [params.data.id],
      );
      asset = result.rows[0];
    }
    if (!asset) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
    if (asset.ownerId !== request.user!.id && !staffRoles.has(request.user!.role)) {
      return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
    }
    if (config.STORAGE_PROVIDER !== 'development') {
      return reply.redirect(await getObjectReadUrl(asset.storageKey));
    }
    const data = await readDevelopmentObject(asset.storageKey);
    return reply.type(asset.mimeType).header('cache-control', 'private, max-age=300').send(data);
  });

  app.delete('/uploads/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    let storageKey: string | undefined;
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const asset = devMediaAssets.get(params.data.id);
      if (!asset || (asset.ownerId !== request.user!.id && !staffRoles.has(request.user!.role))) {
        return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
      }
      storageKey = asset.storageKey;
      await deleteObject(storageKey);
      devMediaAssets.delete(asset.id);
    } else {
      const result = await db.query<{ storageKey: string }>(
        `UPDATE media_assets SET status='deleted',deleted_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND (owner_id=$2 OR $3::boolean)
         RETURNING storage_key "storageKey"`,
        [params.data.id, request.user!.id, staffRoles.has(request.user!.role)],
      );
      storageKey = result.rows[0]?.storageKey;
      if (!storageKey) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
      try {
        await deleteObject(storageKey);
      } catch (error) {
        await db.query(
          `UPDATE media_assets SET status='ready',deleted_at=NULL
           WHERE id=$1 AND storage_key=$2 AND status='deleted'`,
          [params.data.id, storageKey],
        );
        throw error;
      }
    }
    await writeAuditLog(request, 'media.delete', 'media_asset', params.data.id);
    return reply.code(204).send();
  });
}
