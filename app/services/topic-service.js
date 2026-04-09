import { slugify } from '../config.js';
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

function deriveTopicTitle(source, text) {
  const heading = String(text).match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  return String(source.title)
    .replace(/\b(notes?|article|paper|summary|source|transcript)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveTypedSlug(repos, baseSlug, type) {
  const pages = await repos.pages.all();
  const exact = pages.find((page) => page.slug === baseSlug);
  if (!exact || exact.type === type) {
    return baseSlug;
  }
  return `${baseSlug}-${type}`;
}

function mergeStrings(values) {
  return uniqueBy(values.filter(Boolean), (value) => value);
}

function mergeRelatedPages(existing, incoming) {
  return uniqueBy([...(existing ?? []), ...(incoming ?? [])], (item) => item.slug);
}

function mergeSources(existing, incoming) {
  return uniqueBy([...(existing ?? []), ...(incoming ?? [])], (item) => item.id);
}

function summarizeTopic(topicTitle, sourceRefs, concepts, entities) {
  const sourceCount = sourceRefs.length;
  const conceptNames = concepts.map((concept) => concept.title).slice(0, 4);
  const entityNames = entities.map((entity) => entity.name).slice(0, 4);
  const conceptPart = conceptNames.length > 0 ? ` It currently highlights ${conceptNames.join(', ')}.` : '';
  const entityPart = entityNames.length > 0 ? ` Key entities include ${entityNames.join(', ')}.` : '';
  return `${topicTitle} synthesizes ${sourceCount} source${sourceCount === 1 ? '' : 's'}.${conceptPart}${entityPart}`.trim();
}

function topicDetails(topicTitle, sourceRefs, concepts) {
  const sourceTitles = sourceRefs.map((source) => source.title).join(', ') || 'No sources recorded yet';
  const conceptNames = concepts.map((concept) => concept.title).join(', ') || 'No concepts extracted yet';
  return `This topic currently integrates ${sourceRefs.length} source${sourceRefs.length === 1 ? '' : 's'} about ${topicTitle}.\n\nSources: ${sourceTitles}\n\nConcepts: ${conceptNames}`;
}

function summarizeConcept(conceptTitle, sourceRefs, topicTitle) {
  const sourceCount = sourceRefs.length;
  return `${conceptTitle} is synthesized across ${sourceCount} source${sourceCount === 1 ? '' : 's'} in the ${topicTitle} topic.`;
}

function conceptDetails(conceptTitle, sourceRefs, topicPage) {
  const sourceTitles = sourceRefs.map((source) => source.title).join(', ') || 'No sources recorded yet';
  return `${conceptTitle} appears in the topic [[${topicPage.slug}]].\n\nSources: ${sourceTitles}`;
}

export async function upsertTopicAndConceptPages(repos, source, text, concepts, entities) {
  const createdPages = [];
  const topicTitle = deriveTopicTitle(source, text) || source.title;
  const topicBaseSlug = slugify(topicTitle);
  const preferredTopicSlug = topicBaseSlug === slugify(source.title) ? `${topicBaseSlug}-topic` : topicBaseSlug;
  const topicSlug = await resolveTypedSlug(repos, preferredTopicSlug, 'topic');
  const existingTopicPage = await repos.pages.findBy('slug', topicSlug);
  const mergedTopicSources = mergeSources(existingTopicPage?.sources, [{ id: source.id, title: source.title }]);
  const mergedTopicEntityIds = mergeStrings([...(existingTopicPage?.entityIds ?? []), ...entities.map((entity) => entity.id)]);
  const mergedTopicKeyPoints = mergeStrings([...(existingTopicPage?.keyPoints ?? []), ...concepts.map((concept) => concept.title)]);
  const topicPage = await upsertPage(repos, {
    id: existingTopicPage?.id,
    title: topicTitle,
    slug: topicSlug,
    type: 'topic',
    tags: mergeStrings([...(existingTopicPage?.tags ?? []), 'topic']),
    sourceIds: mergeStrings([...(existingTopicPage?.sourceIds ?? []), source.id]),
    entityIds: mergedTopicEntityIds,
    summary: summarizeTopic(topicTitle, mergedTopicSources, concepts.length > 0 ? concepts : mergedTopicKeyPoints.map((title) => ({ title })), entities),
    keyPoints: mergedTopicKeyPoints,
    details: topicDetails(topicTitle, mergedTopicSources, concepts.length > 0 ? concepts : mergedTopicKeyPoints.map((title) => ({ title }))),
    relatedPages: mergeRelatedPages(existingTopicPage?.relatedPages, [
      { slug: source.slug, summary: `Source: ${source.title}` },
      ...concepts.map((concept) => ({ slug: concept.slug, summary: `Concept: ${concept.title}` })),
      ...entities.map((entity) => ({ slug: entity.slug, summary: `Entity: ${entity.name}` }))
    ]),
    sources: mergedTopicSources,
    changeNotes: mergeStrings([...(existingTopicPage?.changeNotes ?? []), `Updated from source ${source.id}`])
  });
  createdPages.push(topicPage);

  for (const concept of concepts) {
    const conceptSlug = await resolveTypedSlug(repos, concept.slug, 'concept');
    const existingConceptPage = await repos.pages.findBy('slug', conceptSlug);
    const mergedConceptSources = mergeSources(existingConceptPage?.sources, [{ id: source.id, title: source.title }]);
    const conceptPage = await upsertPage(repos, {
      id: existingConceptPage?.id,
      title: concept.title,
      slug: conceptSlug,
      type: 'concept',
      tags: mergeStrings([...(existingConceptPage?.tags ?? []), 'concept']),
      sourceIds: mergeStrings([...(existingConceptPage?.sourceIds ?? []), source.id]),
      summary: summarizeConcept(concept.title, mergedConceptSources, topicPage.title),
      keyPoints: mergeStrings([...(existingConceptPage?.keyPoints ?? []), topicTitle]),
      details: conceptDetails(concept.title, mergedConceptSources, topicPage),
      relatedPages: mergeRelatedPages(existingConceptPage?.relatedPages, [
        { slug: source.slug, summary: `Source: ${source.title}` },
        { slug: topicPage.slug, summary: `Topic: ${topicPage.title}` }
      ]),
      sources: mergedConceptSources,
      changeNotes: mergeStrings([...(existingConceptPage?.changeNotes ?? []), `Updated from source ${source.id}`])
    });
    createdPages.push(conceptPage);
  }

  return { topicPage, conceptPages: createdPages.filter((page) => page.type === 'concept'), pages: createdPages };
}
