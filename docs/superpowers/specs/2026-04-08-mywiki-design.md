# MyWiki Design

Date: 2026-04-08
Status: Approved for spec review

## Goal

Build `mywiki` as an LLM-driven incremental knowledge system for Obsidian-style Markdown browsing.

The system should:

- preserve immutable raw sources
- maintain a persistent wiki that compounds over time
- use explicit schema rules so the agent behaves like a disciplined wiki maintainer
- support query, merge, and locate workflows with MongoDB as a support engine

The system should not behave like a traditional RAG stack that re-derives everything from raw chunks on each question.

## Core Principles

### Three-layer model

`mywiki` follows the LLM Wiki pattern:

1. Raw source layer
   - immutable source materials such as web articles, files, notes, transcripts, and assets
2. Wiki layer
   - LLM-maintained Markdown pages containing summaries, entity pages, concept pages, syntheses, comparisons, timelines, and query memos
3. Schema layer
   - repository rules, workflows, and page conventions defined in `AGENTS.md` and supporting config

MongoDB is not an external fourth layer. It is internal infrastructure that supports the wiki layer.

### Incremental maintenance

When a new source is ingested, the system should not only index it. It should:

- register the source
- extract text and chunks
- generate or update a source summary page
- identify affected entities, concepts, and topics
- update existing wiki pages where appropriate
- create new pages only when justified
- add or improve cross-references
- note conflicts, uncertainty, or version drift
- update index and log artifacts

### Human/LLM division of labor

Humans are responsible for:

- choosing sources
- asking good questions
- setting priorities
- reviewing important conclusions

The agent is responsible for:

- summarization
- filing
- linking
- updating
- contradiction marking
- linting
- answer filing

## Storage Model

### Source of truth

Operational source of truth is split by concern:

- raw source files remain in the filesystem under `raw/`
- structured operational records live in MongoDB
- exported Markdown in `wiki/` is the primary human-readable knowledge product

The agent should not freely hand-edit generated Markdown outside the defined workflows. Changes should flow through the application layer and then export back to `wiki/`.

### MongoDB role

MongoDB exists to support:

- source registration
- chunk indexing
- entity normalization and merge candidates
- relation tracking
- backlink generation
- lint analysis
- targeted export
- fast lookup for query and maintenance operations

MongoDB should not replace the wiki as the primary reading surface.

## Repository Structure

```text
mywiki/
├─ AGENTS.md
├─ README.md
├─ raw/
│  ├─ inbox/
│  ├─ web/
│  ├─ files/
│  ├─ notes/
│  └─ assets/
├─ wiki/
│  ├─ overview/
│  ├─ sources/
│  ├─ entities/
│  ├─ concepts/
│  ├─ topics/
│  ├─ comparisons/
│  ├─ timelines/
│  └─ queries/
├─ meta/
│  ├─ index.md
│  ├─ log.md
│  ├─ reports/
│  ├─ manifests/
│  └─ templates/
├─ system/
│  ├─ prompts/
│  ├─ schemas/
│  └─ exports/
└─ app/
   ├─ cli/
   ├─ ingest/
   ├─ search/
   ├─ lint/
   ├─ export/
   └─ db/
```

## Wiki Page Types

The first version supports these page families:

- `overview`
- `sources`
- `entities`
- `concepts`
- `topics`
- `comparisons`
- `timelines`
- `queries`

### Page responsibilities

- `overview`: top-level navigation pages
- `sources`: one page per ingested source with summary and impact notes
- `entities`: people, organizations, projects, tools, places, documents
- `concepts`: definitions, mechanisms, boundaries, and disputes
- `topics`: multi-source synthesis pages
- `comparisons`: structured side-by-side analysis
- `timelines`: event or version evolution over time
- `queries`: high-value question-and-answer memos worth preserving

## Naming and Frontmatter

All page files should use stable slug filenames. Human-readable titles live in frontmatter and page content.

Example:

- `wiki/concepts/in-context-learning.md`
- `wiki/entities/openai.md`
- `wiki/comparisons/rag-vs-llm-wiki.md`

Minimum frontmatter:

```yaml
---
page_id: pg_xxx
title: In-Context Learning
slug: in-context-learning
type: concept
status: active
tags: [llm, prompting]
source_ids: [src_xxx, src_yyy]
entity_ids: [ent_xxx]
updated_at: 2026-04-08
created_at: 2026-04-08
confidence: medium
---
```

Optional fields:

- `aliases`
- `summary`
- `related_page_ids`
- `canonical_entity_id`
- `supersedes`
- `superseded_by`

## Page Layout

Wiki pages should follow a stable section order where relevant:

1. `Summary`
2. `Key Points`
3. `Details`
4. `Related`
5. `Sources`
6. `Open Questions`
7. `Change Notes`

Not every page type needs every section, but section ordering should remain stable.

Internal links should use Obsidian-friendly wiki links, such as `[[openai]]` and `[[in-context-learning]]`.

## Data Model

The initial MongoDB collections are:

- `sources`
- `source_chunks`
- `pages`
- `entities`
- `relations`
- `queries`
- `jobs`
- `audit_log`

### Collection purposes

- `sources`: source metadata and raw extraction records
- `source_chunks`: chunk-level searchable text and positions
- `pages`: logical wiki page records exported into Markdown
- `entities`: normalized objects and aliases
- `relations`: page/entity relationships with evidence
- `queries`: saved answers and filing candidates
- `jobs`: ingest, export, lint, and rebuild jobs
- `audit_log`: append-only activity history

## Workflows

### Ingest

When a user asks to process a source, the system should:

1. classify the source
2. register source metadata
3. extract text and attachments
4. create chunks
5. generate or update a source summary page
6. identify affected entities, concepts, and topics
7. update existing pages before creating redundant new ones
8. add cross-references and citations
9. mark conflicts or uncertainty where needed
10. update `meta/index.md`
11. append `meta/log.md`

Ingest is complete only when the wiki has been integrated, not merely when the source is stored.

### Query

When answering questions, the agent should:

1. read `meta/index.md` first
2. consult relevant `wiki/` pages
3. consult source chunks only when the wiki is insufficient
4. answer with citations where possible
5. suggest filing the answer if it has durable value

### Lint

Lint should check for:

- orphan pages
- duplicate or overlapping pages
- unsupported claims lacking sources
- stale content without version context
- important unlinked concepts
- mentioned-but-missing entities
- export/database mismatch
- recently added sources not reflected in key topic pages

### Export

Database-backed page records should export into stable Markdown files in `wiki/`.

Export should:

- preserve stable slug paths
- preserve stable frontmatter shape
- avoid rewriting unchanged files
- update only affected pages where possible

## CLI Surface

The first version should expose workflows rather than low-level CRUD commands.

Recommended commands:

- `ingest-source`
- `ask`
- `file-answer`
- `lint-wiki`
- `rebuild-index`
- `rebuild-log`
- `suggest-gaps`
- `doctor`

## AGENTS.md Rules

`AGENTS.md` must explicitly define:

- the system goal
- writable and read-only boundaries
- ingest completion criteria
- query priority order
- page creation versus page update rules
- contradiction and uncertainty handling
- link and navigation requirements
- lint requirements
- human versus agent responsibility boundaries
- writing style expectations

The agent should optimize for durable knowledge assets, not chat-style answers.

## Non-goals for Version 1

The first version does not need:

- a full web UI
- multi-user permissions
- dual-primary editing between Markdown and MongoDB
- advanced authenticated web scraping
- mandatory vector search
- graph visualization beyond what Obsidian already provides

## Implementation Direction

The implementation should use:

- Node.js for CLI and orchestration
- MongoDB for the support engine
- Markdown export for the primary reading surface
- Obsidian-compatible linking and frontmatter

Version 1 should focus on a minimal but working end-to-end flow:

1. add source
2. ingest source
3. update wiki pages
4. rebuild index and log
5. ask question against the maintained wiki
6. optionally file a durable answer page
