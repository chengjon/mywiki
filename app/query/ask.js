function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreText(terms, text) {
  const haystack = String(text).toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function scoreEntity(question, terms, entity) {
  const name = String(entity.name ?? '').toLowerCase();
  const slug = String(entity.slug ?? '').toLowerCase();
  let score = scoreText(terms, `${name} ${slug}`);
  if (question.toLowerCase().includes(name)) {
    score += 10;
  }
  return score;
}

function findSupportingSourcePage(pages, sourceId) {
  return pages.find((page) => page.type === 'source' && (page.sourceIds ?? []).includes(sourceId)) ?? null;
}

function findSupportingChunks(chunks, sourceId) {
  return chunks.filter((chunk) => chunk.sourceId === sourceId).slice(0, 2);
}

function findSourceById(sources, id) {
  return sources.find((source) => source.id === id) ?? null;
}

function findEntityById(entities, id) {
  return entities.find((entity) => entity.id === id) ?? null;
}

function formatSourceMetadata(source) {
  const parts = [
    source?.metadata?.author,
    source?.metadata?.publishedAt,
    source?.metadata?.domain
  ].filter(Boolean);
  return parts.join(' | ');
}

function formatSourceLabel({ sourceId, page, source }) {
  const base = page?.title ?? source?.title ?? sourceId;
  const metadata = formatSourceMetadata(source);
  return metadata ? `${base} (${metadata})` : base;
}

function compareSourceContexts(left, right) {
  const leftPublished = Date.parse(left.source?.metadata?.publishedAt ?? '') || 0;
  const rightPublished = Date.parse(right.source?.metadata?.publishedAt ?? '') || 0;
  if (leftPublished !== rightPublished) {
    return rightPublished - leftPublished;
  }
  return formatSourceLabel(left).localeCompare(formatSourceLabel(right));
}

function buildSourceContexts({ sourceIds, pages, sources }) {
  return [...new Set(sourceIds)]
    .map((sourceId) => ({
      sourceId,
      page: findSupportingSourcePage(pages, sourceId),
      source: findSourceById(sources, sourceId)
    }))
    .sort(compareSourceContexts);
}

function sourcePreference(source, preferences) {
  const publishedAt = Date.parse(source?.metadata?.publishedAt ?? '') || 0;
  const metadataCompleteness = ['author', 'publishedAt', 'canonicalUrl', 'domain']
    .filter((field) => Boolean(source?.metadata?.[field]))
    .length;
  const sourceTypeWeight = preferences?.conflictResolution?.sourceTypeWeights?.[source?.sourceType] ?? 0;
  return { publishedAt, metadataCompleteness, sourceTypeWeight };
}

function preferenceOrder(preferences) {
  const configured = preferences?.conflictResolution?.order;
  return Array.isArray(configured) && configured.length > 0
    ? configured
    : ['publishedAt', 'metadataCompleteness'];
}

function compareSourcePreference(left, right, preferences) {
  const leftPreference = sourcePreference(left, preferences);
  const rightPreference = sourcePreference(right, preferences);
  for (const key of preferenceOrder(preferences)) {
    if ((leftPreference[key] ?? 0) !== (rightPreference[key] ?? 0)) {
      return (rightPreference[key] ?? 0) - (leftPreference[key] ?? 0);
    }
  }
  return String(left?.title ?? '').localeCompare(String(right?.title ?? ''));
}

function formatSourceTitle(source) {
  return source?.title ?? source?.id ?? 'unknown source';
}

function sourceTypeLabel(source) {
  return String(source?.sourceType ?? 'unknown').toLowerCase();
}

function conflictPreferences(relations, entities, sources, preferences) {
  const groups = new Map();

  for (const relation of relations) {
    const key = `${relation.relationType}:${relation.fromId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(relation);
  }

  return [...groups.values()]
    .map((group) => {
      const targets = new Map();
      for (const relation of group) {
        if (!targets.has(relation.toId)) {
          targets.set(relation.toId, []);
        }
        targets.get(relation.toId).push(relation);
      }

      if (targets.size < 2) {
        return null;
      }

      const rankedTargets = [...targets.entries()]
        .map(([targetId, targetRelations]) => {
          const targetEntity = findEntityById(entities, targetId);
          const supportingSources = [...new Set(targetRelations.flatMap((relation) => relation.evidenceSourceIds ?? []))]
            .map((sourceId) => findSourceById(sources, sourceId))
            .filter(Boolean)
            .sort((left, right) => compareSourcePreference(left, right, preferences));
          const bestSource = supportingSources[0] ?? null;
          const preference = sourcePreference(bestSource, preferences);
          return { targetEntity, bestSource, preference };
        })
        .filter((entry) => entry.targetEntity)
        .sort((left, right) => {
          for (const key of preferenceOrder(preferences)) {
            if ((left.preference[key] ?? 0) !== (right.preference[key] ?? 0)) {
              return (right.preference[key] ?? 0) - (left.preference[key] ?? 0);
            }
          }
          return left.targetEntity.name.localeCompare(right.targetEntity.name);
        });

      if (rankedTargets.length < 2) {
        return null;
      }

      const [top, second] = rankedTargets;
      const order = preferenceOrder(preferences);
      if (order.every((key) => (top.preference[key] ?? 0) === (second.preference[key] ?? 0))) {
        return null;
      }

      const reasons = [];
      for (const key of order) {
        if ((top.preference[key] ?? 0) <= (second.preference[key] ?? 0)) {
          continue;
        }
        if (key === 'publishedAt' && top.bestSource?.metadata?.publishedAt) {
          reasons.push(`${formatSourceTitle(top.bestSource)} is newer than ${formatSourceTitle(second.bestSource)}`);
        }
        if (key === 'metadataCompleteness') {
          reasons.push(`${formatSourceTitle(top.bestSource)} has richer source metadata`);
        }
        if (key === 'sourceTypeWeight') {
          reasons.push(`${sourceTypeLabel(top.bestSource)} sources are ranked above ${sourceTypeLabel(second.bestSource)} in repository preferences`);
        }
      }

      return `Current evidence leans toward ${top.targetEntity.name} for ${group[0].relationType} because ${reasons.join(' and ')}.`;
    })
    .filter(Boolean);
}

function describeRelation(relation, entities) {
  const target = findEntityById(entities, relation.toId);
  const labels = {
    leads: 'leads',
    works_at: 'works at',
    built_by: 'is built by',
    created_by: 'is created by',
    part_of: 'is part of'
  };
  if (!target) {
    return null;
  }
  const verb = labels[relation.relationType] ?? relation.relationType.replace(/_/g, ' ');
  return `${verb} ${target.name}`;
}

function renderStructuredAnswer(sections) {
  return sections
    .filter((section) => section.content && (Array.isArray(section.content) ? section.content.length > 0 : true))
    .map((section) => {
      if (Array.isArray(section.content)) {
        return `## ${section.title}\n\n${section.content.map((item) => `- ${item}`).join('\n')}`;
      }
      return `## ${section.title}\n\n${String(section.content).trim()}`;
    })
    .join('\n\n');
}

export async function answerQuestion({ question, preferences, pages = [], chunks = [], sources = [], entities = [], relations = [] }) {
  const terms = tokenize(question);
  const rankedEntities = entities
    .map((entity) => ({
      entity,
      score: scoreEntity(question, terms, entity)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedEntities.length > 0) {
    const bestEntity = rankedEntities[0].entity;
    const entityPage = pages.find((page) => page.slug === bestEntity.slug || page.title === bestEntity.name) ?? null;
    const incomingSourceRelations = relations.filter((relation) => relation.toType === 'entity' && relation.toId === bestEntity.id && relation.fromType === 'source');
    const outgoingEntityRelations = relations.filter((relation) => relation.fromType === 'entity' && relation.fromId === bestEntity.id);
    const supportingRelations = [...incomingSourceRelations, ...outgoingEntityRelations];
    const sourceContexts = buildSourceContexts({
      sourceIds: incomingSourceRelations.map((relation) => relation.fromId),
      pages,
      sources
    });
    const supportingSourcePages = sourceContexts.map((context) => context.page).filter(Boolean);
    const supportingChunks = sourceContexts.flatMap((context) => findSupportingChunks(chunks, context.sourceId));
    const describedRelations = outgoingEntityRelations
      .map((relation) => describeRelation(relation, entities))
      .filter(Boolean);
    const openQuestions = entityPage?.openQuestions ?? [];
    const hasConflicts = openQuestions.some((entry) => /^Conflict:/i.test(String(entry)));
    const preferredConflictResolutions = hasConflicts
      ? conflictPreferences(outgoingEntityRelations, entities, sources, preferences)
      : [];

    const parts = [
      hasConflicts
        ? `${bestEntity.name}${bestEntity.entityType ? ` is a ${bestEntity.entityType}` : ''}, but the current wiki contains unresolved conflicts.`
        : `${bestEntity.name}${bestEntity.entityType ? ` is a ${bestEntity.entityType}` : ''}.`
    ];

    if (entityPage?.summary) {
      parts.push(entityPage.summary);
    }

    if (describedRelations.length > 0) {
      parts.push(
        hasConflicts
          ? `Current sources disagree about key relations: ${bestEntity.name} ${describedRelations.join(' and ')}.`
          : `${bestEntity.name} ${describedRelations.join(' and ')}.`
      );
    }

    if (preferredConflictResolutions.length > 0) {
      parts.push(preferredConflictResolutions.join(' '));
    }

    if (sourceContexts.length > 0) {
      parts.push(
        `Supporting sources: ${sourceContexts.map((context) => `${formatSourceLabel(context)}${context.page?.summary ? ` - ${context.page.summary}` : ''}`).join('; ')}.`
      );
    } else if (supportingChunks.length > 0) {
      parts.push(`Supporting evidence: ${supportingChunks.map((chunk) => chunk.text).join(' ')}`);
    }

    const citations = [{ type: 'entity', slug: bestEntity.slug, title: bestEntity.name }];
    if (entityPage) {
      citations.push({ type: 'page', slug: entityPage.slug, title: entityPage.title });
    }
    for (const relation of outgoingEntityRelations) {
      citations.push({
        type: 'relation',
        relationType: relation.relationType,
        fromId: relation.fromId,
        toId: relation.toId
      });
    }
    for (const context of sourceContexts) {
      citations.push({
        type: 'source',
        sourceId: context.sourceId,
        slug: context.page?.slug,
        title: formatSourceLabel(context)
      });
      if (context.page) {
        citations.push({ type: 'page', slug: context.page.slug, title: context.page.title });
      }
    }
    for (const chunk of supportingChunks) {
      citations.push({ type: 'chunk', sourceId: chunk.sourceId, chunkId: chunk.id });
    }

    return {
      answer: renderStructuredAnswer([
        { title: 'Answer', content: parts.join(' ').trim() },
        { title: 'Relations', content: describedRelations.map((relation) => `${bestEntity.name} ${relation}.`) },
        {
          title: 'Evidence',
          content: sourceContexts.length > 0
            ? sourceContexts.map((context) => `${formatSourceLabel(context)}: ${context.page?.summary ?? findSupportingChunks(chunks, context.sourceId)[0]?.text ?? 'no summary'}`)
            : supportingChunks.map((chunk) => chunk.text)
        },
        {
          title: 'Sources',
          content: sourceContexts.map((context) =>
            context.page?.slug ? `[[${context.page.slug}]] - ${formatSourceLabel(context)}` : formatSourceLabel(context)
          )
        },
        { title: 'Open Questions', content: openQuestions }
      ]),
      citations
    };
  }

  const rankedPages = pages
    .map((page) => ({
      page,
      score: scoreText(terms, `${page.title} ${page.summary ?? ''} ${page.details ?? ''}`) + 10
    }))
    .filter((entry) => entry.score > 10)
    .sort((left, right) => right.score - left.score);

  if (rankedPages.length > 0) {
    const best = rankedPages[0].page;
    const sourceContexts = buildSourceContexts({
      sourceIds: best.sourceIds ?? [],
      pages,
      sources
    });
    const citations = [{ type: 'page', slug: best.slug, title: best.title }];
    for (const context of sourceContexts) {
      citations.push({
        type: 'source',
        sourceId: context.sourceId,
        slug: context.page?.slug,
        title: formatSourceLabel(context)
      });
    }
    return {
      answer: renderStructuredAnswer([
        { title: 'Answer', content: `${best.title}: ${best.summary ?? 'No summary available.'}` },
        {
          title: 'Sources',
          content: sourceContexts.length > 0
            ? sourceContexts.map((context) => context.page?.slug ? `[[${context.page.slug}]] - ${formatSourceLabel(context)}` : formatSourceLabel(context))
            : [`[[${best.slug}]]`]
        },
        { title: 'Open Questions', content: best.openQuestions ?? [] }
      ]),
      citations
    };
  }

  const rankedChunks = chunks
    .map((chunk) => ({
      chunk,
      score: scoreText(terms, chunk.text)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedChunks.length > 0) {
    const best = rankedChunks[0].chunk;
    return {
      answer: renderStructuredAnswer([
        { title: 'Answer', content: best.text },
        { title: 'Evidence', content: [best.text] }
      ]),
      citations: [{ type: 'chunk', sourceId: best.sourceId, chunkId: best.id }]
    };
  }

  return {
    answer: renderStructuredAnswer([
      { title: 'Answer', content: 'No relevant wiki pages or source chunks matched the question.' }
    ]),
    citations: []
  };
}
