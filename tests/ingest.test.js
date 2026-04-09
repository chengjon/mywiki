import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

import { chunkText } from '../app/ingest/chunk-text.js';
import { extractEntities } from '../app/ingest/extract-entities.js';
import { extractRelations } from '../app/ingest/extract-relations.js';
import { ensureRepositoryLayout } from '../app/fs.js';
import { materializeSource } from '../app/ingest/read-source.js';

test('chunkText keeps heading context and splits long text', () => {
  const chunks = chunkText('# Title\n\nA short paragraph.\n\n## Part\n\nAnother paragraph.');
  assert.equal(chunks[0].headingPath[0], 'Title');
  assert.equal(chunks[1].headingPath[0], 'Title');
});

test('materializeSource fetches web content when rawText is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('# Web Memory\n\nIn-context learning helps web ingestion.');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/article`;

  try {
    const result = await materializeSource({
      rootDir: root,
      sourceType: 'web',
      title: 'Web Memory',
      uri: url
    });

    assert.match(result.text, /In-context learning helps web ingestion/);
    const stored = await readFile(result.storedPath, 'utf8');
    assert.match(stored, /Source URL:/);
    assert.match(stored, /In-context learning helps web ingestion/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('materializeSource extracts readable markdown-like text from html pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  const html = `<!doctype html>
  <html>
    <head>
      <title>Agent Memory Article</title>
      <style>.hidden{display:none}</style>
      <script>window.bad = true;</script>
    </head>
    <body>
      <main>
        <article>
          <h1>Agent Memory Article</h1>
          <p>In-context learning improves prompting quality.</p>
          <p>Retrieval augmentation improves grounding.</p>
          <ul>
            <li>Tool use helps memory systems.</li>
          </ul>
        </article>
      </main>
    </body>
  </html>`;

  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/article`;

  try {
    const result = await materializeSource({
      rootDir: root,
      sourceType: 'web',
      title: 'Agent Memory Article',
      uri: url
    });

    assert.match(result.text, /# Agent Memory Article/);
    assert.match(result.text, /In-context learning improves prompting quality/);
    assert.match(result.text, /Retrieval augmentation improves grounding/);
    assert.match(result.text, /- Tool use helps memory systems/);
    assert.doesNotMatch(result.text, /window\.bad/);
    assert.doesNotMatch(result.text, /\.hidden/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('materializeSource extracts basic web metadata from html pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);

  const html = `<!doctype html>
  <html>
    <head>
      <title>Metadata Article</title>
      <meta name="author" content="Jane Doe" />
      <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
      <link rel="canonical" href="https://example.com/canonical-article" />
    </head>
    <body>
      <article>
        <h1>Metadata Article</h1>
        <p>OpenAI publishes model updates.</p>
      </article>
    </body>
  </html>`;

  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/article`;

  try {
    const result = await materializeSource({
      rootDir: root,
      sourceType: 'web',
      title: 'Metadata Article',
      uri: url
    });

    assert.equal(result.metadata.domain, '127.0.0.1');
    assert.equal(result.metadata.author, 'Jane Doe');
    assert.equal(result.metadata.publishedAt, '2026-04-08T10:00:00Z');
    assert.equal(result.metadata.canonicalUrl, 'https://example.com/canonical-article');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('extractEntities filters title noise and concept fragments', () => {
  const entities = extractEntities(
    '# Agent Memory\n\nIn-context learning improves prompting quality.\n\nRetrieval augmentation improves grounding.\n\nSam Altman leads OpenAI.',
    { title: 'Agent Memory Notes' }
  );
  const names = entities.map((entity) => entity.name);

  assert.ok(names.includes('Sam Altman'));
  assert.ok(names.includes('OpenAI'));
  assert.ok(!names.includes('Agent Memory'));
  assert.ok(!names.includes('Agent Memory Notes'));
  assert.ok(!names.includes('Agent Memory In'));
  assert.ok(!names.includes('Agent'));
  assert.ok(!names.includes('Memory'));
  assert.ok(!names.includes('Notes'));
  assert.ok(!names.includes('Retrieval'));
});

test('extractRelations handles active and passive relation variants', () => {
  const text = [
    'Anthropic built Claude.',
    'ChatGPT was created by OpenAI.',
    'Sam Altman works for OpenAI.',
    'GPT-4o belongs to OpenAI platform.'
  ].join('\n\n');
  const entities = extractEntities(text);
  const relations = extractRelations(text, entities);

  assert.ok(relations.some((relation) => relation.relationType === 'built_by'));
  assert.ok(relations.some((relation) => relation.relationType === 'created_by'));
  assert.ok(relations.some((relation) => relation.relationType === 'works_at'));
  assert.ok(relations.some((relation) => relation.relationType === 'part_of'));

  const builtBy = relations.find((relation) => relation.relationType === 'built_by');
  const createdBy = relations.find((relation) => relation.relationType === 'created_by');
  const worksAt = relations.find((relation) => relation.relationType === 'works_at');
  const partOf = relations.find((relation) => relation.relationType === 'part_of');

  const byId = new Map(entities.map((entity) => [entity.id, entity.name]));
  assert.equal(byId.get(builtBy.fromId), 'Claude');
  assert.equal(byId.get(builtBy.toId), 'Anthropic');
  assert.equal(byId.get(createdBy.fromId), 'ChatGPT');
  assert.equal(byId.get(createdBy.toId), 'OpenAI');
  assert.equal(byId.get(worksAt.fromId), 'Sam Altman');
  assert.equal(byId.get(worksAt.toId), 'OpenAI');
  assert.equal(byId.get(partOf.fromId), 'GPT-4o');
  assert.equal(byId.get(partOf.toId), 'OpenAI');
});
