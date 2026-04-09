import path from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { createPaths, defaultGovernanceConfig } from './config.js';

const defaultIndex = '# MyWiki Index\n\nThis file is rebuilt by `mywiki rebuild-index`.\n';
const defaultLog = '# MyWiki Log\n\nThis file is rebuilt by `mywiki rebuild-log`.\n';
const defaultPageSchema = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MyWiki Page",
  "type": "object",
  "required": ["page_id", "title", "slug", "type", "updated_at"],
  "properties": {
    "page_id": { "type": "string" },
    "title": { "type": "string" },
    "slug": { "type": "string" },
    "type": { "type": "string" },
    "status": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "source_ids": { "type": "array", "items": { "type": "string" } },
    "entity_ids": { "type": "array", "items": { "type": "string" } },
    "updated_at": { "type": "string" },
    "created_at": { "type": "string" }
  }
}
`;
const defaultPrompt = `# Ingest Prompt

Use this repository as an incremental wiki, not a one-off Q&A system.

When processing a source:
- summarize it
- update existing wiki pages before creating redundant ones
- add cross-links
- preserve uncertainty and conflicts
`;
const defaultPreferences = {
  conflictResolution: {
    order: ['publishedAt', 'metadataCompleteness', 'sourceTypeWeight'],
    sourceTypeWeights: {
      web: 30,
      file: 20,
      note: 10
    }
  }
};

function mergeGovernanceConfig(parsed = {}) {
  return {
    ...defaultGovernanceConfig,
    ...parsed,
    documents: {
      ...defaultGovernanceConfig.documents,
      ...(parsed.documents ?? {})
    },
    paths: {
      ...defaultGovernanceConfig.paths,
      ...(parsed.paths ?? {})
    }
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectUnknownKeys(section, allowedKeys, prefix) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return [];
  }

  return Object.keys(section)
    .filter((key) => !allowedKeys.includes(key))
    .map((key) => `${prefix}.${key}`);
}

function isRepositoryLocalPath(rootDir, candidate) {
  if (!isNonEmptyString(candidate) || !rootDir || path.isAbsolute(candidate)) {
    return false;
  }

  const resolved = path.resolve(rootDir, candidate);
  const relative = path.relative(rootDir, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeGovernanceField(parsedSection, defaultsSection, sectionName, options = {}) {
  const normalized = { ...defaultsSection };
  const issues = [];
  const { rootDir } = options;

  for (const [key, defaultValue] of Object.entries(defaultsSection)) {
    const candidate = parsedSection?.[key];
    if (candidate === undefined) {
      issues.push(`${sectionName}.${key}`);
      continue;
    }
    if (!isNonEmptyString(candidate)) {
      issues.push(`${sectionName}.${key}`);
      continue;
    }
    if (!isRepositoryLocalPath(rootDir, candidate)) {
      issues.push(`${sectionName}.${key}`);
      continue;
    }
    normalized[key] = candidate;
  }

  return { normalized, issues };
}

export async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readIfExists(filePath, fallback = null) {
  if (!(await exists(filePath))) {
    return fallback;
  }
  return readFile(filePath, 'utf8');
}

export async function writeIfChanged(filePath, contents) {
  const previous = await readIfExists(filePath, null);
  if (previous === contents) {
    return false;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
  return true;
}

export async function ensureRepositoryLayout(rootDir) {
  const paths = createPaths(rootDir);
  const governance = (await readGovernanceConfigDiagnostics(rootDir)).config;
  const governanceDirectories = [
    ...Object.values(governance.paths).map((relativePath) => path.join(rootDir, relativePath)),
    ...Object.values(governance.documents).map((relativePath) => path.dirname(path.join(rootDir, relativePath)))
  ];
  const directories = [
    paths.rawInbox,
    paths.rawWeb,
    paths.rawFiles,
    paths.rawNotes,
    paths.rawAssets,
    paths.wikiOverview,
    paths.wikiSources,
    paths.wikiEntities,
    paths.wikiConcepts,
    paths.wikiTopics,
    paths.wikiComparisons,
    paths.wikiTimelines,
    paths.wikiQueries,
    paths.metaDir,
    paths.metaReports,
    paths.metaManifests,
    paths.metaTemplates,
    paths.systemPrompts,
    paths.systemSchemas,
    paths.systemExports,
    ...governanceDirectories
  ];

  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  await writeIfChanged(paths.metaIndex, (await readIfExists(paths.metaIndex, defaultIndex)) ?? defaultIndex);
  await writeIfChanged(paths.metaLog, (await readIfExists(paths.metaLog, defaultLog)) ?? defaultLog);
  await writeIfChanged(path.join(paths.systemSchemas, 'page.schema.json'), (await readIfExists(path.join(paths.systemSchemas, 'page.schema.json'), defaultPageSchema)) ?? defaultPageSchema);
  await writeIfChanged(path.join(paths.systemPrompts, 'ingest.md'), (await readIfExists(path.join(paths.systemPrompts, 'ingest.md'), defaultPrompt)) ?? defaultPrompt);
  await writeIfChanged(paths.systemPreferences, (await readIfExists(paths.systemPreferences, JSON.stringify(defaultPreferences, null, 2))) ?? JSON.stringify(defaultPreferences, null, 2));
  await writeIfChanged(paths.systemGovernance, (await readIfExists(paths.systemGovernance, JSON.stringify(defaultGovernanceConfig, null, 2))) ?? JSON.stringify(defaultGovernanceConfig, null, 2));
}

export async function readWikiPreferences(rootDir) {
  const paths = createPaths(rootDir);
  const text = await readIfExists(paths.systemPreferences, JSON.stringify(defaultPreferences, null, 2));
  try {
    const parsed = JSON.parse(text);
    return {
      ...defaultPreferences,
      ...parsed,
      conflictResolution: {
        ...defaultPreferences.conflictResolution,
        ...(parsed.conflictResolution ?? {}),
        sourceTypeWeights: {
          ...(defaultPreferences.conflictResolution.sourceTypeWeights ?? {}),
          ...(parsed.conflictResolution?.sourceTypeWeights ?? {})
        }
      }
    };
  } catch {
    return defaultPreferences;
  }
}

export async function readGovernanceConfig(rootDir) {
  const paths = createPaths(rootDir);
  const text = await readIfExists(paths.systemGovernance, JSON.stringify(defaultGovernanceConfig, null, 2));
  try {
    return readGovernanceConfigDiagnosticsFromText(text, { rootDir }).config;
  } catch {
    return defaultGovernanceConfig;
  }
}

export function readGovernanceConfigDiagnosticsFromText(text, { rootDir } = {}) {
  try {
    const parsed = JSON.parse(text);
    const merged = mergeGovernanceConfig(parsed);
    const documents = normalizeGovernanceField(parsed.documents, defaultGovernanceConfig.documents, 'documents', { rootDir });
    const configPaths = normalizeGovernanceField(parsed.paths, defaultGovernanceConfig.paths, 'paths', { rootDir });
    const unknownIssues = [
      ...collectUnknownKeys(parsed, ['documents', 'paths'], 'root'),
      ...collectUnknownKeys(parsed.documents, Object.keys(defaultGovernanceConfig.documents), 'documents'),
      ...collectUnknownKeys(parsed.paths, Object.keys(defaultGovernanceConfig.paths), 'paths')
    ];
    return {
      config: {
        ...merged,
        documents: documents.normalized,
        paths: configPaths.normalized
      },
      parseStatus: 'ok',
      issues: [...documents.issues, ...configPaths.issues, ...unknownIssues]
    };
  } catch {
    return {
      config: defaultGovernanceConfig,
      parseStatus: 'invalid_json',
      issues: []
    };
  }
}

export async function readGovernanceConfigDiagnostics(rootDir) {
  const paths = createPaths(rootDir);
  const text = await readIfExists(paths.systemGovernance, JSON.stringify(defaultGovernanceConfig, null, 2));
  return readGovernanceConfigDiagnosticsFromText(text, { rootDir });
}
