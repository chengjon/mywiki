import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pageDirectoryMap = {
  overview: 'overview',
  source: 'sources',
  entity: 'entities',
  concept: 'concepts',
  topic: 'topics',
  comparison: 'comparisons',
  timeline: 'timelines',
  query: 'queries'
};

export const defaultGovernanceConfig = {
  documents: {
    standards: 'STANDARDS.md',
    agentRules: 'AGENTS.md',
    readme: 'README.md'
  },
  paths: {
    proposalSpecsDir: 'docs/superpowers/specs',
    implementationPlansDir: 'docs/superpowers/plans'
  }
};

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizePageType(type) {
  const value = String(type ?? '').toLowerCase();
  if (value.endsWith('s')) {
    return Object.keys(pageDirectoryMap).find((key) => `${key}s` === value) ?? value.slice(0, -1);
  }
  return value;
}

export function pageDirectoryName(type) {
  return pageDirectoryMap[normalizePageType(type)] ?? 'topics';
}

export function createPaths(rootDir) {
  return {
    rootDir,
    rawInbox: path.join(rootDir, 'raw', 'inbox'),
    rawWeb: path.join(rootDir, 'raw', 'web'),
    rawFiles: path.join(rootDir, 'raw', 'files'),
    rawNotes: path.join(rootDir, 'raw', 'notes'),
    rawAssets: path.join(rootDir, 'raw', 'assets'),
    wikiOverview: path.join(rootDir, 'wiki', 'overview'),
    wikiSources: path.join(rootDir, 'wiki', 'sources'),
    wikiEntities: path.join(rootDir, 'wiki', 'entities'),
    wikiConcepts: path.join(rootDir, 'wiki', 'concepts'),
    wikiTopics: path.join(rootDir, 'wiki', 'topics'),
    wikiComparisons: path.join(rootDir, 'wiki', 'comparisons'),
    wikiTimelines: path.join(rootDir, 'wiki', 'timelines'),
    wikiQueries: path.join(rootDir, 'wiki', 'queries'),
    metaDir: path.join(rootDir, 'meta'),
    metaReports: path.join(rootDir, 'meta', 'reports'),
    metaManifests: path.join(rootDir, 'meta', 'manifests'),
    metaTemplates: path.join(rootDir, 'meta', 'templates'),
    metaIndex: path.join(rootDir, 'meta', 'index.md'),
    metaLog: path.join(rootDir, 'meta', 'log.md'),
    systemPrompts: path.join(rootDir, 'system', 'prompts'),
    systemSchemas: path.join(rootDir, 'system', 'schemas'),
    systemExports: path.join(rootDir, 'system', 'exports'),
    systemPreferences: path.join(rootDir, 'system', 'preferences.json'),
    systemGovernance: path.join(rootDir, 'system', 'governance.json'),
    appCli: path.join(rootDir, 'app', 'cli')
  };
}
