import { createId } from '../config.js';

function findEntityByFragment(fragment, entities) {
  const normalized = String(fragment).trim().toLowerCase();
  const matches = entities
    .filter((entity) => normalized.includes(entity.name.toLowerCase()))
    .sort((left, right) => right.name.length - left.name.length);
  return matches[0] ?? null;
}

function buildRelation(fromEntity, toEntity, relationType, sentence) {
  return {
    id: createId('rel'),
    fromType: 'entity',
    fromId: fromEntity.id,
    toType: 'entity',
    toId: toEntity.id,
    relationType,
    evidenceText: sentence.trim(),
    confidence: 'medium'
  };
}

export function extractRelations(text, entities) {
  const normalized = String(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\r/g, '');
  const sentences = normalized
    .split(/(?:\n{1,}|(?<=[.!?])\s+)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const relations = [];
  const patterns = [
    { relationType: 'leads', regex: /^(.+?)\s+leads\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'works_at', regex: /^(.+?)\s+works at\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'works_at', regex: /^(.+?)\s+works for\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'built_by', regex: /^(.+?)\s+(?:is|was)\s+built by\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'built_by', regex: /^(.+?)\s+built\s+(.+?)(?:[.!?]|$)/i, flip: true },
    { relationType: 'created_by', regex: /^(.+?)\s+(?:is|was)\s+created by\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'created_by', regex: /^(.+?)\s+created\s+(.+?)(?:[.!?]|$)/i, flip: true },
    { relationType: 'part_of', regex: /^(.+?)\s+is part of\s+(.+?)(?:[.!?]|$)/i },
    { relationType: 'part_of', regex: /^(.+?)\s+belongs to\s+(.+?)(?:[.!?]|$)/i }
  ];

  for (const sentence of sentences) {
    for (const pattern of patterns) {
      const match = sentence.match(pattern.regex);
      if (!match) {
        continue;
      }

      let fromEntity = findEntityByFragment(match[1], entities);
      let toEntity = findEntityByFragment(match[2], entities);
      if (pattern.flip) {
        [fromEntity, toEntity] = [toEntity, fromEntity];
      }
      if (!fromEntity || !toEntity || fromEntity.id === toEntity.id) {
        continue;
      }

      const duplicate = relations.some((relation) =>
        relation.fromId === fromEntity.id &&
        relation.toId === toEntity.id &&
        relation.relationType === pattern.relationType
      );

      if (!duplicate) {
        relations.push(buildRelation(fromEntity, toEntity, pattern.relationType, sentence));
      }
    }
  }

  return relations;
}
