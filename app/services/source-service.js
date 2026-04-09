import { createHash } from 'node:crypto';

import { createId, nowIso, slugify, today } from '../config.js';

export function checksumFor(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function mergeUnique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

function canonicalUrlFor(sourceLike) {
  return sourceLike?.metadata?.canonicalUrl ?? null;
}

function mergeChecksumHistory(existingMetadata, existingChecksum, nextChecksum) {
  return [...new Set([...(existingMetadata?.checksumHistory ?? []), existingChecksum, nextChecksum].filter(Boolean))];
}

export async function registerSource(repos, input) {
  const timestamp = nowIso();
  const rawText = input.rawText ?? '';
  const checksum = checksumFor(rawText);
  const metadata = normalizeMetadata(input.metadata);
  const inputCanonicalUrl = canonicalUrlFor({ metadata });
  const existingSources = await repos.sources.all();
  const duplicate = existingSources.find((source) =>
    (input.uri && source.uri && source.uri === input.uri) ||
    (inputCanonicalUrl && canonicalUrlFor(source) === inputCanonicalUrl) ||
    (rawText && source.checksum === checksum)
  );

  if (duplicate) {
    const contentChanged = Boolean(rawText && duplicate.rawText && duplicate.checksum && duplicate.checksum !== checksum);
    const checksumHistory = contentChanged
      ? mergeChecksumHistory(duplicate.metadata, duplicate.checksum, checksum)
      : (duplicate.metadata?.checksumHistory ?? undefined);
    const merged = {
      ...duplicate,
      uri: duplicate.uri ?? input.uri ?? null,
      localPath: duplicate.localPath ?? input.localPath ?? null,
      storedPath: duplicate.storedPath ?? input.storedPath ?? null,
      rawText: contentChanged ? rawText : (duplicate.rawText || rawText),
      checksum: contentChanged ? checksum : (duplicate.checksum ?? checksum),
      aliases: mergeUnique([...(duplicate.aliases ?? []), input.title !== duplicate.title ? input.title : null]),
      tags: mergeUnique([...(duplicate.tags ?? []), ...(input.tags ?? [input.sourceType])]),
      metadata: {
        ...(duplicate.metadata ?? {}),
        ...metadata,
        ...(contentChanged ? {
          contentDrift: true,
          contentVersionCount: checksumHistory.length,
          checksumHistory,
          lastDriftAt: timestamp,
          lastSeenUri: input.uri ?? duplicate.uri ?? null
        } : {})
      },
      updatedAt: timestamp
    };
    await repos.sources.upsert(merged);
    return merged;
  }

  const source = {
    id: input.id ?? createId('src'),
    title: input.title,
    slug: input.slug ?? slugify(input.title),
    sourceType: input.sourceType,
    uri: input.uri ?? null,
    localPath: input.localPath ?? null,
    storedPath: input.storedPath ?? null,
    rawText,
    checksum,
    aliases: [],
    tags: input.tags ?? [input.sourceType],
    metadata,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
    capturedAt: input.capturedAt ?? today(),
    status: 'active'
  };

  await repos.sources.upsert(source);
  return source;
}

export async function saveSourceChunks(repos, source, chunks) {
  const stored = chunks.map((chunk, index) => ({
    id: chunk.id,
    sourceId: source.id,
    ordinal: index,
    headingPath: chunk.headingPath,
    text: chunk.text,
    tokenCount: chunk.text.split(/\s+/).filter(Boolean).length
  }));
  const existing = await repos.sourceChunks.all();
  const retained = existing.filter((chunk) => chunk.sourceId !== source.id);
  await repos.sourceChunks.replaceAll([...retained, ...stored]);
  return stored;
}
