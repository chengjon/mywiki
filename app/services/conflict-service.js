import { upsertPage } from './page-service.js';

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeStrings(values) {
  return uniqueBy(values.filter(Boolean), (value) => value);
}

function replaceGeneratedConflicts(existing, generated) {
  return mergeStrings([...(existing ?? []).filter((entry) => !String(entry).startsWith('Conflict:')), ...generated]);
}

function buildConflictQuestion(entity, relationType, targetEntities) {
  const targetNames = uniqueBy(targetEntities, (target) => target.id)
    .map((target) => target.name)
    .sort((left, right) => left.localeCompare(right));
  return `Conflict: ${entity.name} has multiple ${relationType} targets across sources: ${targetNames.join(', ')}. Which one is current?`;
}

function collectEntityConflicts(entity, relations, entitiesById) {
  const outgoing = relations.filter((relation) => relation.fromType === 'entity' && relation.fromId === entity.id && relation.toType === 'entity');
  const grouped = new Map();

  for (const relation of outgoing) {
    const target = entitiesById.get(relation.toId);
    if (!target) {
      continue;
    }
    if (!grouped.has(relation.relationType)) {
      grouped.set(relation.relationType, []);
    }
    grouped.get(relation.relationType).push(target);
  }

  return [...grouped.entries()]
    .map(([relationType, targets]) => ({
      relationType,
      targets: uniqueBy(targets, (target) => target.id)
    }))
    .filter((entry) => entry.targets.length > 1);
}

export async function applyConflictQuestions(repos, { topicPage, entities }) {
  const allRelations = await repos.relations.all();
  const allEntities = await repos.entities.all();
  const entitiesById = new Map(allEntities.map((entity) => [entity.id, entity]));
  const touchedEntityPages = [];
  const topicQuestions = [];

  for (const entity of entities) {
    const entityPage = await repos.pages.findBy('slug', entity.slug);
    if (!entityPage) {
      continue;
    }

    const conflicts = collectEntityConflicts(entity, allRelations, entitiesById);
    const generatedQuestions = conflicts.map((conflict) => buildConflictQuestion(entity, conflict.relationType, conflict.targets));

    const updatedEntityPage = await upsertPage(repos, {
      ...entityPage,
      id: entityPage.id,
      openQuestions: replaceGeneratedConflicts(entityPage.openQuestions, generatedQuestions),
      changeNotes: mergeStrings([
        ...(entityPage.changeNotes ?? []),
        conflicts.length > 0 ? `Conflict review updated for ${entity.name}` : null
      ])
    });

    touchedEntityPages.push(updatedEntityPage);
    topicQuestions.push(...generatedQuestions);
  }

  let updatedTopicPage = topicPage;
  if (topicPage) {
    const currentTopicPage = await repos.pages.findBy('slug', topicPage.slug);
    if (currentTopicPage) {
      updatedTopicPage = await upsertPage(repos, {
        ...currentTopicPage,
        id: currentTopicPage.id,
        openQuestions: replaceGeneratedConflicts(currentTopicPage.openQuestions, mergeStrings(topicQuestions)),
        changeNotes: mergeStrings([
          ...(currentTopicPage.changeNotes ?? []),
          topicQuestions.length > 0 ? `Conflict review updated for topic ${currentTopicPage.title}` : null
        ])
      });
    }
  }

  return { topicPage: updatedTopicPage, entityPages: touchedEntityPages };
}
