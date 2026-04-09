import { nowIso } from '../config.js';
import { upsertPage } from './page-service.js';

function relationSummary(relationType, targetEntity) {
  const labelMap = {
    leads: `Leads [[${targetEntity.slug}]]`,
    works_at: `Works at [[${targetEntity.slug}]]`,
    built_by: `Built by [[${targetEntity.slug}]]`,
    created_by: `Created by [[${targetEntity.slug}]]`,
    part_of: `Part of [[${targetEntity.slug}]]`
  };
  return labelMap[relationType] ?? `${relationType} [[${targetEntity.slug}]]`;
}

export async function upsertEntitiesForSource(repos, source, extractedEntities, extractedRelations = []) {
  const entities = [];
  const relations = [];
  const timestamp = nowIso();
  const persistedIdByCandidateId = new Map();

  for (const candidate of extractedEntities) {
    const existing = await repos.entities.findBy('slug', candidate.slug);
    const entity = {
      id: existing?.id ?? candidate.id,
      slug: candidate.slug,
      name: existing?.name ?? candidate.name,
      entityType: existing?.entityType ?? candidate.entityType,
      aliases: existing?.aliases ?? candidate.aliases ?? [],
      sourceIds: [...new Set([...(existing?.sourceIds ?? []), source.id])],
      confidence: existing?.confidence ?? candidate.confidence ?? 'medium',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    await repos.entities.upsert(entity);
    entities.push(entity);
    persistedIdByCandidateId.set(candidate.id, entity.id);

    const relationId = `rel_${source.id}_${entity.id}`;
    const relation = {
      id: relationId,
      fromType: 'source',
      fromId: source.id,
      toType: 'entity',
      toId: entity.id,
      relationType: 'mentions_entity',
      evidenceSourceIds: [source.id],
      confidence: 'medium',
      updatedAt: timestamp
    };
    await repos.relations.upsert(relation);
    relations.push(relation);

    await upsertPage(repos, {
      title: entity.name,
      slug: entity.slug,
      type: 'entity',
      tags: ['entity', entity.entityType],
      sourceIds: entity.sourceIds,
      summary: `${entity.name} is an extracted ${entity.entityType} mentioned in ${source.title}.`,
      details: `Entity type: ${entity.entityType}`,
      relatedPages: [{ slug: source.slug, summary: `Mentioned in ${source.title}` }],
      sources: [{ id: source.id, title: source.title }],
      changeNotes: [`Entity refreshed from source ${source.id}`]
    });
  }

  for (const candidate of extractedRelations) {
    const mappedFromId = persistedIdByCandidateId.get(candidate.fromId) ?? candidate.fromId;
    const mappedToId = persistedIdByCandidateId.get(candidate.toId) ?? candidate.toId;
    const existing = await repos.relations.findBy('id', candidate.id);
    const relation = {
      ...candidate,
      id: existing?.id ?? candidate.id,
      fromId: mappedFromId,
      toId: mappedToId,
      evidenceSourceIds: [source.id],
      updatedAt: timestamp
    };
    await repos.relations.upsert(relation);
    relations.push(relation);
  }

  for (const relation of extractedRelations) {
    const fromEntity = entities.find((entity) => entity.id === relation.fromId) ?? await repos.entities.getById(relation.fromId);
    const toEntity = entities.find((entity) => entity.id === relation.toId) ?? await repos.entities.getById(relation.toId);
    if (!fromEntity || !toEntity) {
      continue;
    }

    const fromPage = await repos.pages.findBy('slug', fromEntity.slug);
    if (!fromPage) {
      continue;
    }

    const relatedPages = [...(fromPage.relatedPages ?? [])];
    if (!relatedPages.some((page) => page.slug === toEntity.slug)) {
      relatedPages.push({ slug: toEntity.slug, summary: relationSummary(relation.relationType, toEntity) });
    }

    const changeNotes = [...(fromPage.changeNotes ?? [])];
    changeNotes.push(`Linked ${fromEntity.name} -> ${relation.relationType} -> ${toEntity.name}`);

    await upsertPage(repos, {
      ...fromPage,
      id: fromPage.id,
      relatedPages,
      changeNotes
    });
  }

  return { entities, relations };
}
