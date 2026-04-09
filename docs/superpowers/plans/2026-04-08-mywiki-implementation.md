# MyWiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal but working `mywiki` repository that supports source registration, ingest, wiki export, index/log rebuild, linting, and query against a MongoDB-backed support layer with Obsidian-friendly Markdown output.

**Architecture:** Use a small Node.js ESM CLI with a focused module layout. Persist operational records in MongoDB, keep raw sources on disk, and export durable wiki pages plus `meta/index.md` and `meta/log.md` from database-backed page records.

**Tech Stack:** Node.js ESM, MongoDB Node driver, Node built-in test runner, filesystem-based raw/wiki/meta layout.

---

### Task 1: Initialize project scaffold and configuration

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `app/config.js`
- Test: `tests/config.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaths, slugify } from '../app/config.js';

test('slugify normalizes titles into stable slugs', () => {
  assert.equal(slugify('RAG vs LLM Wiki'), 'rag-vs-llm-wiki');
});

test('createPaths returns required repository directories', () => {
  const paths = createPaths('/repo');
  assert.equal(paths.rawInbox, '/repo/raw/inbox');
  assert.equal(paths.wikiTopics, '/repo/wiki/topics');
  assert.equal(paths.metaIndex, '/repo/meta/index.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL because `app/config.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/config.js` with:

```js
import path from 'node:path';

export function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createPaths(rootDir) {
  return {
    rootDir,
    rawInbox: path.join(rootDir, 'raw', 'inbox'),
    rawWeb: path.join(rootDir, 'raw', 'web'),
    rawFiles: path.join(rootDir, 'raw', 'files'),
    rawNotes: path.join(rootDir, 'raw', 'notes'),
    rawAssets: path.join(rootDir, 'raw', 'assets'),
    wikiOverview: path.join(rootDir, 'wiki', 'overview'),
    wikiSources: path.join(rootDir, 'wiki', 'sources'),
    wikiEntities: path.join(rootDir, 'wiki', 'entities'),
    wikiConcepts: path.join(rootDir, 'wiki', 'concepts'),
    wikiTopics: path.join(rootDir, 'wiki', 'topics'),
    wikiComparisons: path.join(rootDir, 'wiki', 'comparisons'),
    wikiTimelines: path.join(rootDir, 'wiki', 'timelines'),
    wikiQueries: path.join(rootDir, 'wiki', 'queries'),
    metaDir: path.join(rootDir, 'meta'),
    metaReports: path.join(rootDir, 'meta', 'reports'),
    metaManifests: path.join(rootDir, 'meta', 'manifests'),
    metaTemplates: path.join(rootDir, 'meta', 'templates'),
    metaIndex: path.join(rootDir, 'meta', 'index.md'),
    metaLog: path.join(rootDir, 'meta', 'log.md'),
    systemPrompts: path.join(rootDir, 'system', 'prompts'),
    systemSchemas: path.join(rootDir, 'system', 'schemas'),
    systemExports: path.join(rootDir, 'system', 'exports')
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore .env.example README.md AGENTS.md app/config.js tests/config.test.js
git commit -m "feat: initialize mywiki scaffold"
```

### Task 2: Build repository bootstrap and markdown helpers

**Files:**
- Create: `app/fs.js`
- Create: `app/markdown.js`
- Test: `tests/fs.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { ensureRepositoryLayout } from '../app/fs.js';

test('ensureRepositoryLayout creates required wiki and meta files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);
  const indexText = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  assert.match(indexText, /# MyWiki Index/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/fs.test.js`
Expected: FAIL because `app/fs.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/fs.js` with directory creation plus template file initialization and create `app/markdown.js` with frontmatter/render helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/fs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/fs.js app/markdown.js tests/fs.test.js
git commit -m "feat: add repository bootstrap helpers"
```

### Task 3: Add source parsing and chunking

**Files:**
- Create: `app/ingest/read-source.js`
- Create: `app/ingest/chunk-text.js`
- Test: `tests/ingest.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../app/ingest/chunk-text.js';

test('chunkText keeps heading context and splits long text', () => {
  const chunks = chunkText('# Title\n\nA short paragraph.\n\n## Part\n\nAnother paragraph.');
  assert.equal(chunks[0].headingPath[0], 'Title');
  assert.equal(chunks[1].headingPath[0], 'Title');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ingest.test.js`
Expected: FAIL because chunking modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement a heading-aware text chunker and a source reader that supports local file inputs and note text inputs.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ingest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/ingest/read-source.js app/ingest/chunk-text.js tests/ingest.test.js
git commit -m "feat: add source parsing and chunking"
```

### Task 4: Add MongoDB repositories and core service operations

**Files:**
- Create: `app/db/mongo.js`
- Create: `app/db/repositories.js`
- Create: `app/services/source-service.js`
- Create: `app/services/page-service.js`
- Create: `app/services/audit-service.js`
- Test: `tests/services.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepositories } from '../app/db/repositories.js';
import { registerSource } from '../app/services/source-service.js';

test('registerSource stores normalized source metadata', async () => {
  const repos = createInMemoryRepositories();
  const source = await registerSource(repos, { title: 'Test Source', sourceType: 'note', rawText: 'hello' });
  assert.equal(source.slug, 'test-source');
  assert.equal((await repos.sources.all()).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/services.test.js`
Expected: FAIL because repositories and services do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- MongoDB connection wrapper
- repository factory with Mongo-backed repositories
- in-memory repositories for tests
- source registration
- page upsert and audit log append services

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/services.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/db/mongo.js app/db/repositories.js app/services/source-service.js app/services/page-service.js app/services/audit-service.js tests/services.test.js
git commit -m "feat: add repository-backed core services"
```

### Task 5: Implement export, index rebuild, and log rebuild

**Files:**
- Create: `app/export/export-page.js`
- Create: `app/export/rebuild-index.js`
- Create: `app/export/rebuild-log.js`
- Test: `tests/export.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { exportPage, rebuildIndex } from '../app/export/rebuild-index.js';

test('rebuildIndex writes categorized page links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await rebuildIndex(root, [
    { slug: 'openai', title: 'OpenAI', type: 'entity', summary: 'AI lab' }
  ]);
  const text = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  assert.match(text, /\[\[openai\]\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/export.test.js`
Expected: FAIL because export modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement deterministic Markdown export plus index/log rebuild functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/export.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/export/export-page.js app/export/rebuild-index.js app/export/rebuild-log.js tests/export.test.js
git commit -m "feat: export wiki pages and meta artifacts"
```

### Task 6: Implement ingest, ask, lint, and doctor commands

**Files:**
- Create: `app/query/ask.js`
- Create: `app/lint/lint-wiki.js`
- Create: `app/cli/index.js`
- Create: `bin/mywiki.js`
- Test: `tests/cli.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../app/query/ask.js';

test('answerQuestion prefers wiki pages before source chunks', async () => {
  const result = await answerQuestion({
    question: 'What is OpenAI?',
    pages: [{ title: 'OpenAI', slug: 'openai', summary: 'An AI research and product company.' }],
    chunks: [{ sourceId: 'src_1', text: 'OpenAI builds models.' }]
  });
  assert.match(result.answer, /OpenAI/);
  assert.equal(result.citations[0].type, 'page');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli.test.js`
Expected: FAIL because query and CLI modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- `ingest-source`
- `ask`
- `file-answer`
- `lint-wiki`
- `rebuild-index`
- `rebuild-log`
- `suggest-gaps`
- `doctor`

using a small argument parser and the service/export modules.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/query/ask.js app/lint/lint-wiki.js app/cli/index.js bin/mywiki.js tests/cli.test.js
git commit -m "feat: add mywiki workflow commands"
```

### Task 7: Verify end-to-end repository behavior and documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `tests/e2e.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { runCli } from '../app/cli/index.js';

test('ingest-source writes source page and index entry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'note.md');
  await writeFile(file, '# Example\n\nMyWiki keeps knowledge.');
  await runCli(['doctor', '--root', root, '--bootstrap-only']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'Example']);
  const sourcePage = await readFile(path.join(root, 'wiki', 'sources', 'example.md'), 'utf8');
  const indexPage = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  assert.match(sourcePage, /# Example/);
  assert.match(indexPage, /\[\[example\]\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/e2e.test.js`
Expected: FAIL because CLI integration is incomplete.

- [ ] **Step 3: Write minimal implementation**

Tighten command wiring, bootstrap behavior, and docs until the end-to-end test passes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md tests/e2e.test.js
git commit -m "feat: deliver end-to-end mywiki bootstrap"
```

## Self-Review

Spec coverage:

- repository structure is covered in Tasks 1 and 2
- MongoDB support layer is covered in Task 4
- page export, index, and log are covered in Task 5
- ingest/query/lint workflows are covered in Tasks 3, 5, and 6
- Obsidian-compatible Markdown output is covered in Tasks 2 and 5
- rule-oriented `AGENTS.md` is covered in Task 7

Placeholder scan:

- no `TODO` or `TBD` placeholders remain in task steps

Type consistency:

- path helpers originate in `app/config.js`
- repositories and services are introduced before CLI wiring
- export and query modules are referenced after their planned creation
