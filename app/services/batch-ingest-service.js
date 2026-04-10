import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

import { createPaths } from '../config.js';
import { finalizeRepositoryArtifacts, ingestSource } from './ingest-service.js';
import { appendAuditEvent } from './audit-service.js';
import { writeIfChanged } from '../fs.js';
import { checksumFor } from './source-service.js';

const supportedExtensions = new Set(['.md', '.markdown', '.txt']);
const supportedSourceTypes = new Set(['file', 'note']);
const supportedModes = new Set(['incremental', 'all']);

function titleFromFileName(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function normalizePath(value) {
  return path.resolve(String(value ?? ''));
}

function findImportedSourceByLocalPath(sources, filePath) {
  const normalizedFilePath = normalizePath(filePath);
  return sources.find((source) => [
    source.localPath,
    ...(source.metadata?.localPathHistory ?? [])
  ]
    .filter(Boolean)
    .some((value) => normalizePath(value) === normalizedFilePath)) ?? null;
}

function findImportedSourceByChecksum(sources, checksum) {
  return sources.find((source) => source.checksum && source.checksum === checksum) ?? null;
}

function formatReportPath(rootDir, filePath, fileName) {
  if (!filePath) {
    return fileName;
  }

  const relativePath = path.relative(rootDir, filePath);
  return (relativePath || fileName)
    .split(path.sep)
    .join('/');
}

function sortReportItems(rootDir, items) {
  return [...items].sort((left, right) => (
    formatReportPath(rootDir, left.filePath, left.fileName)
      .localeCompare(formatReportPath(rootDir, right.filePath, right.fileName))
  ));
}

function renderBatchIngestReport({ rootDir, directory, mode, processed, skipped, failed }) {
  const sortedProcessed = sortReportItems(rootDir, processed);
  const sortedSkipped = sortReportItems(rootDir, skipped);
  const sortedFailed = sortReportItems(rootDir, failed);
  const renderLines = (items, formatter, empty) => (
    items.length > 0
      ? items.map((item) => `- ${formatter(item)}`).join('\n')
      : `- ${empty}`
  );

  return [
    '# Batch Ingest Report',
    '',
    `Directory: ${formatReportPath(rootDir, directory, path.basename(directory))}`,
    `Mode: ${mode}`,
    `Processed: ${processed.length}`,
    `Skipped: ${skipped.length}`,
    `Failed: ${failed.length}`,
    '',
    '## Processed',
    '',
    renderLines(sortedProcessed, (item) => `${formatReportPath(rootDir, item.filePath, item.fileName)} -> [[${item.page.slug}]]`, 'None'),
    '',
    '## Skipped',
    '',
    renderLines(sortedSkipped, (item) => `${formatReportPath(rootDir, item.filePath, item.fileName)} | ${item.reason}`, 'None'),
    '',
    '## Failed',
    '',
    renderLines(sortedFailed, (item) => `${formatReportPath(rootDir, item.filePath, item.fileName)} | ${item.error}`, 'None'),
    ''
  ].join('\n');
}

export async function batchIngestSources(repos, rootDir, { dir, sourceType = 'file', mode = 'incremental' } = {}) {
  if (!supportedSourceTypes.has(sourceType)) {
    throw new Error(`Unsupported batch-ingest source type: ${sourceType}`);
  }
  if (!supportedModes.has(mode)) {
    throw new Error(`Unsupported batch-ingest mode: ${mode}`);
  }

  const paths = createPaths(rootDir);
  const targetDir = path.resolve(dir ?? paths.rawInbox);
  const directoryEntries = await readdir(targetDir, { withFileTypes: true });
  const fileEntries = directoryEntries
    .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name));

  const processed = [];
  const skipped = [];
  const failed = [];
  const entries = [];

  for (const entry of fileEntries) {
    const filePath = path.join(targetDir, entry.name);
    const title = titleFromFileName(entry.name);
    if (mode === 'incremental') {
      const existingSources = await repos.sources.all();
      const importedSource = findImportedSourceByLocalPath(existingSources, filePath);
      if (importedSource) {
        const currentChecksum = checksumFor(await readFile(filePath, 'utf8'));
        if (importedSource.checksum !== currentChecksum) {
          // Re-run ingest so changed local files update the existing source instead of being skipped forever.
        } else {
          const skippedEntry = {
            fileName: entry.name,
            filePath,
            sourceId: importedSource.id,
            reason: 'already imported from local path'
          };
          skipped.push(skippedEntry);
          entries.push({ status: 'skipped', ...skippedEntry });
          continue;
        }
      }

      const fileText = await readFile(filePath, 'utf8');
      const duplicateSource = findImportedSourceByChecksum(existingSources, checksumFor(fileText));
      if (duplicateSource) {
        await repos.sources.upsert({
          ...duplicateSource,
          localPath: filePath,
          aliases: [...new Set([...(duplicateSource.aliases ?? []), title !== duplicateSource.title ? title : null].filter(Boolean))],
          metadata: {
            ...(duplicateSource.metadata ?? {}),
            localPathHistory: [...new Set([...(duplicateSource.metadata?.localPathHistory ?? []), duplicateSource.localPath, filePath].filter(Boolean))],
            lastSeenLocalPath: filePath
          }
        });
        const skippedEntry = {
          fileName: entry.name,
          filePath,
          sourceId: duplicateSource.id,
          reason: 'duplicate content already imported'
        };
        skipped.push(skippedEntry);
        entries.push({ status: 'skipped', ...skippedEntry });
        continue;
      }
    }

    try {
      const result = sourceType === 'note'
        ? await ingestSource(
          repos,
          rootDir,
          {
            sourceType: 'note',
            title,
            localPath: filePath,
            rawText: await readFile(filePath, 'utf8')
          },
          { rebuildArtifacts: false }
        )
        : await ingestSource(
          repos,
          rootDir,
          {
            sourceType: 'file',
            title,
            localPath: filePath
          },
          { rebuildArtifacts: false }
        );

      const processedEntry = {
        fileName: entry.name,
        filePath,
        source: result.source,
        page: result.page
      };
      processed.push(processedEntry);
      entries.push({ status: 'processed', ...processedEntry });
    } catch (error) {
      const failedEntry = {
        fileName: entry.name,
        filePath,
        error: error instanceof Error ? error.message : String(error)
      };
      failed.push(failedEntry);
      entries.push({ status: 'failed', ...failedEntry });
    }
  }

  await appendAuditEvent(repos, {
    eventType: 'batch-ingest',
    title: `Batch ingest from ${path.basename(targetDir) || targetDir}`,
    details: `Processed ${processed.length}, skipped ${skipped.length}, failed ${failed.length} in ${mode} mode.`,
    relatedIds: processed.map((item) => item.page.id)
  });
  await finalizeRepositoryArtifacts(rootDir, repos);
  const reportPath = path.join(paths.metaReports, 'latest-batch-ingest.md');
  const reportContents = renderBatchIngestReport({ rootDir, directory: targetDir, mode, processed, skipped, failed });
  await writeIfChanged(reportPath, reportContents);

  return {
    directory: targetDir,
    mode,
    count: processed.length,
    processed,
    skipped,
    failed,
    entries,
    reportPath
  };
}
