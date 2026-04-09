import { createPaths } from '../config.js';
import { ensureRepositoryLayout, writeIfChanged } from '../fs.js';
import { renderLog } from '../markdown.js';

export async function rebuildLog(rootDir, events) {
  await ensureRepositoryLayout(rootDir);
  const paths = createPaths(rootDir);
  const contents = renderLog(events);
  await writeIfChanged(paths.metaLog, contents);
  return { filePath: paths.metaLog, contents };
}
