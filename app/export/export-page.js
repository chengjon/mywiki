import path from 'node:path';

import { createPaths, pageDirectoryName } from '../config.js';
import { writeIfChanged } from '../fs.js';
import { renderWikiPage } from '../markdown.js';

export async function exportPage(rootDir, page) {
  const paths = createPaths(rootDir);
  const directory = path.join(rootDir, 'wiki', pageDirectoryName(page.type));
  const filePath = path.join(directory, `${page.slug}.md`);
  const contents = renderWikiPage(page);
  await writeIfChanged(filePath, contents);
  return { filePath, contents, paths };
}
