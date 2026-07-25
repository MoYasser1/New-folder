import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { devAuditLogs } from '../db/dev-store.js';

export async function writeAuditLog(
  request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {},
) {
  if (!request.user) return;
  if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
    devAuditLogs.push({
      id: randomUUID(), actorId: request.user.id, action, resourceType, resourceId,
      requestId: request.id, ipAddress: request.ip, userAgent: request.headers['user-agent'],
      metadata, createdAt: new Date().toISOString(),
    });
    if (devAuditLogs.length > 1_000) devAuditLogs.splice(0, devAuditLogs.length - 1_000);
    return;
  }
  await db.query(
    `INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,request_id,ip_address,user_agent,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [request.user.id, action, resourceType, resourceId, request.id, request.ip,
      request.headers['user-agent'], JSON.stringify(metadata)],
  );
}
