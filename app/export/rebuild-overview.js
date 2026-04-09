import { exportPage } from './export-page.js';
import { upsertPage } from '../services/page-service.js';

const overviewSlug = 'mywiki-overview';

function pageTypeLabel(type) {
  const labels = {
    source: 'Sources',
    entity: 'Entities',
    concept: 'Concepts',
    topic: 'Topics',
    comparison: 'Comparisons',
    timeline: 'Timelines',
    query: 'Queries'
  };
  return labels[type] ?? type;
}

function comparePages(left, right) {
  return String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
    || String(left.title ?? '').localeCompare(String(right.title ?? ''));
}

function topPages(pages, type, limit = 5) {
  return pages
    .filter((page) => page.type === type)
    .sort(comparePages)
    .slice(0, limit);
}

function buildOverviewDetails(pages) {
  const sections = [];
  const orderedTypes = ['topic', 'entity', 'concept', 'query', 'source', 'comparison', 'timeline'];

  for (const type of orderedTypes) {
    const entries = topPages(pages, type);
    if (entries.length === 0) {
      continue;
    }
    sections.push(`### ${pageTypeLabel(type)}`);
    sections.push('');
    sections.push(...entries.map((page) => `- [[${page.slug}]]${page.summary ? ` - ${page.summary}` : ''}`));
    sections.push('');
  }

  if (sections.length === 0) {
    return 'No wiki pages yet. Ingest a source to start building the overview.';
  }

  return sections.join('\n').trim();
}

export async function rebuildOverview(rootDir, repos) {
  const allPages = await repos.pages.all();
  const allSources = await repos.sources.all();
  const contentPages = allPages.filter((page) => !(page.type === 'overview' && page.slug === overviewSlug));
  const recentPages = [...contentPages].sort(comparePages).slice(0, 12);
  const pageCounts = new Map();

  for (const page of contentPages) {
    pageCounts.set(page.type, (pageCounts.get(page.type) ?? 0) + 1);
  }

  const overviewPage = await upsertPage(repos, {
    title: 'MyWiki Overview',
    slug: overviewSlug,
    type: 'overview',
    tags: ['overview', 'navigation'],
    summary: `Top-level navigation for the current wiki, covering ${contentPages.length} pages and ${allSources.length} sources.`,
    keyPoints: [
      `Sources: ${allSources.length}`,
      `Topics: ${pageCounts.get('topic') ?? 0}`,
      `Entities: ${pageCounts.get('entity') ?? 0}`,
      `Concepts: ${pageCounts.get('concept') ?? 0}`,
      `Queries: ${pageCounts.get('query') ?? 0}`
    ],
    details: buildOverviewDetails(contentPages),
    relatedPages: recentPages.map((page) => ({
      slug: page.slug,
      summary: `${pageTypeLabel(page.type).slice(0, -1) || page.type}: ${page.title}`
    })),
    sources: [],
    openQuestions: [],
    changeNotes: ['Rebuilt from current wiki state']
  });

  const exported = await exportPage(rootDir, overviewPage);
  return { page: overviewPage, filePath: exported.filePath, contents: exported.contents };
}
