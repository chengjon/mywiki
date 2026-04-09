function pushFinding(findings, finding) {
  findings.push(finding);
}

export async function lintWiki({ pages, sources = [] }) {
  const findings = [];
  const slugCounts = new Map();
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));
  const nonSourcePages = pages.filter((page) => page.type !== 'source');

  for (const page of pages) {
    slugCounts.set(page.slug, (slugCounts.get(page.slug) ?? 0) + 1);
    if ((!page.sourceIds || page.sourceIds.length === 0) && page.type !== 'overview') {
      pushFinding(findings, {
        severity: 'warn',
        code: 'missing-sources',
        page: page.slug,
        message: `${page.slug} has no source_ids backing it.`
      });
    }
    if ((page.relatedPages ?? []).length === 0 && page.type !== 'overview' && page.type !== 'source') {
      pushFinding(findings, {
        severity: 'info',
        code: 'orphan-page',
        page: page.slug,
        message: `${page.slug} has no related page links recorded.`
      });
    }

    if (page.type === 'concept' && (page.relatedPages ?? []).length === 0) {
      pushFinding(findings, {
        severity: 'warn',
        code: 'isolated-concept',
        page: page.slug,
        message: `${page.slug} is a concept page with no related topic or source links.`
      });
    }

    if (page.type === 'topic') {
      const sourceIds = page.sourceIds ?? [];
      if (sourceIds.length === 0) {
        pushFinding(findings, {
          severity: 'warn',
          code: 'topic-source-drift',
          page: page.slug,
          message: `${page.slug} is a topic page without source_ids, so it may be detached from source integration.`
        });
      }
    }
  }

  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      pushFinding(findings, {
        severity: 'error',
        code: 'duplicate-slug',
        page: slug,
        message: `${slug} appears ${count} times in the page collection.`
      });
    }
  }

  for (const source of sources) {
    const integrated = nonSourcePages.some((page) => (page.sourceIds ?? []).includes(source.id));
    if (!integrated) {
      pushFinding(findings, {
        severity: 'warn',
        code: 'unintegrated-source',
        page: source.slug,
        message: `${source.slug} is registered but not integrated into topic, concept, entity, or query pages.`
      });
    }

    if (source.sourceType === 'web') {
      const requiredMetadata = ['canonicalUrl', 'author', 'publishedAt'];
      for (const field of requiredMetadata) {
        if (!source.metadata?.[field]) {
          pushFinding(findings, {
            severity: 'info',
            code: 'missing-web-metadata',
            page: source.slug,
            message: `${source.slug} is missing web metadata field: ${field}.`
          });
        }
      }

      if (source.metadata?.contentDrift) {
        pushFinding(findings, {
          severity: 'warn',
          code: 'content-drift',
          page: source.slug,
          message: `${source.slug} has ${source.metadata.contentVersionCount ?? 2} observed content versions under one canonical source and should be reviewed.`
        });
      }
    }
  }

  for (const page of pages.filter((page) => page.type === 'source')) {
    for (const related of page.relatedPages ?? []) {
      const target = pagesBySlug.get(related.slug);
      if (target?.type === 'topic' && !(target.sourceIds ?? []).some((sourceId) => (page.sourceIds ?? []).includes(sourceId))) {
        pushFinding(findings, {
          severity: 'warn',
          code: 'topic-source-drift',
          page: target.slug,
          message: `${target.slug} is linked from source ${page.slug} but does not reference the same source_ids.`
        });
      }
    }
  }

  return findings;
}
