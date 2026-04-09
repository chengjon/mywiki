import { materializeSource } from '../ingest/read-source.js';
import { chunkText } from '../ingest/chunk-text.js';
import { extractEntities } from '../ingest/extract-entities.js';
import { extractConcepts } from '../ingest/extract-concepts.js';
import { extractRelations } from '../ingest/extract-relations.js';
import { pageDirectoryName } from '../config.js';
import { saveSourceChunks, registerSource } from './source-service.js';
import { upsertPage } from './page-service.js';
import { appendAuditEvent } from './audit-service.js';
import { upsertEntitiesForSource } from './entity-service.js';
import { upsertTopicAndConceptPages } from './topic-service.js';
import { applyConflictQuestions } from './conflict-service.js';
import { exportPage } from '../export/export-page.js';
import { rebuildIndex } from '../export/rebuild-index.js';
import { rebuildLog } from '../export/rebuild-log.js';
import { rebuildOverview } from '../export/rebuild-overview.js';

function summarizeText(text) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 220) || 'No summary generated yet.';
}

function extractKeyPoints(text) {
  return String(text)
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildSourceDetails(source) {
  const lines = [
    `Source type: ${source.sourceType}`,
    source.uri ? `Source URL: ${source.uri}` : null,
    source.storedPath ? `Stored path: ${source.storedPath}` : null,
    source.metadata?.canonicalUrl ? `Canonical URL: ${source.metadata.canonicalUrl}` : null,
    source.metadata?.author ? `Author: ${source.metadata.author}` : null,
    source.metadata?.publishedAt ? `Published: ${source.metadata.publishedAt}` : null,
    source.metadata?.domain ? `Domain: ${source.metadata.domain}` : null,
    source.metadata?.contentDrift ? 'Content drift detected: yes' : null,
    source.metadata?.contentVersionCount ? `Observed versions: ${source.metadata.contentVersionCount}` : null,
    source.metadata?.lastSeenUri ? `Latest observed URL: ${source.metadata.lastSeenUri}` : null
  ].filter(Boolean);

  return lines.join('\n\n');
}

export async function finalizeRepositoryArtifacts(rootDir, repos) {
  await rebuildOverview(rootDir, repos);
  await rebuildIndex(rootDir, await repos.pages.all());
  await rebuildLog(rootDir, await repos.auditLog.all());
}

export async function ingestSource(repos, rootDir, input, options = {}) {
  const rebuildArtifacts = options.rebuildArtifacts ?? true;
  const { text, storedPath, metadata } = await materializeSource({
    rootDir,
    sourceType: input.sourceType,
    title: input.title,
    localPath: input.localPath,
    rawText: input.rawText,
    uri: input.uri
  });

  const source = await registerSource(repos, {
    title: input.title,
    sourceType: input.sourceType,
    uri: input.uri,
    localPath: input.localPath,
    storedPath,
    rawText: text,
    metadata
  });

  const chunks = await saveSourceChunks(repos, source, chunkText(text));
  const extractedEntities = extractEntities(text, { title: source.title });
  const extractedConcepts = extractConcepts(text);
  const extractedRelations = extractRelations(text, extractedEntities);
  const { entities, relations } = await upsertEntitiesForSource(repos, source, extractedEntities, extractedRelations);
  const { topicPage, conceptPages, pages: synthesisPages } = await upsertTopicAndConceptPages(
    repos,
    source,
    text,
    extractedConcepts,
    entities
  );
  const conflictUpdate = await applyConflictQuestions(repos, { topicPage, entities });
  const page = await upsertPage(repos, {
    title: source.title,
    slug: source.slug,
    type: 'source',
    tags: [source.sourceType],
    sourceIds: [source.id],
    entityIds: entities.map((entity) => entity.id),
    summary: summarizeText(text),
    keyPoints: extractKeyPoints(text),
    details: buildSourceDetails(source),
    relatedPages: [
      ...entities.map((entity) => ({
        slug: entity.slug,
        summary: `${entity.name} (${entity.entityType})`
      })),
      { slug: topicPage.slug, summary: `Topic: ${topicPage.title}` },
      ...conceptPages.map((conceptPage) => ({ slug: conceptPage.slug, summary: `Concept: ${conceptPage.title}` }))
    ],
    sources: [{ id: source.id, title: source.title }],
    openQuestions: [],
    changeNotes: [
      `Created from ${source.sourceType} source`,
      `Exported to wiki/${pageDirectoryName('source')}/${source.slug}.md`,
      `Extracted ${entities.length} entities, ${relations.length} relations, and ${conceptPages.length} concepts`
    ]
  });

  const event = await appendAuditEvent(repos, {
    eventType: 'ingest',
    title: source.title,
    details: `Ingested source \`${source.id}\` with ${chunks.length} chunks.`,
    relatedIds: [source.id, page.id]
  });

  await exportPage(rootDir, page);
  for (const entityPage of conflictUpdate.entityPages) {
    await exportPage(rootDir, entityPage);
  }
  const synthesisPageSlugs = new Set([
    ...synthesisPages.map((synthesisPage) => synthesisPage.slug),
    conflictUpdate.topicPage?.slug
  ].filter(Boolean));
  for (const slug of synthesisPageSlugs) {
    const synthesisPage = await repos.pages.findBy('slug', slug);
    if (synthesisPage) {
      await exportPage(rootDir, synthesisPage);
    }
  }
  if (rebuildArtifacts) {
    await finalizeRepositoryArtifacts(rootDir, repos);
  }

  return {
    source,
    page,
    chunks,
    entities,
    relations,
    topicPage: conflictUpdate.topicPage,
    conceptPages,
    event
  };
}
