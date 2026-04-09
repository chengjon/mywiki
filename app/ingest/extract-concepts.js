import { createId, slugify } from '../config.js';

const conceptSuffixes = [
  'learning',
  'augmentation',
  'memory',
  'reasoning',
  'alignment',
  'prompting',
  'retrieval',
  'planning',
  'grounding',
  'systems'
];

const blockerWords = new Set([
  'improves',
  'helps',
  'supports',
  'enables',
  'uses',
  'builds',
  'leads',
  'creates',
  'shows',
  'makes',
  'keeps',
  'tracks',
  'drives'
]);

function titleCaseWord(word) {
  return word
    .split('-')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join('-');
}

function titleCasePhrase(phrase) {
  return phrase
    .split(/\s+/)
    .map(titleCaseWord)
    .join(' ');
}

export function extractConcepts(text) {
  const seen = new Map();
  const bodyText = String(text)
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .toLowerCase();
  const segments = bodyText
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const tokens = segment.match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!conceptSuffixes.includes(token)) {
        continue;
      }
      const previous = tokens[index - 1];
      const previousTwo = tokens[index - 2];
      if (!previous || blockerWords.has(previous)) {
        continue;
      }

      let phraseTokens = [previous, token];
      if (token === 'systems' && previousTwo && !blockerWords.has(previousTwo)) {
        phraseTokens = [previousTwo, previous, token];
      }

      const phrase = phraseTokens.join(' ');
      const slug = slugify(phrase);
      if (!seen.has(slug)) {
        seen.set(slug, {
          id: createId('cpt'),
          slug,
          title: titleCasePhrase(phrase)
        });
      }
    }
  }

  return [...seen.values()];
}
