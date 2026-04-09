import { slugify } from '../config.js';
import { upsertPage } from './page-service.js';

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceDate(source) {
  return source?.metadata?.publishedAt ?? source?.capturedAt ?? source?.createdAt ?? source?.updatedAt ?? null;
}

function pageDate(page) {
  return page?.updatedAt ?? page?.createdAt ?? null;
}

function byDateAscending(left, right) {
  const leftTime = Date.parse(left.date ?? '') || 0;
  const rightTime = Date.parse(right.date ?? '') || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left.label ?? '').localeCompare(String(right.label ?? ''));
}

function sourceRefsFor(page, sourcesById) {
  const explicit = (page.sources ?? []).map((entry) => ({
    id: entry.id,
    title: entry.title ?? sourcesById.get(entry.id)?.title ?? entry.id
  }));
  const fromIds = (page.sourceIds ?? []).map((id) => ({
    id,
    title: sourcesById.get(id)?.title ?? id
  }));
  return uniqueBy([...explicit, ...fromIds], (entry) => entry.id);
}

function relatedTimelinePages(allPages, targetPage) {
  const targetSourceIds = new Set(targetPage.sourceIds ?? []);
  return uniqueBy(
    allPages.filter((page) =>
      page.type !== 'overview' && (
        page.slug === targetPage.slug ||
        (page.relatedPages ?? []).some((entry) => entry.slug === targetPage.slug) ||
        (page.sourceIds ?? []).some((sourceId) => targetSourceIds.has(sourceId))
      )
    ),
    (page) => page.slug
  );
}

function relatedAuditEvents(auditEvents, targetPage) {
  return auditEvents.filter((event) =>
    (event.relatedIds ?? []).includes(targetPage.id) ||
    String(event.details ?? '').includes(`[[${targetPage.slug}]]`) ||
    String(event.title ?? '') === targetPage.title
  );
}

function buildChronology(targetPage, sources, pages, auditEvents) {
  const events = [];

  const targetUpdated = pageDate(targetPage);
  if (targetUpdated) {
    events.push({
      date: targetUpdated,
      label: 'page',
      detail: `[[${targetPage.slug}]] updated`
    });
  }

  for (const source of sources) {
    const date = sourceDate(source);
    if (!date) {
      continue;
    }
    events.push({
      date,
      label: 'source',
      detail: `\`${source.id}\` - ${source.title}`
    });
  }

  for (const page of pages.filter((entry) => entry.slug !== targetPage.slug)) {
    const date = pageDate(page);
    if (!date) {
      continue;
    }
    events.push({
      date,
      label: 'related page',
      detail: `[[${page.slug}]] - ${page.title}`
    });
  }

  for (const event of auditEvents) {
    if (!event.createdAt) {
      continue;
    }
    events.push({
      date: event.createdAt,
      label: event.eventType,
      detail: `${event.title}${event.details ? ` | ${event.details}` : ''}`
    });
  }

  return events.sort(byDateAscending);
}

function renderBulletList(items, formatter, empty = '- None') {
  if (items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${formatter(item)}`).join('\n');
}

function buildDetails(targetPage, chronology, sources, pages, auditEvents) {
  return [
    '### Chronology',
    '',
    renderBulletList(chronology, (entry) => `${entry.date} | ${entry.label} | ${entry.detail}`),
    '',
    '### Supporting Sources',
    '',
    renderBulletList(
      sources,
      (source) => `\`${source.id}\` - ${source.title}${sourceDate(source) ? ` (${sourceDate(source)})` : ''}`
    ),
    '',
    '### Related Pages',
    '',
    renderBulletList(
      pages,
      (page) => `[[${page.slug}]] - ${page.title}${pageDate(page) ? ` (${pageDate(page)})` : ''}`
    ),
    '',
    '### Audit Trail',
    '',
    renderBulletList(
      auditEvents,
      (event) => `${event.createdAt} | ${event.eventType} | ${event.title}${event.details ? ` | ${event.details}` : ''}`
    )
  ].join('\n');
}

export async function createTimelinePage(repos, { slug, title }) {
  const targetPage = await repos.pages.findBy('slug', slug);
  if (!targetPage) {
    throw new Error(`Timeline target page not found: ${slug}`);
  }

  const allPages = await repos.pages.all();
  const allSources = await repos.sources.all();
  const auditEvents = await repos.auditLog.all();
  const sourcesById = new Map(allSources.map((source) => [source.id, source]));
  const supportingSources = uniqueBy(
    sourceRefsFor(targetPage, sourcesById)
      .map((entry) => sourcesById.get(entry.id) ?? { id: entry.id, title: entry.title })
      .filter(Boolean),
    (entry) => entry.id
  );
  const relatedPages = relatedTimelinePages(allPages, targetPage);
  const matchedAuditEvents = relatedAuditEvents(auditEvents, targetPage);
  const chronology = buildChronology(targetPage, supportingSources, relatedPages, matchedAuditEvents);
  const pageTitle = title ?? `${targetPage.title} Timeline`;
  const earliest = chronology[0]?.date ?? null;
  const latest = chronology[chronology.length - 1]?.date ?? null;

  return upsertPage(repos, {
    title: pageTitle,
    slug: slugify(pageTitle),
    type: 'timeline',
    tags: ['timeline', targetPage.type],
    sourceIds: uniqueStrings([...(targetPage.sourceIds ?? []), ...supportingSources.map((source) => source.id)]),
    entityIds: targetPage.entityIds ?? [],
    summary: `${targetPage.title} timeline captures ${chronology.length} dated events across ${supportingSources.length} source${supportingSources.length === 1 ? '' : 's'} and ${relatedPages.length} related page${relatedPages.length === 1 ? '' : 's'}.`,
    keyPoints: [
      `Target page: [[${targetPage.slug}]]`,
      earliest ? `Earliest dated event: ${earliest}` : 'Earliest dated event: none recorded',
      latest ? `Latest dated event: ${latest}` : 'Latest dated event: none recorded',
      `Related pages captured: ${relatedPages.length}`,
      `Audit events captured: ${matchedAuditEvents.length}`
    ],
    details: buildDetails(targetPage, chronology, supportingSources, relatedPages, matchedAuditEvents),
    relatedPages: uniqueBy(
      [
        { slug: targetPage.slug, summary: `${targetPage.type}: ${targetPage.title}` },
        ...relatedPages
          .filter((page) => page.slug !== targetPage.slug)
          .map((page) => ({ slug: page.slug, summary: `${page.type}: ${page.title}` }))
      ],
      (entry) => entry.slug
    ),
    sources: supportingSources.map((source) => ({ id: source.id, title: source.title })),
    openQuestions: uniqueStrings(targetPage.openQuestions ?? []),
    changeNotes: ['Filed from build-timeline CLI command']
  });
}
