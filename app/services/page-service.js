import { createId, nowIso, normalizePageType, slugify, today } from '../config.js';

export async function upsertPage(repos, pageInput) {
  const now = nowIso();
  const slug = pageInput.slug ?? slugify(pageInput.title);
  const type = normalizePageType(pageInput.type);
  const existing = await repos.pages.findBy('slug', slug);

  const page = {
    id: existing?.id ?? pageInput.id ?? createId('pg'),
    title: pageInput.title,
    slug,
    type,
    status: pageInput.status ?? existing?.status ?? 'active',
    tags: pageInput.tags ?? existing?.tags ?? [],
    sourceIds: pageInput.sourceIds ?? existing?.sourceIds ?? [],
    entityIds: pageInput.entityIds ?? existing?.entityIds ?? [],
    summary: pageInput.summary ?? existing?.summary ?? '',
    keyPoints: pageInput.keyPoints ?? existing?.keyPoints ?? [],
    details: pageInput.details ?? existing?.details ?? '',
    relatedPages: pageInput.relatedPages ?? existing?.relatedPages ?? [],
    sources: pageInput.sources ?? existing?.sources ?? [],
    openQuestions: pageInput.openQuestions ?? existing?.openQuestions ?? [],
    changeNotes: pageInput.changeNotes ?? existing?.changeNotes ?? [],
    createdAt: existing?.createdAt ?? pageInput.createdAt ?? today(),
    updatedAt: now,
    confidence: pageInput.confidence ?? existing?.confidence ?? 'medium'
  };

  await repos.pages.upsert(page);
  return page;
}
