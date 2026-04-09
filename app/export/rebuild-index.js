import { createPaths } from '../config.js';
import { ensureRepositoryLayout, writeIfChanged } from '../fs.js';
import { renderIndex } from '../markdown.js';

export async function rebuildIndex(rootDir, pages) {
  await ensureRepositoryLayout(rootDir);
  const paths = createPaths(rootDir);
  const contents = renderIndex(
    pages.map((page) => ({
      ...page,
      type: page.type
    }))
  );
  await writeIfChanged(paths.metaIndex, contents);
  return { filePath: paths.metaIndex, contents };
}
