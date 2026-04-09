import path from 'node:path';
import { readdir, unlink } from 'node:fs/promises';

import { createPaths, pageDirectoryName } from '../config.js';
import { exists, readGovernanceConfigDiagnostics } from '../fs.js';
import { exportPage } from '../export/export-page.js';
import { rebuildIndex } from '../export/rebuild-index.js';
import { rebuildLog } from '../export/rebuild-log.js';
import { rebuildOverview } from '../export/rebuild-overview.js';
import { requiredMongoCollections, requiredMongoIndexChecks } from '../db/mongo.js';
import { createFileRepositories } from '../db/repositories.js';

async function listActualWikiFiles(rootDir) {
  const paths = createPaths(rootDir);
  const directories = [
    paths.wikiOverview,
    paths.wikiSources,
    paths.wikiEntities,
    paths.wikiConcepts,
    paths.wikiTopics,
    paths.wikiComparisons,
    paths.wikiTimelines,
    paths.wikiQueries
  ];

  const filePaths = [];
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        filePaths.push(path.join(directory, entry.name));
      }
    }
  }
  return filePaths;
}

async function inspectGovernanceTargets(rootDir) {
  const governanceState = await readGovernanceConfigDiagnostics(rootDir);
  const governance = governanceState.config;
  const documentTargets = [
    ['Standards document', governance.documents.standards],
    ['Agent rules document', governance.documents.agentRules],
    ['README document', governance.documents.readme]
  ];
  const directoryTargets = [
    ['Proposal specs dir', governance.paths.proposalSpecsDir],
    ['Implementation plans dir', governance.paths.implementationPlansDir]
  ];

  const documents = await Promise.all(documentTargets.map(async ([label, relativePath]) => ({
    label,
    relativePath,
    exists: await exists(path.join(rootDir, relativePath)),
    defaulted: governanceState.issues.includes(`documents.${label === 'Standards document' ? 'standards' : label === 'Agent rules document' ? 'agentRules' : 'readme'}`)
  })));
  const directories = await Promise.all(directoryTargets.map(async ([label, relativePath]) => ({
    label,
    relativePath,
    exists: await exists(path.join(rootDir, relativePath)),
    defaulted: governanceState.issues.includes(`paths.${label === 'Proposal specs dir' ? 'proposalSpecsDir' : 'implementationPlansDir'}`)
  })));
  const missingTargetCount = [...documents, ...directories].filter((target) => !target.exists).length;
  const issueCount = missingTargetCount + governanceState.issues.length;

  return {
    governance,
    parseStatus: governanceState.parseStatus,
    configIssues: governanceState.issues,
    documents,
    directories,
    issueCount
  };
}

function expectedWikiFiles(rootDir, pages) {
  return pages.map((page) => path.join(rootDir, 'wiki', pageDirectoryName(page.type), `${page.slug}.md`));
}

export async function inspectExportConsistency(rootDir, repos) {
  const pages = await repos.pages.all();
  const expected = expectedWikiFiles(rootDir, pages);
  const actual = await listActualWikiFiles(rootDir);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingExports: expected.filter((filePath) => !actualSet.has(filePath)),
    extraExports: actual.filter((filePath) => !expectedSet.has(filePath))
  };
}

export async function inspectMongoHealth(repos) {
  if (repos.kind !== 'mongo' || !repos.diagnostics) {
    return null;
  }

  const collections = await repos.diagnostics.listCollections();
  const indexesByCollection = await repos.diagnostics.listIndexes();
  const collectionNames = new Set(collections.map((collection) => collection.name));
  const missingCollections = requiredMongoCollections.filter((name) => !collectionNames.has(name));
  const missingIndexes = [];

  for (const [collectionName, checks] of Object.entries(requiredMongoIndexChecks)) {
    const indexes = indexesByCollection[collectionName] ?? [];
    for (const check of checks) {
      if (!indexes.some((index) => check(index))) {
        missingIndexes.push(collectionName);
        break;
      }
    }
  }

  return {
    collectionCount: collections.length,
    missingCollections,
    missingIndexes
  };
}

const storageComparisonConfig = [
  {
    name: 'sources',
    displayName: 'sources',
    keyOf: (record) => record.slug,
    labelOf: (record) => record.slug,
    mismatchChecks: [
      { label: 'Source local path mismatches', differs: (left, right) => left.localPath !== right.localPath },
      { label: 'Source checksum mismatches', differs: (left, right) => left.checksum !== right.checksum },
      { label: 'Title mismatches', differs: (left, right) => left.title !== right.title }
    ]
  },
  {
    name: 'pages',
    displayName: 'pages',
    keyOf: (record) => `${record.type}:${record.slug}`,
    labelOf: (record) => record.slug,
    mismatchChecks: [
      { label: 'Title mismatches', differs: (left, right) => left.title !== right.title }
    ]
  },
  {
    name: 'entities',
    displayName: 'entities',
    keyOf: (record) => record.slug,
    labelOf: (record) => record.slug,
    mismatchChecks: [
      { label: 'Entity name mismatches', differs: (left, right) => left.name !== right.name }
    ]
  }
];

export async function inspectStorageConsistency(rootDir, repos) {
  if (repos.kind !== 'mongo') {
    return null;
  }

  const fileRepos = await createFileRepositories(rootDir);
  try {
    const collections = [];
    const mismatchGroups = new Map();

    for (const config of storageComparisonConfig) {
      const fileRecords = await fileRepos[config.name].all();
      const mongoRecords = await repos[config.name].all();
      const fileMap = new Map(fileRecords.map((record) => [config.keyOf(record), record]));
      const mongoMap = new Map(mongoRecords.map((record) => [config.keyOf(record), record]));
      const keys = new Set([...fileMap.keys(), ...mongoMap.keys()]);
      const fileOnly = [];
      const mongoOnly = [];

      for (const key of keys) {
        const fileRecord = fileMap.get(key);
        const mongoRecord = mongoMap.get(key);
        if (fileRecord && !mongoRecord) {
          fileOnly.push(config.labelOf(fileRecord));
          continue;
        }
        if (!fileRecord && mongoRecord) {
          mongoOnly.push(config.labelOf(mongoRecord));
          continue;
        }
        for (const check of config.mismatchChecks) {
          if (check.differs(fileRecord, mongoRecord)) {
            if (!mismatchGroups.has(check.label)) {
              mismatchGroups.set(check.label, []);
            }
            mismatchGroups.get(check.label).push(config.labelOf(mongoRecord));
          }
        }
      }

      collections.push({
        name: config.displayName,
        fileOnly,
        mongoOnly
      });
    }

    const mismatchSummary = Object.fromEntries(
      [...mismatchGroups.entries()].map(([label, values]) => [label, [...new Set(values)]])
    );
    const hasDrift = collections.some((entry) => entry.fileOnly.length > 0 || entry.mongoOnly.length > 0)
      || Object.values(mismatchSummary).some((values) => values.length > 0);

    return {
      hasDrift,
      collections,
      mismatchSummary
    };
  } finally {
    await fileRepos.close();
  }
}

export async function repairRepositoryArtifacts(rootDir, repos, { prune = false } = {}) {
  await rebuildOverview(rootDir, repos);
  const pages = await repos.pages.all();
  for (const page of pages) {
    await exportPage(rootDir, page);
  }
  const indexResult = await rebuildIndex(rootDir, pages);
  const logResult = await rebuildLog(rootDir, await repos.auditLog.all());
  let consistency = await inspectExportConsistency(rootDir, repos);
  const prunedFiles = [];

  if (prune) {
    for (const filePath of consistency.extraExports) {
      await unlink(filePath);
      prunedFiles.push(filePath);
    }
    consistency = await inspectExportConsistency(rootDir, repos);
  }

  return {
    exportedPages: pages.length,
    indexPath: indexResult.filePath,
    logPath: logResult.filePath,
    consistency,
    prunedFiles
  };
}

export async function buildDoctorReport(rootDir, repos, { storage, compareStorage = false }) {
  const paths = createPaths(rootDir);
  const governanceHealth = await inspectGovernanceTargets(rootDir);
  const consistency = await inspectExportConsistency(rootDir, repos);
  const governanceStatusLine = governanceHealth.parseStatus === 'invalid_json'
    ? 'Governance config: invalid json, using defaults'
    : governanceHealth.configIssues.length > 0
      ? 'Governance config: schema issues detected, defaulting invalid fields'
      : 'Governance config: ok';
  const renderTargetStatus = (target) => {
    const state = target.exists ? 'ok' : 'missing';
    return `${target.label}: ${target.relativePath} (${target.defaulted ? `${state}, defaulted` : state})`;
  };
  const lines = [
    `Repository root: ${rootDir}`,
    `Storage mode: ${storage}`,
    `Index: ${paths.metaIndex}`,
    `Log: ${paths.metaLog}`,
    governanceStatusLine,
    ...(governanceHealth.configIssues.length > 0 ? [`Governance config issues: ${governanceHealth.configIssues.join(', ')}`] : []),
    `Governance issues: ${governanceHealth.issueCount}`,
    ...governanceHealth.documents.map(renderTargetStatus),
    ...governanceHealth.directories.map(renderTargetStatus),
    `Missing wiki exports: ${consistency.missingExports.length}`,
    `Extra wiki exports: ${consistency.extraExports.length}`,
    `Index file exists: ${await exists(paths.metaIndex) ? 'yes' : 'no'}`,
    `Log file exists: ${await exists(paths.metaLog) ? 'yes' : 'no'}`
  ];
  if (consistency.missingExports.length > 0) {
    lines.push(`Missing export files: ${consistency.missingExports.map((filePath) => path.basename(filePath)).join(', ')}`);
  }
  if (consistency.extraExports.length > 0) {
    lines.push(`Extra export files: ${consistency.extraExports.map((filePath) => path.basename(filePath)).join(', ')}`);
  }

  const mongoHealth = await inspectMongoHealth(repos);
  if (mongoHealth) {
    lines.push(`Mongo collections checked: ${mongoHealth.collectionCount}`);
    lines.push(`Mongo indexes: ${mongoHealth.missingIndexes.length === 0 ? 'ok' : `missing in ${mongoHealth.missingIndexes.join(', ')}`}`);
    if (mongoHealth.missingCollections.length > 0) {
      lines.push(`Missing collections: ${mongoHealth.missingCollections.join(', ')}`);
    }
  }

  const storageConsistency = compareStorage ? await inspectStorageConsistency(rootDir, repos) : null;
  if (storageConsistency) {
    lines.push(`Storage consistency: ${storageConsistency.hasDrift ? 'drift detected' : 'ok'}`);
    for (const collection of storageConsistency.collections) {
      if (collection.fileOnly.length > 0) {
        lines.push(`File-only ${collection.name}: ${collection.fileOnly.join(', ')}`);
      }
      if (collection.mongoOnly.length > 0) {
        lines.push(`Mongo-only ${collection.name}: ${collection.mongoOnly.join(', ')}`);
      }
    }
    for (const [label, values] of Object.entries(storageConsistency.mismatchSummary)) {
      if (values.length > 0) {
        lines.push(`${label}: ${values.join(', ')}`);
      }
    }
  }

  return {
    lines,
    governanceHealth,
    consistency,
    mongoHealth,
    storageConsistency
  };
}
