function normalizeComparableText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

const similarityStopWords = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'who', 'what', 'when', 'where', 'why', 'how',
  'explain', 'summarize', 'summary', 'tell', 'about', 'me', 'please'
]);

function extractStoredQuestion(page) {
  const match = String(page?.details ?? '').match(/^Question:\s*(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function tokenizeComparableText(value) {
  return [...new Set(
    String(value ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/gu)
      .map((token) => token.trim())
      .filter((token) => token && !similarityStopWords.has(token))
  )];
}

function compareTokenSets(leftTokens, rightTokens) {
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const overlapTerms = [...leftSet].filter((token) => rightSet.has(token));
  const unionSize = new Set([...leftSet, ...rightSet]).size;
  return {
    overlapTerms,
    score: unionSize === 0 ? 0 : overlapTerms.length / unionSize
  };
}

export async function findMergeableQueryPage(repos, { slug, explicitSlug = false, title, question }) {
  const queryPages = (await repos.pages.all()).filter((page) => page.type === 'query');
  const normalizedQuestion = normalizeComparableText(question);

  if (explicitSlug && slug) {
    const slugMatch = queryPages.find((page) => page.slug === slug);
    if (slugMatch) {
      return { page: slugMatch, reason: 'slug' };
    }
  }

  const normalizedTitle = normalizeComparableText(title);
  if (normalizedTitle) {
    const titleMatch = queryPages.find((page) => {
      if (normalizeComparableText(page.title) !== normalizedTitle) {
        return false;
      }
      const storedQuestion = normalizeComparableText(extractStoredQuestion(page));
      if (!storedQuestion || !normalizedQuestion) {
        return true;
      }
      return storedQuestion === normalizedQuestion;
    });
    if (titleMatch) {
      return { page: titleMatch, reason: 'title' };
    }
  }

  if (normalizedQuestion) {
    const questionMatch = queryPages.find((page) => normalizeComparableText(extractStoredQuestion(page)) === normalizedQuestion);
    if (questionMatch) {
      return { page: questionMatch, reason: 'question' };
    }
  }

  return null;
}

export async function findSimilarQueryPages(repos, { title, question, limit = 3 } = {}) {
  const incomingTokens = tokenizeComparableText(`${title ?? ''} ${question ?? ''}`);
  if (incomingTokens.length < 2) {
    return [];
  }

  const queryPages = (await repos.pages.all()).filter((page) => page.type === 'query');
  return queryPages
    .map((page) => {
      const storedQuestion = extractStoredQuestion(page);
      const existingTokens = tokenizeComparableText(`${page.title ?? ''} ${storedQuestion}`);
      const comparison = compareTokenSets(incomingTokens, existingTokens);
      const titleComparison = compareTokenSets(
        tokenizeComparableText(title),
        tokenizeComparableText(page.title)
      );
      const questionComparison = compareTokenSets(
        tokenizeComparableText(question),
        tokenizeComparableText(storedQuestion)
      );
      const reasons = [];
      if (page.title) {
        reasons.push(`Existing title: ${page.title}`);
      }
      if (storedQuestion) {
        reasons.push(`Existing question: ${storedQuestion}`);
      }
      if (titleComparison.overlapTerms.length > 0) {
        reasons.push(`Title overlap: ${titleComparison.overlapTerms.join(', ')}`);
      }
      if (questionComparison.overlapTerms.length > 0) {
        reasons.push(`Question overlap: ${questionComparison.overlapTerms.join(', ')}`);
      }
      if (comparison.overlapTerms.length > 0) {
        reasons.push(`Overlapping terms: ${comparison.overlapTerms.join(', ')}`);
      }
      if (comparison.score > 0) {
        reasons.push(`Similarity score: ${comparison.score.toFixed(2)}`);
      }
      return {
        page,
        score: comparison.score,
        overlapTerms: comparison.overlapTerms,
        reasons
      };
    })
    .filter((candidate) => candidate.overlapTerms.length >= 2 && candidate.score >= 0.5)
    .sort((left, right) =>
      right.score - left.score ||
      right.overlapTerms.length - left.overlapTerms.length ||
      String(left.page.title ?? '').localeCompare(String(right.page.title ?? ''))
    )
    .slice(0, limit);
}
