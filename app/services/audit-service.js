import { createId, nowIso } from '../config.js';

export async function appendAuditEvent(repos, event) {
  const auditEvent = {
    id: event.id ?? createId('evt'),
    eventType: event.eventType,
    title: event.title,
    details: event.details ?? '',
    relatedIds: event.relatedIds ?? [],
    createdAt: event.createdAt ?? nowIso()
  };

  await repos.auditLog.insert(auditEvent);
  return auditEvent;
}
