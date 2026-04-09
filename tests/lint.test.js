import test from 'node:test';
import assert from 'node:assert/strict';

import { lintWiki } from '../app/lint/lint-wiki.js';

test('lintWiki flags sources that are not integrated into topic pages', async () => {
  const findings = await lintWiki({
    sources: [{ id: 'src_1', title: 'Agent Memory Notes', slug: 'agent-memory-notes' }],
    pages: [
      { slug: 'agent-memory-notes', type: 'source', sourceIds: ['src_1'], relatedPages: [] }
    ]
  });

  assert.ok(findings.some((finding) => finding.code === 'unintegrated-source'));
});

test('lintWiki flags isolated concept pages and topic/source drift', async () => {
  const findings = await lintWiki({
    sources: [{ id: 'src_2', title: 'Web Agents', slug: 'web-agents' }],
    pages: [
      {
        slug: 'web-agents',
        type: 'source',
        sourceIds: ['src_2'],
        relatedPages: [{ slug: 'web-agents-topic', summary: 'Topic: Web Agents' }]
      },
      {
        slug: 'web-agents-topic',
        type: 'topic',
        sourceIds: [],
        relatedPages: []
      },
      {
        slug: 'in-context-learning',
        type: 'concept',
        sourceIds: ['src_2'],
        relatedPages: []
      }
    ]
  });

  assert.ok(findings.some((finding) => finding.code === 'topic-source-drift'));
  assert.ok(findings.some((finding) => finding.code === 'isolated-concept'));
});

test('lintWiki flags missing web metadata and content drift for review', async () => {
  const findings = await lintWiki({
    sources: [
      {
        id: 'src_3',
        title: 'Metadata Light Web Source',
        slug: 'metadata-light-web-source',
        sourceType: 'web',
        metadata: {
          domain: 'example.com'
        }
      },
      {
        id: 'src_4',
        title: 'Drifting Web Source',
        slug: 'drifting-web-source',
        sourceType: 'web',
        metadata: {
          domain: 'example.com',
          canonicalUrl: 'https://example.com/post',
          contentDrift: true,
          contentVersionCount: 2
        }
      }
    ],
    pages: [
      { slug: 'metadata-light-web-source', type: 'source', sourceIds: ['src_3'], relatedPages: [] },
      { slug: 'drifting-web-source', type: 'source', sourceIds: ['src_4'], relatedPages: [] },
      { slug: 'example-topic', type: 'topic', sourceIds: ['src_3', 'src_4'], relatedPages: [] }
    ]
  });

  assert.ok(findings.some((finding) => finding.code === 'missing-web-metadata' && /author/.test(finding.message)));
  assert.ok(findings.some((finding) => finding.code === 'missing-web-metadata' && /publishedAt/.test(finding.message)));
  assert.ok(findings.some((finding) => finding.code === 'content-drift'));
});

test('lintWiki does not require source backing for overview navigation pages', async () => {
  const findings = await lintWiki({
    pages: [
      {
        slug: 'mywiki-overview',
        type: 'overview',
        sourceIds: [],
        relatedPages: [{ slug: 'openai', summary: 'Topic: OpenAI' }]
      },
      {
        slug: 'openai',
        type: 'topic',
        sourceIds: ['src_1'],
        relatedPages: []
      }
    ],
    sources: [{ id: 'src_1', slug: 'openai-notes', sourceType: 'note' }]
  });

  assert.ok(!findings.some((finding) => finding.code === 'missing-sources' && finding.page === 'mywiki-overview'));
});
