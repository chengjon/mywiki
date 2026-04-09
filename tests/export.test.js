import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

import { createInMemoryRepositories } from '../app/db/repositories.js';
import { exportPage } from '../app/export/export-page.js';
import { upsertPage } from '../app/services/page-service.js';
import { rebuildIndex } from '../app/export/rebuild-index.js';
import { rebuildOverview } from '../app/export/rebuild-overview.js';

test('rebuildIndex writes categorized page links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await rebuildIndex(root, [
    { slug: 'openai', title: 'OpenAI', type: 'entity', summary: 'AI lab' }
  ]);
  const text = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  assert.match(text, /\[\[openai\]\]/);
});

test('rebuildOverview writes a navigation page with key entry points', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const repos = createInMemoryRepositories();

  await repos.sources.insert({ id: 'src_1', title: 'People Notes', sourceType: 'note' });
  await upsertPage(repos, {
    title: 'People Notes',
    slug: 'people-notes',
    type: 'source',
    summary: 'Source page for people notes.'
  });
  await upsertPage(repos, {
    title: 'Sam Altman',
    slug: 'sam-altman',
    type: 'entity',
    summary: 'A person page.'
  });
  await upsertPage(repos, {
    title: 'OpenAI',
    slug: 'openai',
    type: 'topic',
    summary: 'A topic page.'
  });
  await upsertPage(repos, {
    title: 'Sam Altman Query',
    slug: 'sam-altman-query',
    type: 'query',
    summary: 'A filed query.'
  });

  await rebuildOverview(root, repos);

  const overview = await readFile(path.join(root, 'wiki', 'overview', 'mywiki-overview.md'), 'utf8');
  assert.match(overview, /# MyWiki Overview/);
  assert.match(overview, /covering 4 pages and 1 sources/i);
  assert.match(overview, /\[\[sam-altman\]\]/);
  assert.match(overview, /\[\[openai\]\]/);
  assert.match(overview, /\[\[sam-altman-query\]\]/);
});

test('exportPage adds an auto-generated notice to wiki pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const page = {
    id: 'pg_1',
    title: 'Generated Query',
    slug: 'generated-query',
    type: 'query',
    status: 'active',
    tags: ['query'],
    sourceIds: ['src_1'],
    entityIds: [],
    summary: 'Generated summary.',
    keyPoints: ['Generated point'],
    details: 'Question: What is generated?',
    relatedPages: [],
    sources: [{ id: 'src_1', title: 'Generated Source' }],
    openQuestions: [],
    changeNotes: ['Filed from CLI answer'],
    createdAt: '2026-04-09',
    updatedAt: '2026-04-09T00:00:00Z',
    confidence: 'medium'
  };

  await exportPage(root, page);

  const text = await readFile(path.join(root, 'wiki', 'queries', 'generated-query.md'), 'utf8');
  assert.match(text, /^<!-- This file is auto-generated\. Edit via mywiki CLI instead\. -->/);
});
