import type { FastifyReply, FastifyRequest } from 'fastify';

const permissions: Record<string, ReadonlySet<string>> = {
  student: new Set(['course.read', 'lesson.read', 'progress.write', 'quiz.submit', 'payment.create']),
  parent: new Set(['child.progress.read', 'payment.read']),
  instructor: new Set(['course.create', 'course.update', 'lesson.publish', 'student.progress.read', 'submission.grade']),
  teaching_assistant: new Set(['student.progress.read', 'submission.grade', 'discussion.moderate']),
  content_editor: new Set(['course.create', 'course.update', 'lesson.publish']),
  support_agent: new Set(['ticket.manage', 'account.support']),
  finance_manager: new Set(['payment.read', 'payment.refund']),
  super_admin: new Set(['*']),
};

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Authentication required' });
}

export async function requireVerifiedUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Authentication required' });
  if (!request.user.emailVerified) return reply.code(403).send({ code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Email verification required' });
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Authentication required' });
    const rolePermissions = permissions[request.user.role];
    if (!rolePermissions?.has('*') && !rolePermissions?.has(permission)) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Insufficient permission' });
    }
  };
}
