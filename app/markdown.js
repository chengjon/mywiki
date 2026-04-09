function yamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => yamlScalar(item)).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = String(value);
  if (/^[A-Za-z0-9_.:-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

const generatedNotice = '<!-- This file is auto-generated. Edit via mywiki CLI instead. -->';

export function renderFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function renderSection(title, content) {
  if (!content) {
    return '';
  }
  if (Array.isArray(content)) {
    if (content.length === 0) {
      return '';
    }
    return `## ${title}\n\n${content.map((item) => `- ${item}`).join('\n')}`;
  }
  return `## ${title}\n\n${String(content).trim()}`;
}

export function renderWikiPage(page) {
  const frontmatter = renderFrontmatter({
    page_id: page.id,
    title: page.title,
    slug: page.slug,
    type: page.type,
    status: page.status ?? 'active',
    tags: page.tags ?? [],
    source_ids: page.sourceIds ?? [],
    entity_ids: page.entityIds ?? [],
    updated_at: page.updatedAt,
    created_at: page.createdAt,
    confidence: page.confidence ?? 'medium'
  });

  const sections = [
    renderSection('Summary', page.summary),
    renderSection('Key Points', page.keyPoints),
    renderSection('Details', page.details),
    renderSection('Related', (page.relatedPages ?? []).map((entry) => `[[${entry.slug}]]${entry.summary ? ` - ${entry.summary}` : ''}`)),
    renderSection('Sources', (page.sources ?? []).map((entry) => `\`${entry.id}\`${entry.title ? ` - ${entry.title}` : ''}`)),
    renderSection('Open Questions', page.openQuestions),
    renderSection('Change Notes', page.changeNotes)
  ].filter(Boolean);

  return `${generatedNotice}\n${frontmatter}\n\n# ${page.title}\n\n${sections.join('\n\n')}\n`;
}

export function renderIndex(pages) {
  const headings = {
    overview: 'Overview',
    source: 'Sources',
    entity: 'Entities',
    concept: 'Concepts',
    topic: 'Topics',
    comparison: 'Comparisons',
    timeline: 'Timelines',
    query: 'Queries'
  };

  const grouped = new Map();
  for (const page of pages) {
    const type = page.type;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type).push(page);
  }

  const lines = ['# MyWiki Index', '', 'This file is rebuilt by `mywiki rebuild-index`.', ''];
  for (const [type, title] of Object.entries(headings)) {
    const entries = (grouped.get(type) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    if (entries.length === 0) {
      continue;
    }
    lines.push(`## ${title}`, '');
    for (const entry of entries) {
      lines.push(`- [[${entry.slug}]] - ${entry.summary ?? 'No summary yet.'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function renderLog(events) {
  const lines = ['# MyWiki Log', '', 'This file is rebuilt by `mywiki rebuild-log`.', ''];
  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const date = event.createdAt.slice(0, 10);
    lines.push(`## [${date}] ${event.eventType} | ${event.title}`, '');
    lines.push(event.details || 'No details recorded.', '');
  }
  return `${lines.join('\n').trim()}\n`;
}
