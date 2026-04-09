function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const comparisonKeywords = ['vs', 'versus', 'compare', 'comparison', 'different', 'difference', '区别', '对比', '比较'];
const timelineKeywords = ['timeline', 'history', 'evolution', 'chronology', '时间线', '历史', '演进', '历程'];
const allowedPageTypes = new Set(['topic', 'entity', 'concept', 'query']);
const typeWeights = {
  topic: 40,
  entity: 30,
  concept: 20,
  query: 10
};
const routingTypePreference = {
  topic: 4,
  entity: 3,
  concept: 2,
  query: 1
};

function questionContainsKeyword(question, keywords) {
  const lower = String(question).toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function scorePage(question, page) {
  const lowerQuestion = String(question).toLowerCase();
  const lowerTitle = String(page.title ?? '').toLowerCase();
  const lowerSlug = String(page.slug ?? '').toLowerCase();
  let score = 0;
  let matched = false;
  const positions = [];
  let titleMatched = false;

  if (lowerTitle && lowerQuestion.includes(lowerTitle)) {
    matched = true;
    titleMatched = true;
    score += 100;
    positions.push(lowerQuestion.indexOf(lowerTitle));
  }
  if (lowerSlug && lowerQuestion.includes(lowerSlug)) {
    matched = true;
    score += 60;
    positions.push(lowerQuestion.indexOf(lowerSlug));
  }

  const questionTerms = tokenize(question);
  const pageTerms = new Set(tokenize(`${page.title ?? ''} ${page.slug ?? ''}`));
  for (const term of questionTerms) {
    if (pageTerms.has(term)) {
      matched = true;
      score += 15;
    }
  }

  if (!matched) {
    return { score: 0, position: Number.POSITIVE_INFINITY };
  }

  return {
    score: score + (typeWeights[page.type] ?? 0),
    position: positions.length > 0 ? Math.min(...positions) : Number.POSITIVE_INFINITY,
    titleMatched
  };
}

function pickRankedPages(question, pages) {
  const candidates = pages
    .filter((page) => allowedPageTypes.has(page.type))
    .map((page) => {
      const ranked = scorePage(question, page);
      return { page, ...ranked };
    })
    .filter((entry) => entry.score > 0);

  const bestByTitle = new Map();
  for (const entry of candidates) {
    const key = String(entry.page.title ?? entry.page.slug ?? '').toLowerCase();
    const current = bestByTitle.get(key);
    if (!current) {
      bestByTitle.set(key, entry);
      continue;
    }

    if (entry.position < current.position) {
      bestByTitle.set(key, entry);
      continue;
    }

    if (entry.position > current.position) {
      continue;
    }

    if (entry.titleMatched && current.titleMatched) {
      const entryPreference = routingTypePreference[entry.page.type] ?? 0;
      const currentPreference = routingTypePreference[current.page.type] ?? 0;
      if (entryPreference > currentPreference) {
        bestByTitle.set(key, entry);
        continue;
      }
      if (entryPreference < currentPreference) {
        continue;
      }
    }

    if (entry.score > current.score) {
      bestByTitle.set(key, entry);
    }
  }

  return [...bestByTitle.values()]
    .sort((left, right) =>
      left.position - right.position ||
      right.score - left.score ||
      String(left.page.title).localeCompare(String(right.page.title))
    )
    .map((entry) => entry.page);
}

export function classifyArtifactQuestion(question) {
  if (questionContainsKeyword(question, comparisonKeywords)) {
    return 'comparison';
  }
  if (questionContainsKeyword(question, timelineKeywords)) {
    return 'timeline';
  }
  return 'query';
}

export async function resolveArtifactRoute(repos, { question }) {
  const type = classifyArtifactQuestion(question);
  if (type === 'query') {
    return { type };
  }

  const pages = await repos.pages.all();
  const rankedPages = pickRankedPages(question, pages);

  if (type === 'comparison') {
    if (rankedPages.length < 2) {
      throw new Error('Could not resolve two comparison targets from question');
    }
    return {
      type,
      left: rankedPages[0],
      right: rankedPages[1]
    };
  }

  if (rankedPages.length < 1) {
    throw new Error('Could not resolve a timeline target from question');
  }
  return {
    type,
    target: rankedPages[0]
  };
}
