import { createId, slugify } from '../config.js';

const stopwords = new Set([
  'The',
  'This',
  'That',
  'These',
  'Those',
  'And',
  'But',
  'For',
  'With',
  'From',
  'When',
  'Where',
  'What',
  'Why',
  'How'
]);

const titleNoiseWords = new Set([
  'Notes',
  'Note',
  'Article',
  'Paper',
  'Summary',
  'Source',
  'Transcript',
  'Guide',
  'Overview'
]);

const commonTopicWords = new Set([
  'Agent',
  'Memory',
  'Retrieval',
  'Augmentation',
  'Learning',
  'Prompting',
  'Grounding',
  'Systems',
  'Tool',
  'Use',
  'Web'
]);

function normalizeName(name) {
  return name.replace(/\s+/g, ' ').trim();
}

function classifyEntity(name) {
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(name)) {
    return 'person';
  }
  if (/(AI|Labs|Inc|Corp|Company|OpenAI|Anthropic)$/i.test(name)) {
    return 'organization';
  }
  if (/[A-Z]{2,}[-\dA-Za-z]*/.test(name)) {
    return 'tool';
  }
  return 'concept';
}

function looksLikeStableSingleWord(name, count) {
  if (count < 2) {
    return /(OpenAI|Anthropic|DeepMind|Claude|ChatGPT|Gemini|GPT-\d+[A-Za-z0-9-]*)/i.test(name) || /[A-Z]{2,}/.test(name);
  }
  return true;
}

function looksLikeTopicPhrase(name) {
  const words = name.split(' ');
  return words.length > 1 && words.every((word) => commonTopicWords.has(word) || titleNoiseWords.has(word));
}

function buildSegments(text) {
  return String(text)
    .replace(/\r/g, '')
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((segment) => segment.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean);
}

export function extractEntities(text, options = {}) {
  const candidates = new Map();
  const counts = new Map();
  const segments = buildSegments(text);

  for (const segment of segments) {
    const multiMatches = [
      ...segment.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g),
      ...segment.matchAll(/\b[A-Z][A-Za-z0-9-]*[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\b/g)
    ];

    for (const match of multiMatches) {
      const name = normalizeName(match[0]);
      if (name.length < 3) {
        continue;
      }
      const words = name.split(' ');
      if (words.some((word) => stopwords.has(word) || titleNoiseWords.has(word))) {
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const singleMatches = [...segment.matchAll(/\b[A-Z][A-Za-z0-9-]{2,}\b/g)];
    for (const match of singleMatches) {
      const name = normalizeName(match[0]);
      if (stopwords.has(name) || titleNoiseWords.has(name)) {
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  for (const [name, count] of counts) {
    const words = name.split(' ');
    if (looksLikeTopicPhrase(name)) {
      continue;
    }
    if (words.length === 1 && !looksLikeStableSingleWord(name, count)) {
      continue;
    }
    const key = slugify(name);
    if (!candidates.has(key)) {
      candidates.set(key, {
        id: createId('ent'),
        slug: key,
        name,
        entityType: classifyEntity(name),
        aliases: [],
        sourceIds: [],
        confidence: 'medium'
      });
    }
  }

  return [...candidates.values()];
}
