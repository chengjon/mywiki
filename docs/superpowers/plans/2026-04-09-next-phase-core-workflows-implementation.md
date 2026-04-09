# Next Phase Core Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next operational layer for `mywiki`: batch ingest, stricter artifact command validation, durable query merge, and MongoDB hardening without changing the wiki-first architecture.

**Architecture:** Keep `wiki/` as an exported read surface and push all mutations through CLI/services. Implement each capability as a thin CLI entry backed by focused services so file and mongo storage continue sharing the same workflow surface. Treat batch ingest as a sequential coordinator, not a concurrent worker, so file state and exported artifacts stay deterministic.

**Tech Stack:** Node.js ESM, Node built-in test runner, filesystem exports, shared repository adapters, MongoDB driver.

---

### Task 1: Add sequential batch ingest from `raw/inbox/` or an explicit directory

**Files:**
- Modify: `app/cli/index.js`
- Create: `app/services/batch-ingest-service.js`
- Modify: `tests/e2e.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Add an e2e test that creates two inbox markdown files, runs `batch-ingest`, and asserts:
- both source pages exist
- `meta/index.md`, `meta/log.md`, and `wiki/overview/mywiki-overview.md` are refreshed
- processing is sequential and results are deterministic

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/e2e.test.js`
Expected: FAIL because `batch-ingest` command does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/services/batch-ingest-service.js` to:
- scan a target directory
- filter supported file extensions
- sort filenames for deterministic order
- call existing `ingestSource(...)` one file at a time

Update `app/cli/index.js` to add `batch-ingest` with:
- default target `raw/inbox/`
- optional `--dir`
- optional `--type file|note`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/e2e.test.js`
Expected: PASS with the new batch ingest scenario.

- [ ] **Step 5: Document the command**

Add README examples for:
- `node ./bin/mywiki.js batch-ingest`
- `node ./bin/mywiki.js batch-ingest --dir ./imports`

### Task 2: Tighten `file-artifact` parameter validation and invalid-combination protection

**Files:**
- Modify: `app/cli/index.js`
- Modify: `tests/e2e.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Add focused tests for:
- `--artifact-type comparison` rejecting missing `--left/--right`
- `--artifact-type timeline` rejecting missing `--slug`
- invalid combinations such as `--artifact-type query --left openai`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/e2e.test.js`
Expected: FAIL because invalid combinations are not rejected consistently.

- [ ] **Step 3: Write minimal implementation**

Add a validation helper in `app/cli/index.js` that:
- enforces explicit override requirements
- rejects irrelevant flags for each artifact type
- keeps manual `--artifact-type` higher priority than automatic routing

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/e2e.test.js`
Expected: PASS

- [ ] **Step 5: Update README**

Document valid/invalid override combinations.

### Task 3: Merge durable query pages instead of endlessly adding near-duplicates

**Files:**
- Modify: `app/cli/index.js`
- Create: `app/services/query-page-service.js`
- Modify: `tests/e2e.test.js`
- Modify: `tests/services.test.js`

- [ ] **Step 1: Write the failing test**

Add tests showing that filing the same or near-identical question twice:
- updates one durable query page instead of creating two
- preserves a change trail in `changeNotes` or audit log

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/services.test.js tests/e2e.test.js`
Expected: FAIL because repeated `file-answer` / `file-artifact` creates duplicate query pages.

- [ ] **Step 3: Write minimal implementation**

Create `app/services/query-page-service.js` to:
- normalize question/title/slug candidates
- find an existing durable query target by slug/title similarity
- upsert that page with updated answer content
- append merge notes so history stays visible

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/services.test.js tests/e2e.test.js`
Expected: PASS

### Task 4: Harden MongoDB mode for long-running use

**Files:**
- Modify: `app/db/mongo.js`
- Modify: `app/db/repositories.js`
- Modify: `tests/mongo.integration.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Add mongo integration coverage for:
- index creation on startup
- ingest + export consistency through the mongo adapter
- stable lookup paths used by batch ingest and query filing

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mongo.integration.test.js`
Expected: FAIL because indexes / consistency checks are not asserted yet.

- [ ] **Step 3: Write minimal implementation**

Update mongo adapter startup to:
- ensure collection indexes
- keep repository behavior aligned with file mode lookups
- verify export-facing records still round-trip cleanly

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mongo.integration.test.js`
Expected: PASS

### Task 5: Apply repo-level guardrails for generated wiki pages

**Files:**
- Modify: `app/markdown.js`
- Modify: `tests/export.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that exported wiki pages include a top-level generated-file notice.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/export.test.js`
Expected: FAIL because exported pages do not include the notice.

- [ ] **Step 3: Write minimal implementation**

Update wiki page rendering so exported pages start with:

```md
<!-- This file is auto-generated. Edit via mywiki CLI instead. -->
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/export.test.js`
Expected: PASS
