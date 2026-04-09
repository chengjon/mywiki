import { createId } from '../config.js';

function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? 500;
  const headings = [];
  const chunks = [];
  let buffer = [];

  function flushBuffer() {
    const combined = buffer.join('\n\n').trim();
    buffer = [];
    if (!combined) {
      return;
    }

    const paragraphs = splitParagraphs(combined);
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxChars) {
        chunks.push({
          id: createId('chk'),
          headingPath: headings.filter(Boolean),
          text: paragraph
        });
        continue;
      }

      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push({
          id: createId('chk'),
          headingPath: headings.filter(Boolean),
          text: paragraph.slice(index, index + maxChars)
        });
      }
    }
  }

  for (const line of String(text).split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      flushBuffer();
      const depth = match[1].length;
      headings.splice(depth - 1);
      headings[depth - 1] = match[2].trim();
      continue;
    }
    buffer.push(line);
  }

  flushBuffer();
  return chunks;
}
