import path from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

import { createPaths, slugify } from '../config.js';

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(text) {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html, predicate) {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g)].map((entry) => [entry[1].toLowerCase(), decodeHtmlEntities(entry[2])])
    );
    if (predicate(attributes)) {
      return attributes.content ?? null;
    }
  }
  return null;
}

function extractCanonicalUrl(html) {
  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = match[0];
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g)].map((entry) => [entry[1].toLowerCase(), decodeHtmlEntities(entry[2])])
    );
    if (attributes.rel?.toLowerCase() === 'canonical' && attributes.href) {
      return attributes.href;
    }
  }
  return null;
}

function extractHtmlSection(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match?.[1] ?? null;
}

function htmlToMarkdownish(html) {
  const sanitized = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const primary = extractHtmlSection(sanitized, 'article')
    ?? extractHtmlSection(sanitized, 'main')
    ?? extractHtmlSection(sanitized, 'body')
    ?? sanitized;

  const title = stripTags(extractHtmlSection(sanitized, 'title') ?? '');
  const lines = [];
  const seen = new Set();

  if (title) {
    lines.push(`# ${title}`);
    seen.add(title.toLowerCase());
  }

  for (const match of primary.matchAll(/<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[2]);
    if (!text) {
      continue;
    }
    if ((tag === 'h1' || tag === 'p') && seen.has(text.toLowerCase())) {
      continue;
    }
    seen.add(text.toLowerCase());
    if (tag === 'h1') {
      lines.push(`# ${text}`);
    } else if (tag === 'h2') {
      lines.push(`## ${text}`);
    } else if (tag === 'h3') {
      lines.push(`### ${text}`);
    } else if (tag === 'li') {
      lines.push(`- ${text}`);
    } else {
      lines.push(text);
    }
  }

  if (lines.length === 0) {
    return stripTags(primary);
  }

  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractWebMetadata(html, uri) {
  let domain = null;
  try {
    domain = new URL(uri).hostname;
  } catch {
    domain = null;
  }

  return {
    domain,
    author:
      extractMetaContent(html, (attributes) => attributes.name === 'author') ??
      extractMetaContent(html, (attributes) => attributes.property === 'author') ??
      null,
    publishedAt:
      extractMetaContent(html, (attributes) => attributes.property === 'article:published_time') ??
      extractMetaContent(html, (attributes) => attributes.name === 'article:published_time') ??
      extractMetaContent(html, (attributes) => attributes.name === 'pubdate') ??
      null,
    canonicalUrl: extractCanonicalUrl(html)
  };
}

async function fetchWebText(uri) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${uri}: ${response.status} ${response.statusText}`);
  }
  return {
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? ''
  };
}

export async function materializeSource({ rootDir, sourceType, title, localPath, rawText, uri }) {
  const paths = createPaths(rootDir);
  const slug = slugify(title || uri || localPath || 'source');

  if (sourceType === 'file') {
    const sourceText = await readFile(localPath, 'utf8');
    const extension = path.extname(localPath) || '.md';
    const targetPath = path.join(paths.rawFiles, `${slug}${extension}`);
    if (path.resolve(localPath) !== path.resolve(targetPath)) {
      await copyFile(localPath, targetPath);
    }
    return { text: sourceText, storedPath: targetPath, metadata: {} };
  }

  if (sourceType === 'note') {
    const targetPath = path.join(paths.rawNotes, `${slug}.md`);
    await writeFile(targetPath, rawText ?? '', 'utf8');
    return { text: rawText ?? '', storedPath: targetPath, metadata: {} };
  }

  if (sourceType === 'web') {
    const targetPath = path.join(paths.rawWeb, `${slug}.md`);
    let bodyText = rawText;
    let metadata = {};
    if (!bodyText) {
      const fetched = await fetchWebText(uri);
      metadata = extractWebMetadata(fetched.body, uri);
      bodyText = /html/i.test(fetched.contentType) || /<html[\s>]|<!doctype html/i.test(fetched.body)
        ? htmlToMarkdownish(fetched.body)
        : fetched.body;
    } else {
      metadata = { domain: (() => { try { return new URL(uri).hostname; } catch { return null; } })() };
    }
    const storedText = `Source URL: ${uri ?? ''}\n\n${bodyText}`.trim();
    await writeFile(targetPath, storedText, 'utf8');
    return { text: bodyText, storedPath: targetPath, metadata };
  }

  throw new Error(`Unsupported source type: ${sourceType}`);
}
