import test from 'node:test';
import assert from 'node:assert/strict';

import { answerQuestion } from '../app/query/ask.js';

test('answerQuestion prefers wiki pages before source chunks', async () => {
  const result = await answerQuestion({
    question: 'What is OpenAI?',
    pages: [{ title: 'OpenAI', slug: 'openai', summary: 'An AI research and product company.' }],
    chunks: [{ sourceId: 'src_1', text: 'OpenAI builds models.' }]
  });

  assert.match(result.answer, /## Answer/);
  assert.match(result.answer, /OpenAI/);
  assert.match(result.answer, /## Sources/);
  assert.equal(result.citations[0].type, 'page');
});

test('answerQuestion uses entities and relations to build a grounded answer', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_2', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_2', relationType: 'leads' }
    ],
    pages: [
      { title: 'Sam Altman', slug: 'sam-altman', type: 'entity', summary: 'A technology executive linked to OpenAI.' },
      { title: 'OpenAI Notes', slug: 'openai-notes', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman leads OpenAI.' }
    ],
    chunks: [{ id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman leads OpenAI.' }]
  });

  assert.match(result.answer, /## Answer/);
  assert.match(result.answer, /Sam Altman/);
  assert.match(result.answer, /## Relations/);
  assert.match(result.answer, /leads OpenAI/);
  assert.match(result.answer, /## Evidence/);
  assert.equal(result.citations[0].type, 'entity');
  assert.ok(result.citations.some((citation) => citation.type === 'relation'));
  assert.ok(result.citations.some((citation) => citation.type === 'page'));
});

test('answerQuestion includes source metadata in evidence and source citations', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_2', fromType: 'source', fromId: 'src_2', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_3', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_2', relationType: 'leads' }
    ],
    pages: [
      { title: 'Sam Altman', slug: 'sam-altman', type: 'entity', summary: 'A technology executive linked to OpenAI.' },
      { title: 'OpenAI Blog', slug: 'openai-blog', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman leads OpenAI.' },
      { title: 'Industry Note', slug: 'industry-note', type: 'source', sourceIds: ['src_2'], summary: 'Sam Altman is associated with OpenAI.' }
    ],
    sources: [
      {
        id: 'src_1',
        title: 'OpenAI Blog',
        metadata: {
          author: 'Jane Doe',
          domain: 'openai.com',
          publishedAt: '2026-04-08T10:00:00Z'
        }
      },
      {
        id: 'src_2',
        title: 'Industry Note',
        metadata: {
          domain: 'news.example',
          publishedAt: '2026-04-01T10:00:00Z'
        }
      }
    ],
    chunks: [
      { id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman leads OpenAI.' },
      { id: 'chk_2', sourceId: 'src_2', text: 'Sam Altman is associated with OpenAI.' }
    ]
  });

  assert.match(result.answer, /## Sources/);
  assert.match(result.answer, /Jane Doe/);
  assert.match(result.answer, /openai\.com/);
  assert.ok(result.answer.indexOf('OpenAI Blog') < result.answer.indexOf('Industry Note'));
  assert.ok(result.citations.some((citation) => citation.type === 'source' && citation.sourceId === 'src_1'));
});

test('answerQuestion surfaces entity open questions when knowledge conflicts exist', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' }
    ],
    pages: [
      {
        title: 'Sam Altman',
        slug: 'sam-altman',
        type: 'entity',
        summary: 'A technology executive linked to AI labs.',
        openQuestions: [
          'Conflict: Sam Altman has multiple works_at targets across sources: Anthropic, OpenAI. Which one is current?'
        ]
      },
      { title: 'OpenAI Notes', slug: 'openai-notes', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman leads OpenAI.' }
    ],
    chunks: [{ id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman leads OpenAI.' }]
  });

  assert.match(result.answer, /unresolved conflicts/i);
  assert.match(result.answer, /## Open Questions/);
  assert.match(result.answer, /multiple works_at targets/);
  assert.match(result.answer, /Anthropic/);
});

test('answerQuestion prioritizes newer better-attributed sources when conflicts exist', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    preferences: {
      conflictResolution: {
        order: ['publishedAt', 'metadataCompleteness']
      }
    },
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' },
      { id: 'ent_3', name: 'Anthropic', slug: 'anthropic', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_2', fromType: 'source', fromId: 'src_2', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_3', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_2', relationType: 'works_at', evidenceSourceIds: ['src_1'] },
      { id: 'rel_4', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_3', relationType: 'works_at', evidenceSourceIds: ['src_2'] }
    ],
    pages: [
      {
        title: 'Sam Altman',
        slug: 'sam-altman',
        type: 'entity',
        summary: 'A technology executive linked to AI labs.',
        openQuestions: [
          'Conflict: Sam Altman has multiple works_at targets across sources: Anthropic, OpenAI. Which one is current?'
        ]
      },
      { title: 'Older Source', slug: 'older-source', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman works for OpenAI.' },
      { title: 'Newer Source', slug: 'newer-source', type: 'source', sourceIds: ['src_2'], summary: 'Sam Altman works for Anthropic.' }
    ],
    sources: [
      {
        id: 'src_1',
        title: 'Older Source',
        metadata: {
          domain: 'older.example',
          publishedAt: '2026-04-01T10:00:00Z'
        }
      },
      {
        id: 'src_2',
        title: 'Newer Source',
        metadata: {
          domain: 'newer.example',
          author: 'Jane Doe',
          canonicalUrl: 'https://newer.example/post',
          publishedAt: '2026-04-08T10:00:00Z'
        }
      }
    ],
    chunks: [
      { id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman works for OpenAI.' },
      { id: 'chk_2', sourceId: 'src_2', text: 'Sam Altman works for Anthropic.' }
    ]
  });

  assert.match(result.answer, /leans toward Anthropic/i);
  assert.match(result.answer, /newer/i);
});

test('answerQuestion respects configured conflict preference order', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    preferences: {
      conflictResolution: {
        order: ['metadataCompleteness', 'publishedAt']
      }
    },
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' },
      { id: 'ent_3', name: 'Anthropic', slug: 'anthropic', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_2', fromType: 'source', fromId: 'src_2', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_3', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_2', relationType: 'works_at', evidenceSourceIds: ['src_1'] },
      { id: 'rel_4', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_3', relationType: 'works_at', evidenceSourceIds: ['src_2'] }
    ],
    pages: [
      {
        title: 'Sam Altman',
        slug: 'sam-altman',
        type: 'entity',
        summary: 'A technology executive linked to AI labs.',
        openQuestions: [
          'Conflict: Sam Altman has multiple works_at targets across sources: Anthropic, OpenAI. Which one is current?'
        ]
      },
      { title: 'Richer Source', slug: 'richer-source', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman works for OpenAI.' },
      { title: 'Newer Source', slug: 'newer-source', type: 'source', sourceIds: ['src_2'], summary: 'Sam Altman works for Anthropic.' }
    ],
    sources: [
      {
        id: 'src_1',
        title: 'Richer Source',
        metadata: {
          domain: 'richer.example',
          author: 'Jane Doe',
          canonicalUrl: 'https://richer.example/post',
          publishedAt: '2026-04-01T10:00:00Z'
        }
      },
      {
        id: 'src_2',
        title: 'Newer Source',
        metadata: {
          domain: 'newer.example',
          publishedAt: '2026-04-08T10:00:00Z'
        }
      }
    ],
    chunks: [
      { id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman works for OpenAI.' },
      { id: 'chk_2', sourceId: 'src_2', text: 'Sam Altman works for Anthropic.' }
    ]
  });

  assert.match(result.answer, /leans toward OpenAI/i);
  assert.match(result.answer, /richer source metadata/i);
});

test('answerQuestion respects configured source type weights', async () => {
  const result = await answerQuestion({
    question: 'Who is Sam Altman?',
    preferences: {
      conflictResolution: {
        order: ['sourceTypeWeight', 'publishedAt', 'metadataCompleteness'],
        sourceTypeWeights: {
          note: 50,
          web: 10
        }
      }
    },
    entities: [
      { id: 'ent_1', name: 'Sam Altman', slug: 'sam-altman', entityType: 'person' },
      { id: 'ent_2', name: 'OpenAI', slug: 'openai', entityType: 'organization' },
      { id: 'ent_3', name: 'Anthropic', slug: 'anthropic', entityType: 'organization' }
    ],
    relations: [
      { id: 'rel_1', fromType: 'source', fromId: 'src_1', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_2', fromType: 'source', fromId: 'src_2', toType: 'entity', toId: 'ent_1', relationType: 'mentions_entity' },
      { id: 'rel_3', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_2', relationType: 'works_at', evidenceSourceIds: ['src_1'] },
      { id: 'rel_4', fromType: 'entity', fromId: 'ent_1', toType: 'entity', toId: 'ent_3', relationType: 'works_at', evidenceSourceIds: ['src_2'] }
    ],
    pages: [
      {
        title: 'Sam Altman',
        slug: 'sam-altman',
        type: 'entity',
        summary: 'A technology executive linked to AI labs.',
        openQuestions: [
          'Conflict: Sam Altman has multiple works_at targets across sources: Anthropic, OpenAI. Which one is current?'
        ]
      },
      { title: 'Trusted Note', slug: 'trusted-note', type: 'source', sourceIds: ['src_1'], summary: 'Sam Altman works for OpenAI.' },
      { title: 'Fresh Web Story', slug: 'fresh-web-story', type: 'source', sourceIds: ['src_2'], summary: 'Sam Altman works for Anthropic.' }
    ],
    sources: [
      {
        id: 'src_1',
        title: 'Trusted Note',
        sourceType: 'note',
        metadata: {}
      },
      {
        id: 'src_2',
        title: 'Fresh Web Story',
        sourceType: 'web',
        metadata: {
          domain: 'news.example',
          author: 'Jane Doe',
          canonicalUrl: 'https://news.example/story',
          publishedAt: '2026-04-08T10:00:00Z'
        }
      }
    ],
    chunks: [
      { id: 'chk_1', sourceId: 'src_1', text: 'Sam Altman works for OpenAI.' },
      { id: 'chk_2', sourceId: 'src_2', text: 'Sam Altman works for Anthropic.' }
    ]
  });

  assert.match(result.answer, /leans toward OpenAI/i);
  assert.match(result.answer, /note sources are ranked above web/i);
});

test('answerQuestion structures chunk fallback responses', async () => {
  const result = await answerQuestion({
    question: 'What helps grounding?',
    chunks: [{ id: 'chk_1', sourceId: 'src_1', text: 'Retrieval augmentation helps grounding.' }]
  });

  assert.match(result.answer, /## Answer/);
  assert.match(result.answer, /Retrieval augmentation helps grounding/);
  assert.match(result.answer, /## Evidence/);
  assert.equal(result.citations[0].type, 'chunk');
});
