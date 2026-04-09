import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import { createInMemoryRepositories } from '../app/db/repositories.js';
import { registerSource } from '../app/services/source-service.js';
import { ingestSource } from '../app/services/ingest-service.js';
import { upsertPage } from '../app/services/page-service.js';
import { createComparisonPage } from '../app/services/comparison-service.js';
import { createTimelinePage } from '../app/services/timeline-service.js';
import { classifyArtifactQuestion, resolveArtifactRoute } from '../app/services/artifact-router.js';
import { findMergeableQueryPage, findSimilarQueryPages } from '../app/services/query-page-service.js';
import { ensureRepositoryLayout } from '../app/fs.js';

test('registerSource stores normalized source metadata', async () => {
  const repos = createInMemoryRepositories();
  const source = await registerSource(repos, {
    title: 'Test Source',
    sourceType: 'note',
    rawText: 'hello'
  });

  assert.equal(source.slug, 'test-source');
  assert.equal((await repos.sources.all()).length, 1);
});

test('registerSource deduplicates exact-content repeats and keeps aliases', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'Agent Memory Notes',
    sourceType: 'note',
    rawText: 'same content'
  });
  const second = await registerSource(repos, {
    title: 'Agent Memory Duplicate',
    sourceType: 'note',
    rawText: 'same content'
  });

  const sources = await repos.sources.all();
  assert.equal(sources.length, 1);
  assert.equal(first.id, second.id);
  assert.ok(sources[0].aliases.includes('Agent Memory Duplicate'));
});

test('registerSource tracks local path history when duplicate content arrives from a renamed file', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'OpenAI Notes',
    sourceType: 'file',
    localPath: '/repo/raw/inbox/01-openai-notes.md',
    rawText: 'same content'
  });
  const second = await registerSource(repos, {
    title: 'OpenAI Notes Renamed',
    sourceType: 'file',
    localPath: '/repo/raw/inbox/02-openai-notes-renamed.md',
    rawText: 'same content'
  });

  const sources = await repos.sources.all();
  assert.equal(first.id, second.id);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].localPath, '/repo/raw/inbox/02-openai-notes-renamed.md');
  assert.equal(sources[0].metadata.lastSeenLocalPath, '/repo/raw/inbox/02-openai-notes-renamed.md');
  assert.deepEqual(
    sources[0].metadata.localPathHistory,
    [
      '/repo/raw/inbox/01-openai-notes.md',
      '/repo/raw/inbox/02-openai-notes-renamed.md'
    ]
  );
});

test('ingestSource extracts entities and source-to-entity relations', async () => {
  const repos = createInMemoryRepositories();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'OpenAI Notes',
    rawText: '# OpenAI\n\nSam Altman leads OpenAI.\n\nGPT-4o is an OpenAI model.'
  });

  const entities = await repos.entities.all();
  const relations = await repos.relations.all();
  const pages = await repos.pages.all();

  assert.ok(entities.some((entity) => entity.name === 'OpenAI'));
  assert.ok(entities.some((entity) => entity.name === 'Sam Altman'));
  assert.ok(relations.some((relation) => relation.relationType === 'mentions_entity'));
  assert.ok(relations.some((relation) => relation.relationType === 'leads'));
  assert.ok(pages.some((page) => page.type === 'entity' && page.slug === 'openai'));
});

test('ingestSource creates topic and concept pages for durable synthesis', async () => {
  const repos = createInMemoryRepositories();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'Agent Memory Notes',
    rawText: '# Agent Memory\n\nIn-context learning improves prompting quality.\n\nRetrieval augmentation helps grounding.\n\nTool use supports agent memory systems.'
  });

  const pages = await repos.pages.all();

  assert.ok(pages.some((page) => page.type === 'topic' && page.slug === 'agent-memory'));
  assert.ok(pages.some((page) => page.type === 'concept' && page.slug === 'in-context-learning'));
  assert.ok(pages.some((page) => page.type === 'concept' && page.slug === 'retrieval-augmentation'));
});

test('ingestSource merges later sources into richer topic and concept syntheses', async () => {
  const repos = createInMemoryRepositories();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'Agent Memory Notes',
    rawText: '# Agent Memory\n\nIn-context learning improves prompting quality.\n\nTool use supports agent memory systems.'
  });

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'Agent Memory Article',
    rawText: '# Agent Memory\n\nRetrieval augmentation improves grounding.\n\nIn-context learning benefits from better examples.'
  });

  const topicPage = (await repos.pages.all()).find((page) => page.type === 'topic' && page.slug === 'agent-memory');
  const conceptPage = (await repos.pages.all()).find((page) => page.type === 'concept' && page.slug === 'in-context-learning');

  assert.equal(topicPage.sourceIds.length, 2);
  assert.match(topicPage.summary, /2 sources/);
  assert.ok(topicPage.keyPoints.includes('In-Context Learning'));
  assert.ok(topicPage.keyPoints.includes('Retrieval Augmentation'));
  assert.match(topicPage.details, /Retrieval Augmentation/);

  assert.equal(conceptPage.sourceIds.length, 2);
  assert.match(conceptPage.summary, /2 sources/);
  assert.ok(conceptPage.relatedPages.some((page) => page.slug === 'agent-memory'));
});

test('ingestSource records entity relation conflicts into entity and topic open questions', async () => {
  const repos = createInMemoryRepositories();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'OpenAI Notes',
    rawText: '# OpenAI\n\nSam Altman works for OpenAI.'
  });

  await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'OpenAI Career Update',
    rawText: '# OpenAI\n\nSam Altman works for Anthropic.'
  });

  const pages = await repos.pages.all();
  const entityPage = pages.find((page) => page.type === 'entity' && page.slug === 'sam-altman');
  const topicPage = pages.find((page) => page.type === 'topic' && page.slug === 'openai-topic');

  assert.ok(entityPage.openQuestions.some((entry) => /Sam Altman/.test(entry) && /works_at/.test(entry) && /OpenAI/.test(entry) && /Anthropic/.test(entry)));
  assert.ok(topicPage.openQuestions.some((entry) => /Sam Altman/.test(entry) && /works_at/.test(entry)));
});

test('ingestSource avoids duplicate source pages for repeated identical content', async () => {
  const repos = createInMemoryRepositories();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  const first = await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'OpenAI Notes',
    rawText: '# OpenAI\n\nSam Altman leads OpenAI.'
  });
  const second = await ingestSource(repos, root, {
    sourceType: 'note',
    title: 'OpenAI Notes Copy',
    rawText: '# OpenAI\n\nSam Altman leads OpenAI.'
  });

  const sources = await repos.sources.all();
  const pages = await repos.pages.all();

  assert.equal(first.source.id, second.source.id);
  assert.equal(sources.length, 1);
  assert.equal(pages.filter((page) => page.type === 'source').length, 1);
});

test('registerSource reuses existing source for repeated uri imports', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'Anthropic Note',
    sourceType: 'web',
    uri: 'https://example.com/anthropic',
    rawText: 'first version'
  });
  const second = await registerSource(repos, {
    title: 'Anthropic Note Refresh',
    sourceType: 'web',
    uri: 'https://example.com/anthropic',
    rawText: 'updated version'
  });

  const sources = await repos.sources.all();
  assert.equal(sources.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(sources[0].uri, 'https://example.com/anthropic');
  assert.ok(sources[0].aliases.includes('Anthropic Note Refresh'));
});

test('registerSource reuses existing source for repeated canonical urls', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'Canonical Note',
    sourceType: 'web',
    uri: 'https://example.com/post?ref=feed',
    rawText: 'first canonical version',
    metadata: {
      canonicalUrl: 'https://example.com/post'
    }
  });
  const second = await registerSource(repos, {
    title: 'Canonical Note Refresh',
    sourceType: 'web',
    uri: 'https://example.com/post?utm_source=rss',
    rawText: 'second canonical version',
    metadata: {
      canonicalUrl: 'https://example.com/post'
    }
  });

  const sources = await repos.sources.all();
  assert.equal(first.id, second.id);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].metadata.canonicalUrl, 'https://example.com/post');
  assert.ok(sources[0].aliases.includes('Canonical Note Refresh'));
});

test('registerSource stores and merges source metadata fields', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'Metadata Note',
    sourceType: 'web',
    uri: 'https://example.com/post',
    rawText: 'metadata text',
    metadata: {
      domain: 'example.com',
      author: 'Jane Doe',
      publishedAt: '2026-04-08T10:00:00Z'
    }
  });
  const second = await registerSource(repos, {
    title: 'Metadata Note Refresh',
    sourceType: 'web',
    uri: 'https://example.com/post',
    rawText: 'metadata text updated',
    metadata: {
      canonicalUrl: 'https://example.com/canonical-post'
    }
  });

  const sources = await repos.sources.all();
  assert.equal(first.id, second.id);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].metadata.domain, 'example.com');
  assert.equal(sources[0].metadata.author, 'Jane Doe');
  assert.equal(sources[0].metadata.publishedAt, '2026-04-08T10:00:00Z');
  assert.equal(sources[0].metadata.canonicalUrl, 'https://example.com/canonical-post');
});

test('registerSource marks content drift when canonical source text changes', async () => {
  const repos = createInMemoryRepositories();
  const first = await registerSource(repos, {
    title: 'Drift Note',
    sourceType: 'web',
    uri: 'https://example.com/post?ref=feed',
    rawText: 'first version',
    metadata: {
      canonicalUrl: 'https://example.com/post',
      domain: 'example.com'
    }
  });
  const second = await registerSource(repos, {
    title: 'Drift Note Refresh',
    sourceType: 'web',
    uri: 'https://example.com/post?utm_source=rss',
    rawText: 'second version',
    metadata: {
      canonicalUrl: 'https://example.com/post',
      domain: 'example.com'
    }
  });

  const source = (await repos.sources.all())[0];
  assert.equal(first.id, second.id);
  assert.equal(source.metadata.contentDrift, true);
  assert.equal(source.metadata.contentVersionCount, 2);
  assert.ok(Array.isArray(source.metadata.checksumHistory));
  assert.equal(source.metadata.checksumHistory.length, 2);
});

test('createComparisonPage builds a structured comparison from two wiki pages', async () => {
  const repos = createInMemoryRepositories();

  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai',
    type: 'topic',
    sourceIds: ['src_1', 'src_shared'],
    summary: 'OpenAI is an AI lab and product company.',
    keyPoints: ['GPT-4o', 'API platform', 'ChatGPT'],
    relatedPages: [
      { slug: 'sam-altman', summary: 'Entity: Sam Altman' },
      { slug: 'gpt-4o', summary: 'Concept: GPT-4o' }
    ],
    sources: [
      { id: 'src_1', title: 'OpenAI Notes' },
      { id: 'src_shared', title: 'Industry Comparison' }
    ],
    openQuestions: ['How should OpenAI platform shifts be tracked over time?']
  });

  await upsertPage(repos, {
    title: 'Anthropic',
    slug: 'anthropic',
    type: 'topic',
    sourceIds: ['src_2', 'src_shared'],
    summary: 'Anthropic is an AI safety and model company.',
    keyPoints: ['Claude', 'API platform', 'Safety focus'],
    relatedPages: [
      { slug: 'dario-amodei', summary: 'Entity: Dario Amodei' },
      { slug: 'gpt-4o', summary: 'Concept: GPT-4o' }
    ],
    sources: [
      { id: 'src_2', title: 'Anthropic Notes' },
      { id: 'src_shared', title: 'Industry Comparison' }
    ],
    openQuestions: ['How should Anthropic releases be compared to OpenAI releases?']
  });

  const page = await createComparisonPage(repos, {
    leftSlug: 'openai',
    rightSlug: 'anthropic',
    title: 'OpenAI vs Anthropic'
  });

  assert.equal(page.type, 'comparison');
  assert.equal(page.slug, 'openai-vs-anthropic');
  assert.match(page.summary, /OpenAI/);
  assert.match(page.summary, /Anthropic/);
  assert.match(page.details, /### Left/);
  assert.match(page.details, /### Right/);
  assert.match(page.details, /### Overlap/);
  assert.match(page.details, /### Differences/);
  assert.match(page.details, /### Comparison Basis/);
  assert.match(page.details, /API platform/);
  assert.match(page.details, /src_shared/);
  assert.ok(page.relatedPages.some((entry) => entry.slug === 'openai'));
  assert.ok(page.relatedPages.some((entry) => entry.slug === 'anthropic'));
  assert.ok(page.sources.some((entry) => entry.id === 'src_1'));
  assert.ok(page.sources.some((entry) => entry.id === 'src_2'));
  assert.ok(page.sources.some((entry) => entry.id === 'src_shared'));
  assert.ok(page.openQuestions.some((entry) => /OpenAI platform shifts/.test(entry)));
  assert.ok(page.openQuestions.some((entry) => /Anthropic releases/.test(entry)));
});

test('createComparisonPage can resolve typed pages from a base slug', async () => {
  const repos = createInMemoryRepositories();

  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai',
    type: 'entity',
    summary: 'OpenAI entity page.'
  });
  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai-topic',
    type: 'topic',
    summary: 'OpenAI topic page.',
    keyPoints: ['ChatGPT', 'API platform']
  });
  await upsertPage(repos, {
    title: 'Anthropic',
    slug: 'anthropic',
    type: 'entity',
    summary: 'Anthropic entity page.'
  });
  await upsertPage(repos, {
    title: 'Anthropic',
    slug: 'anthropic-topic',
    type: 'topic',
    summary: 'Anthropic topic page.',
    keyPoints: ['Claude', 'API platform']
  });

  const page = await createComparisonPage(repos, {
    leftSlug: 'openai',
    leftType: 'topic',
    rightSlug: 'anthropic',
    rightType: 'topic',
    title: 'OpenAI Topic vs Anthropic Topic'
  });

  assert.equal(page.slug, 'openai-topic-vs-anthropic-topic');
  assert.match(page.details, /\[\[openai-topic\]\]/);
  assert.match(page.details, /\[\[anthropic-topic\]\]/);
  assert.doesNotMatch(page.details, /OpenAI entity page/);
  assert.match(page.keyPoints.join('\n'), /Shared key points: API platform/);
});

test('createTimelinePage builds a dated timeline from sources related pages and audit trail', async () => {
  const repos = createInMemoryRepositories();

  await repos.sources.insert({
    id: 'src_1',
    title: 'OpenAI Launch Post',
    slug: 'openai-launch-post',
    sourceType: 'web',
    capturedAt: '2026-04-02',
    metadata: {
      publishedAt: '2026-04-01T09:00:00Z'
    }
  });
  await repos.sources.insert({
    id: 'src_2',
    title: 'OpenAI Followup Note',
    slug: 'openai-followup-note',
    sourceType: 'note',
    capturedAt: '2026-04-05',
    metadata: {}
  });

  const targetPage = await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai',
    type: 'entity',
    sourceIds: ['src_1', 'src_2'],
    summary: 'OpenAI is an AI lab and product company.',
    keyPoints: ['ChatGPT', 'API platform'],
    relatedPages: [{ slug: 'openai-notes', summary: 'Source: OpenAI Notes' }],
    sources: [
      { id: 'src_1', title: 'OpenAI Launch Post' },
      { id: 'src_2', title: 'OpenAI Followup Note' }
    ],
    openQuestions: ['How should OpenAI product milestones be grouped?']
  });

  await upsertPage(repos, {
    title: 'OpenAI Query',
    slug: 'openai-query',
    type: 'query',
    sourceIds: ['src_1'],
    summary: 'A durable query about OpenAI.',
    relatedPages: [],
    createdAt: '2026-04-06',
    updatedAt: '2026-04-06T10:00:00Z'
  });

  await upsertPage(repos, {
    title: 'MyWiki Overview',
    slug: 'mywiki-overview',
    type: 'overview',
    relatedPages: [{ slug: 'openai', summary: 'Entity: OpenAI' }],
    createdAt: '2026-04-06',
    updatedAt: '2026-04-06T11:00:00Z'
  });

  await repos.auditLog.insert({
    id: 'evt_1',
    eventType: 'comparison',
    title: 'OpenAI vs Anthropic',
    details: 'Compared [[openai]] with [[anthropic]] into [[openai-vs-anthropic]].',
    relatedIds: [targetPage.id],
    createdAt: '2026-04-07T12:00:00Z'
  });

  const page = await createTimelinePage(repos, {
    slug: 'openai',
    title: 'OpenAI Timeline'
  });

  assert.equal(page.type, 'timeline');
  assert.equal(page.slug, 'openai-timeline');
  assert.match(page.summary, /OpenAI/);
  assert.match(page.summary, /dated events/i);
  assert.match(page.details, /### Chronology/);
  assert.match(page.details, /2026-04-01T09:00:00Z/);
  assert.match(page.details, /2026-04-05/);
  assert.match(page.details, /OpenAI Query/);
  assert.match(page.details, /OpenAI vs Anthropic/);
  assert.match(page.details, /### Supporting Sources/);
  assert.match(page.details, /### Related Pages/);
  assert.match(page.details, /### Audit Trail/);
  assert.doesNotMatch(page.details, /MyWiki Overview/);
  assert.ok(page.relatedPages.some((entry) => entry.slug === 'openai'));
  assert.ok(page.relatedPages.some((entry) => entry.slug === 'openai-query'));
  assert.ok(!page.relatedPages.some((entry) => entry.slug === 'mywiki-overview'));
  assert.ok(page.sources.some((entry) => entry.id === 'src_1'));
  assert.ok(page.sources.some((entry) => entry.id === 'src_2'));
  assert.ok(page.openQuestions.some((entry) => /OpenAI product milestones/.test(entry)));
});

test('artifact router classifies questions and resolves comparison or timeline targets', async () => {
  const repos = createInMemoryRepositories();

  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai',
    type: 'entity',
    summary: 'OpenAI entity page.'
  });
  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai-topic',
    type: 'topic',
    summary: 'OpenAI topic page.'
  });
  await upsertPage(repos, {
    title: 'Anthropic',
    slug: 'anthropic',
    type: 'entity',
    summary: 'Anthropic entity page.'
  });
  await upsertPage(repos, {
    title: 'Anthropic',
    slug: 'anthropic-topic',
    type: 'topic',
    summary: 'Anthropic topic page.'
  });
  await repos.entities.insert({ id: 'ent_1', name: 'OpenAI', slug: 'openai', entityType: 'organization' });
  await repos.entities.insert({ id: 'ent_2', name: 'Anthropic', slug: 'anthropic', entityType: 'organization' });

  assert.equal(classifyArtifactQuestion('OpenAI 和 Anthropic 有什么区别？'), 'comparison');
  assert.equal(classifyArtifactQuestion('OpenAI 时间线'), 'timeline');
  assert.equal(classifyArtifactQuestion('Who is Sam Altman?'), 'query');

  const comparisonRoute = await resolveArtifactRoute(repos, {
    question: 'OpenAI 和 Anthropic 有什么区别？'
  });
  assert.equal(comparisonRoute.type, 'comparison');
  assert.equal(comparisonRoute.left.slug, 'openai-topic');
  assert.equal(comparisonRoute.right.slug, 'anthropic-topic');

  const timelineRoute = await resolveArtifactRoute(repos, {
    question: 'OpenAI 时间线'
  });
  assert.equal(timelineRoute.type, 'timeline');
  assert.equal(timelineRoute.target.slug, 'openai-topic');
});

test('findMergeableQueryPage matches durable queries by slug title and normalized question', async () => {
  const repos = createInMemoryRepositories();

  await upsertPage(repos, {
    title: 'OpenAI Identity Query',
    slug: 'openai-identity-query',
    type: 'query',
    summary: 'Who OpenAI is.',
    details: 'Question: Who is OpenAI?\n\nEvidence:\n- OpenAI builds models.'
  });

  const bySlug = await findMergeableQueryPage(repos, {
    slug: 'openai-identity-query',
    title: 'Other Title',
    question: 'Different question'
  });
  assert.equal(bySlug.page.slug, 'openai-identity-query');
  assert.equal(bySlug.reason, 'slug');

  const byTitle = await findMergeableQueryPage(repos, {
    title: 'OpenAI Identity Query',
    question: 'Another wording'
  });
  assert.equal(byTitle.page.slug, 'openai-identity-query');
  assert.equal(byTitle.reason, 'title');

  const byQuestion = await findMergeableQueryPage(repos, {
    title: 'Completely Different Title',
    question: 'Who is OpenAI'
  });
  assert.equal(byQuestion.page.slug, 'openai-identity-query');
  assert.equal(byQuestion.reason, 'question');
});

test('findSimilarQueryPages returns explainable similarity candidates without exact merge', async () => {
  const repos = createInMemoryRepositories();

  await upsertPage(repos, {
    title: 'OpenAI Platform Overview',
    slug: 'openai-platform-overview',
    type: 'query',
    summary: 'Overview of the OpenAI platform.',
    details: 'Question: Explain the OpenAI platform overview\n\nEvidence:\n- OpenAI offers APIs.'
  });

  const candidates = await findSimilarQueryPages(repos, {
    title: 'OpenAI Platform Summary',
    question: 'Summarize the OpenAI platform overview'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].page.slug, 'openai-platform-overview');
  assert.ok(candidates[0].score >= 0.5);
  assert.ok(candidates[0].overlapTerms.includes('openai'));
  assert.ok(candidates[0].overlapTerms.includes('platform'));
  assert.ok(candidates[0].reasons.some((reason) => /overlapping terms/i.test(reason)));
});
