import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { ensureRepositoryLayout, readWikiPreferences, writeIfChanged } from '../fs.js';
import { createRepositories } from '../db/repositories.js';
import { ingestSource } from '../services/ingest-service.js';
import { rebuildIndex } from '../export/rebuild-index.js';
import { rebuildLog } from '../export/rebuild-log.js';
import { rebuildOverview } from '../export/rebuild-overview.js';
import { answerQuestion } from '../query/ask.js';
import { lintWiki } from '../lint/lint-wiki.js';
import { appendAuditEvent } from '../services/audit-service.js';
import { upsertPage } from '../services/page-service.js';
import { createComparisonPage } from '../services/comparison-service.js';
import { createTimelinePage } from '../services/timeline-service.js';
import { resolveArtifactRoute } from '../services/artifact-router.js';
import { exportPage } from '../export/export-page.js';
import { createPaths, normalizePageType, slugify } from '../config.js';
import { batchIngestSources } from '../services/batch-ingest-service.js';
import { findMergeableQueryPage, findSimilarQueryPages } from '../services/query-page-service.js';
import { buildDoctorReport, formatMongoIndexStatus, inspectMongoHealth, repairRepositoryArtifacts } from '../services/repository-health-service.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { command, flags };
}

async function withRepositories(rootDir, flags, env, callback, options = {}) {
  const storage = flags.storage ?? env.MYWIKI_STORAGE ?? 'file';
  const mongoUri = flags['mongo-uri'] ?? env.MONGODB_URI;
  const dbName = flags['db-name'] ?? env.MONGODB_DB ?? 'mywiki';
  const repos = await createRepositories({ rootDir, storage, mongoUri, dbName, ...options });
  try {
    return await callback(repos);
  } finally {
    await repos.close();
  }
}

function formatFindings(findings) {
  if (findings.length === 0) {
    return 'No lint findings.\n';
  }
  return `${findings.map((finding) => `- [${finding.severity}] ${finding.code}: ${finding.message}`).join('\n')}\n`;
}

function parseStructuredAnswer(answerText) {
  const sections = new Map();
  const matches = [...String(answerText).matchAll(/^##\s+(.+)\n\n([\s\S]*?)(?=^##\s+.+\n\n|\s*$)/gm)];

  for (const match of matches) {
    sections.set(match[1].trim(), match[2].trim());
  }

  const summary = sections.get('Answer') ?? answerText.trim();
  const keyPoints = [
    ...(sections.get('Relations')?.split('\n').map((line) => line.replace(/^-+\s*/, '').trim()).filter(Boolean) ?? []),
    ...(sections.get('Sources')?.split('\n').map((line) => line.replace(/^-+\s*/, '').trim()).filter(Boolean) ?? [])
  ];
  const detailSections = [];
  if (sections.get('Evidence')) {
    detailSections.push(`Evidence:\n${sections.get('Evidence')}`);
  }
  if (sections.get('Sources')) {
    detailSections.push(`Sources:\n${sections.get('Sources')}`);
  }

  return {
    summary,
    keyPoints,
    details: detailSections.join('\n\n'),
    openQuestions: sections.get('Open Questions')?.split('\n').map((line) => line.replace(/^-+\s*/, '').trim()).filter(Boolean) ?? []
  };
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const allowedArtifactTypes = new Set(['comparison', 'timeline', 'query']);
const artifactOverrideFlags = ['left', 'right', 'left-type', 'right-type', 'slug'];

function hasFlag(flags, key) {
  return flags[key] !== undefined;
}

function rejectArtifactFlags(flags, type, keys) {
  for (const key of keys) {
    if (hasFlag(flags, key)) {
      throw new Error(`file-artifact ${type} override does not accept --${key}`);
    }
  }
}

function validateArtifactFlags(flags) {
  const explicitType = flags['artifact-type'];
  const hasOverrideFlags = artifactOverrideFlags.some((key) => hasFlag(flags, key));

  if (!explicitType) {
    if (hasOverrideFlags) {
      throw new Error('file-artifact override flags require --artifact-type');
    }
    return;
  }

  const type = normalizePageType(explicitType);
  if (!allowedArtifactTypes.has(type)) {
    throw new Error(`Unsupported file-artifact --artifact-type: ${explicitType}`);
  }

  if (hasFlag(flags, 'left-type') && !hasFlag(flags, 'left')) {
    throw new Error('file-artifact comparison override requires --left when --left-type is set');
  }
  if (hasFlag(flags, 'right-type') && !hasFlag(flags, 'right')) {
    throw new Error('file-artifact comparison override requires --right when --right-type is set');
  }

  if (type === 'comparison') {
    if (!hasFlag(flags, 'left') || !hasFlag(flags, 'right')) {
      throw new Error('file-artifact comparison override requires --left and --right');
    }
    rejectArtifactFlags(flags, type, ['slug']);
    return;
  }

  if (type === 'timeline') {
    if (!hasFlag(flags, 'slug')) {
      throw new Error('file-artifact timeline override requires --slug');
    }
    rejectArtifactFlags(flags, type, ['left', 'right', 'left-type', 'right-type']);
    return;
  }

  rejectArtifactFlags(flags, type, ['left', 'right', 'left-type', 'right-type']);
}

function resolveArtifactOverride(flags) {
  const explicitType = flags['artifact-type'];
  if (!explicitType) {
    return null;
  }

  const type = normalizePageType(explicitType);
  if (!allowedArtifactTypes.has(type)) {
    throw new Error(`Unsupported file-artifact --artifact-type: ${explicitType}`);
  }

  if (type === 'comparison') {
    const leftSlug = flags.left;
    const rightSlug = flags.right;
    if (!leftSlug || !rightSlug) {
      throw new Error('file-artifact comparison override requires --left and --right');
    }
    return {
      type,
      left: {
        slug: leftSlug,
        type: flags['left-type']
      },
      right: {
        slug: rightSlug,
        type: flags['right-type']
      }
    };
  }

  if (type === 'timeline') {
    const targetSlug = flags.slug;
    if (!targetSlug) {
      throw new Error('file-artifact timeline override requires --slug');
    }
    return {
      type,
      target: {
        slug: targetSlug
      }
    };
  }

  return {
    type,
    slug: flags.slug
  };
}

async function buildAnswerContext(repos, rootDir, question) {
  return answerQuestion({
    question,
    preferences: await readWikiPreferences(rootDir),
    pages: await repos.pages.all(),
    sources: await repos.sources.all(),
    chunks: await repos.sourceChunks.all(),
    entities: await repos.entities.all(),
    relations: await repos.relations.all()
  });
}

async function fileAnswerPage({ repos, rootDir, question, title, slug }) {
  const answer = await buildAnswerContext(repos, rootDir, question);
  const parsed = parseStructuredAnswer(answer.answer);
  const pageTitle = title ?? question;
  const requestedSlug = slug ?? slugify(pageTitle);
  const explicitSlug = Boolean(slug);
  const mergeTarget = await findMergeableQueryPage(repos, {
    slug: requestedSlug,
    title: pageTitle,
    question
  });
  if (!mergeTarget && !explicitSlug) {
    const similarCandidates = await findSimilarQueryPages(repos, {
      title: pageTitle,
      question
    });
    if (similarCandidates.length > 0) {
      const candidateList = similarCandidates
        .map((candidate) => `[[${candidate.page.slug}]] (${candidate.reasons.join('; ')})`)
        .join(', ');
      throw new Error(`Similar durable query pages exist: ${candidateList}. Re-run with --slug to update one explicitly or choose a new slug to keep a separate page.`);
    }
  }
  const relatedCitations = uniqueBy(
    answer.citations.filter((citation) => citation.type === 'page' && citation.slug),
    (citation) => citation.slug
  );
  const sourceCitations = uniqueBy(
    answer.citations.filter((citation) => citation.type === 'source' && citation.sourceId),
    (citation) => citation.sourceId
  );
  const existingPage = mergeTarget?.page ?? null;
  const relatedPages = uniqueBy(
    [
      ...(existingPage?.relatedPages ?? []),
      ...relatedCitations.map((citation) => ({
        slug: citation.slug,
        summary: citation.title ?? citation.slug
      }))
    ],
    (entry) => entry.slug
  );
  const sources = uniqueBy(
    [
      ...(existingPage?.sources ?? []),
      ...(sourceCitations.length > 0 ? sourceCitations : relatedCitations).map((citation) => ({
        id: citation.sourceId ?? citation.slug ?? 'derived',
        title: citation.title ?? citation.slug ?? citation.chunkId ?? 'Derived citation'
      }))
    ],
    (entry) => entry.id
  );
  const sourceIds = [...new Set([
    ...(existingPage?.sourceIds ?? []),
    ...answer.citations.map((citation) => citation.sourceId).filter(Boolean)
  ])];
  const keyPoints = [...new Set([...(existingPage?.keyPoints ?? []), ...parsed.keyPoints])];
  const openQuestions = [...new Set([...(existingPage?.openQuestions ?? []), ...parsed.openQuestions])];
  const changeNotes = mergeTarget
    ? [...(existingPage?.changeNotes ?? []), `Merged durable query update from CLI answer using ${mergeTarget.reason} match`]
    : ['Filed from CLI answer'];
  const page = await upsertPage(repos, {
    title: existingPage?.title ?? pageTitle,
    slug: existingPage?.slug ?? requestedSlug,
    type: 'query',
    tags: ['query'],
    sourceIds,
    summary: parsed.summary,
    keyPoints,
    details: `Question: ${question}\n\n${parsed.details}`.trim(),
    openQuestions,
    relatedPages,
    sources,
    changeNotes
  });
  await appendAuditEvent(repos, {
    eventType: 'query',
    title: page.title,
    details: mergeTarget
      ? `Updated existing durable query page [[${page.slug}]] for question: ${question}`
      : `Filed answer for question: ${question}`,
    relatedIds: [page.id]
  });
  await exportPage(rootDir, page);
  await rebuildOverview(rootDir, repos);
  await rebuildIndex(rootDir, await repos.pages.all());
  await rebuildLog(rootDir, await repos.auditLog.all());
  return { page, answer };
}

async function fileComparisonPage({ repos, rootDir, leftSlug, leftType, rightSlug, rightType, title }) {
  const page = await createComparisonPage(repos, {
    leftSlug,
    leftType,
    rightSlug,
    rightType,
    title
  });
  await appendAuditEvent(repos, {
    eventType: 'comparison',
    title: page.title,
    details: `Compared [[${leftSlug}]] with [[${rightSlug}]] into [[${page.slug}]].`,
    relatedIds: [page.id]
  });
  await exportPage(rootDir, page);
  await rebuildOverview(rootDir, repos);
  await rebuildIndex(rootDir, await repos.pages.all());
  await rebuildLog(rootDir, await repos.auditLog.all());
  return { page };
}

async function fileTimelinePage({ repos, rootDir, slug, title }) {
  const page = await createTimelinePage(repos, {
    slug,
    title
  });
  await appendAuditEvent(repos, {
    eventType: 'timeline',
    title: page.title,
    details: `Built timeline for [[${slug}]] into [[${page.slug}]].`,
    relatedIds: [page.id]
  });
  await exportPage(rootDir, page);
  await rebuildOverview(rootDir, repos);
  await rebuildIndex(rootDir, await repos.pages.all());
  await rebuildLog(rootDir, await repos.auditLog.all());
  return { page };
}

export async function runCli(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const { command, flags } = parseArgs(argv);
  const rootDir = path.resolve(flags.root ?? process.cwd());
  await ensureRepositoryLayout(rootDir);

  if (!command) {
    const paths = createPaths(rootDir);
    const lines = [
      `Repository root: ${rootDir}`,
      `Storage mode: ${flags.storage ?? env.MYWIKI_STORAGE ?? 'file'}`,
      `Index: ${paths.metaIndex}`,
      `Log: ${paths.metaLog}`
    ];
    if ((flags.storage ?? env.MYWIKI_STORAGE) === 'mongo' && !env.MONGODB_URI && !flags['mongo-uri']) {
      lines.push('Warning: storage is mongo but MONGODB_URI is not set.');
    }
    stdout.write(`${lines.join('\n')}\n`);
    return { ok: true, rootDir };
  }

  const repoOptions = command === 'doctor' ? { ensureIndexes: false } : {};

  return withRepositories(rootDir, flags, env, async (repos) => {
    switch (command) {
      case 'ingest-source': {
        const result = await ingestSource(repos, rootDir, {
          sourceType: flags.type ?? 'note',
          localPath: flags.path,
          rawText: flags.text,
          uri: flags.url,
          title: flags.title ?? flags.url ?? flags.path ?? 'Untitled Source'
        });
        stdout.write(`Ingested ${result.source.id} -> [[${result.page.slug}]]\n`);
        return result;
      }
      case 'batch-ingest': {
        const result = await batchIngestSources(repos, rootDir, {
          dir: flags.dir,
          sourceType: flags.type ?? 'file',
          mode: flags.mode ?? 'incremental'
        });
        stdout.write(`Processed ${result.processed.length} source files from ${result.directory}\n`);
        stdout.write(`Skipped ${result.skipped.length} source files\n`);
        stdout.write(`Failed ${result.failed.length} source files\n`);
        for (const entry of result.entries) {
          if (entry.status === 'processed') {
            stdout.write(`OK ${entry.fileName} -> [[${entry.page.slug}]]\n`);
            continue;
          }
          if (entry.status === 'skipped') {
            stdout.write(`SKIP ${entry.fileName} | ${entry.reason}\n`);
            continue;
          }
          stdout.write(`FAIL ${entry.fileName} | ${entry.error}\n`);
        }
        return result;
      }
      case 'rebuild-index': {
        const result = await rebuildIndex(rootDir, await repos.pages.all());
        stdout.write(`Rebuilt index at ${result.filePath}\n`);
        return result;
      }
      case 'doctor': {
        const storage = flags.storage ?? env.MYWIKI_STORAGE ?? 'file';
        const result = await buildDoctorReport(rootDir, repos, {
          storage,
          compareStorage: Boolean(flags['compare-storage'])
        });
        stdout.write(`${result.lines.join('\n')}\n`);
        return result;
      }
      case 'rebuild-log': {
        const result = await rebuildLog(rootDir, await repos.auditLog.all());
        stdout.write(`Rebuilt log at ${result.filePath}\n`);
        return result;
      }
      case 'rebuild-overview': {
        const result = await rebuildOverview(rootDir, repos);
        await rebuildIndex(rootDir, await repos.pages.all());
        stdout.write(`Rebuilt overview at ${result.filePath}\n`);
        return result;
      }
      case 'ask': {
        const question = flags.question ?? flags.q;
        if (!question) {
          throw new Error('ask requires --question');
        }
        const result = await buildAnswerContext(repos, rootDir, question);
        stdout.write(`${result.answer}\n`);
        return result;
      }
      case 'file-answer': {
        const question = flags.question ?? flags.q;
        if (!question) {
          throw new Error('file-answer requires --question');
        }
        const result = await fileAnswerPage({
          repos,
          rootDir,
          question,
          title: flags.title ?? question,
          slug: flags.slug
        });
        stdout.write(`Filed [[${result.page.slug}]]\n`);
        return result;
      }
      case 'compare-pages': {
        const leftSlug = flags.left;
        const rightSlug = flags.right;
        if (!leftSlug || !rightSlug) {
          throw new Error('compare-pages requires --left and --right');
        }
        const result = await fileComparisonPage({
          repos,
          rootDir,
          leftSlug,
          leftType: flags['left-type'],
          rightSlug,
          rightType: flags['right-type'],
          title: flags.title
        });
        stdout.write(`Filed comparison [[${result.page.slug}]]\n`);
        return result;
      }
      case 'build-timeline': {
        const slug = flags.slug;
        if (!slug) {
          throw new Error('build-timeline requires --slug');
        }
        const result = await fileTimelinePage({
          repos,
          rootDir,
          slug,
          title: flags.title
        });
        stdout.write(`Filed timeline [[${result.page.slug}]]\n`);
        return result;
      }
      case 'file-artifact': {
        const question = flags.question ?? flags.q;
        if (!question) {
          throw new Error('file-artifact requires --question');
        }
        validateArtifactFlags(flags);
        const route = resolveArtifactOverride(flags) ?? await resolveArtifactRoute(repos, { question });
        if (route.type === 'comparison') {
          const result = await fileComparisonPage({
            repos,
            rootDir,
            leftSlug: route.left.slug,
            leftType: route.left.type,
            rightSlug: route.right.slug,
            rightType: route.right.type,
            title: flags.title
          });
          stdout.write(`Filed comparison [[${result.page.slug}]]\n`);
          return { route, ...result };
        }
        if (route.type === 'timeline') {
          const result = await fileTimelinePage({
            repos,
            rootDir,
            slug: route.target.slug,
            title: flags.title
          });
          stdout.write(`Filed timeline [[${result.page.slug}]]\n`);
          return { route, ...result };
        }
        const result = await fileAnswerPage({
          repos,
          rootDir,
          question,
          title: flags.title ?? question,
          slug: route.slug
        });
        stdout.write(`Filed [[${result.page.slug}]]\n`);
        return { route, ...result };
      }
      case 'lint-wiki': {
        const findings = await lintWiki({
          pages: await repos.pages.all(),
          sources: await repos.sources.all()
        });
        const reportPath = path.join(createPaths(rootDir).metaReports, 'latest-lint.md');
        await writeIfChanged(reportPath, `# Lint Report\n\n${formatFindings(findings)}`);
        stdout.write(formatFindings(findings));
        return { findings, reportPath };
      }
      case 'suggest-gaps': {
        const pages = await repos.pages.all();
        const findings = await lintWiki({ pages, sources: await repos.sources.all() });
        const suggestions = findings.slice(0, 10).map((finding) => finding.message);
        stdout.write(`${suggestions.join('\n')}\n`);
        return { suggestions };
      }
      case 'repair': {
        const result = await repairRepositoryArtifacts(rootDir, repos, {
          prune: Boolean(flags.prune)
        });
        const mongoHealth = await inspectMongoHealth(repos);
        stdout.write(`Repaired ${result.exportedPages} wiki exports\n`);
        stdout.write(`Missing wiki exports: ${result.consistency.missingExports.length}\n`);
        stdout.write(`Extra wiki exports: ${result.consistency.extraExports.length}\n`);
        if (mongoHealth) {
          stdout.write(`Mongo collections checked: ${mongoHealth.collectionCount}\n`);
          stdout.write(`${formatMongoIndexStatus(mongoHealth)}\n`);
        }
        if (result.prunedFiles.length > 0) {
          stdout.write(`Pruned wiki exports: ${result.prunedFiles.length}\n`);
        }
        return result;
      }
      default:
        stderr.write(`Unknown command: ${command}\n`);
        throw new Error(`Unknown command: ${command}`);
    }
  }, repoOptions);
}
