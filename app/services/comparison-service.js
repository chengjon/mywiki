import { normalizePageType, slugify } from '../config.js';
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

function overlap(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function bulletList(items, formatter = (item) => item, empty = '- None') {
  if (items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${formatter(item)}`).join('\n');
}

function sourceRefsFor(page) {
  const explicit = (page.sources ?? []).map((entry) => ({
    id: entry.id,
    title: entry.title ?? entry.id
  }));
  const fallback = (page.sourceIds ?? []).map((id) => ({ id, title: id }));
  return uniqueBy([...explicit, ...fallback], (entry) => entry.id);
}

function relatedRefsFor(page) {
  return uniqueBy(page.relatedPages ?? [], (entry) => entry.slug);
}

async function resolveComparisonTarget(repos, slug, type) {
  if (!type) {
    return repos.pages.findBy('slug', slug);
  }

  const normalizedType = normalizePageType(type);
  const pages = await repos.pages.all();
  const candidates = pages.filter((page) =>
    page.type === normalizedType && (
      page.slug === slug ||
      page.slug === `${slug}-${normalizedType}`
    )
  );

  if (candidates.length === 0) {
    return null;
  }

  const exact = candidates.find((page) => page.slug === slug);
  return exact ?? candidates[0];
}

function buildDetails(leftPage, rightPage) {
  const leftPoints = uniqueStrings(leftPage.keyPoints ?? []);
  const rightPoints = uniqueStrings(rightPage.keyPoints ?? []);
  const sharedPoints = overlap(leftPoints, rightPoints);
  const leftOnlyPoints = difference(leftPoints, rightPoints);
  const rightOnlyPoints = difference(rightPoints, leftPoints);

  const leftSources = sourceRefsFor(leftPage);
  const rightSources = sourceRefsFor(rightPage);
  const leftSourceIds = leftSources.map((entry) => entry.id);
  const rightSourceIds = rightSources.map((entry) => entry.id);
  const sharedSourceIds = overlap(leftSourceIds, rightSourceIds);
  const leftOnlySourceIds = difference(leftSourceIds, rightSourceIds);
  const rightOnlySourceIds = difference(rightSourceIds, leftSourceIds);

  const leftRelated = relatedRefsFor(leftPage);
  const rightRelated = relatedRefsFor(rightPage);
  const sharedRelatedSlugs = overlap(
    leftRelated.map((entry) => entry.slug),
    rightRelated.map((entry) => entry.slug)
  );

  return [
    '### Left',
    '',
    `- Page: [[${leftPage.slug}]]`,
    `- Summary: ${leftPage.summary || 'No summary yet.'}`,
    '- Key Points:',
    bulletList(leftPoints),
    '- Related:',
    bulletList(leftRelated, (entry) => `[[${entry.slug}]]${entry.summary ? ` - ${entry.summary}` : ''}`),
    '',
    '### Right',
    '',
    `- Page: [[${rightPage.slug}]]`,
    `- Summary: ${rightPage.summary || 'No summary yet.'}`,
    '- Key Points:',
    bulletList(rightPoints),
    '- Related:',
    bulletList(rightRelated, (entry) => `[[${entry.slug}]]${entry.summary ? ` - ${entry.summary}` : ''}`),
    '',
    '### Overlap',
    '',
    '- Shared Key Points:',
    bulletList(sharedPoints),
    '- Shared Related Pages:',
    bulletList(sharedRelatedSlugs, (slug) => `[[${slug}]]`),
    '- Shared Sources:',
    bulletList(sharedSourceIds, (id) => `\`${id}\``),
    '',
    '### Differences',
    '',
    `- Only in ${leftPage.title} key points: ${leftOnlyPoints.join(', ') || 'None'}`,
    `- Only in ${rightPage.title} key points: ${rightOnlyPoints.join(', ') || 'None'}`,
    `- Only in ${leftPage.title} sources: ${leftOnlySourceIds.map((id) => `\`${id}\``).join(', ') || 'None'}`,
    `- Only in ${rightPage.title} sources: ${rightOnlySourceIds.map((id) => `\`${id}\``).join(', ') || 'None'}`,
    '',
    '### Comparison Basis',
    '',
    `- Left page: [[${leftPage.slug}]]`,
    `- Right page: [[${rightPage.slug}]]`,
    `- Combined source_ids: ${uniqueStrings([...leftPage.sourceIds ?? [], ...rightPage.sourceIds ?? []]).map((id) => `\`${id}\``).join(', ') || 'None'}`,
    `- Page types: ${leftPage.type} vs ${rightPage.type}`
  ].join('\n');
}

export async function createComparisonPage(repos, { leftSlug, leftType, rightSlug, rightType, title }) {
  const leftPage = await resolveComparisonTarget(repos, leftSlug, leftType);
  if (!leftPage) {
    throw new Error(`Left comparison page not found: ${leftSlug}${leftType ? ` (${normalizePageType(leftType)})` : ''}`);
  }
  const rightPage = await resolveComparisonTarget(repos, rightSlug, rightType);
  if (!rightPage) {
    throw new Error(`Right comparison page not found: ${rightSlug}${rightType ? ` (${normalizePageType(rightType)})` : ''}`);
  }

  const leftPoints = uniqueStrings(leftPage.keyPoints ?? []);
  const rightPoints = uniqueStrings(rightPage.keyPoints ?? []);
  const sharedPoints = overlap(leftPoints, rightPoints);
  const leftOnlyPoints = difference(leftPoints, rightPoints);
  const rightOnlyPoints = difference(rightPoints, leftPoints);
  const allSources = uniqueBy(
    [...sourceRefsFor(leftPage), ...sourceRefsFor(rightPage)],
    (entry) => entry.id
  );
  const allOpenQuestions = uniqueStrings([...(leftPage.openQuestions ?? []), ...(rightPage.openQuestions ?? [])]);
  const pageTitle = title ?? `${leftPage.title} vs ${rightPage.title}`;

  return upsertPage(repos, {
    title: pageTitle,
    slug: slugify(pageTitle),
    type: 'comparison',
    tags: ['comparison', leftPage.type, rightPage.type],
    sourceIds: uniqueStrings([...(leftPage.sourceIds ?? []), ...(rightPage.sourceIds ?? [])]),
    entityIds: uniqueStrings([...(leftPage.entityIds ?? []), ...(rightPage.entityIds ?? [])]),
    summary: `${leftPage.title} and ${rightPage.title} are compared from maintained wiki pages with ${sharedPoints.length} shared key point${sharedPoints.length === 1 ? '' : 's'} and ${allSources.length} total supporting source${allSources.length === 1 ? '' : 's'}.`,
    keyPoints: [
      `Left page: [[${leftPage.slug}]]`,
      `Right page: [[${rightPage.slug}]]`,
      sharedPoints.length > 0 ? `Shared key points: ${sharedPoints.join(', ')}` : 'Shared key points: none recorded',
      leftOnlyPoints.length > 0 ? `${leftPage.title}-specific: ${leftOnlyPoints.join(', ')}` : `${leftPage.title}-specific: none recorded`,
      rightOnlyPoints.length > 0 ? `${rightPage.title}-specific: ${rightOnlyPoints.join(', ')}` : `${rightPage.title}-specific: none recorded`
    ],
    details: buildDetails(leftPage, rightPage),
    relatedPages: uniqueBy(
      [
        { slug: leftPage.slug, summary: `${leftPage.type}: ${leftPage.title}` },
        { slug: rightPage.slug, summary: `${rightPage.type}: ${rightPage.title}` },
        ...relatedRefsFor(leftPage),
        ...relatedRefsFor(rightPage)
      ],
      (entry) => entry.slug
    ),
    sources: allSources,
    openQuestions: allOpenQuestions,
    changeNotes: ['Filed from compare-pages CLI command']
  });
}
