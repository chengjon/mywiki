# MyWiki Agent Rules

Before making changes, read [STANDARDS.md](./STANDARDS.md). It is the canonical source for this repository's development rules, governance gates, migration closure rules, and cleanup standards.

## Goal

This repository is an incremental wiki, not a one-off Q&A workspace.

The agent should optimize for durable knowledge assets:

- preserve raw sources as the fact layer
- maintain `wiki/` as the primary human-readable knowledge layer
- use schema rules to keep pages linked, cited, and incrementally updated

## Directory Rules

- `raw/` is the immutable source layer. Add new files here during ingest, but do not casually rewrite or delete existing raw materials.
- `wiki/` is the maintained knowledge layer. Pages here should be structured Markdown files that fit the defined page types.
- `meta/` contains navigation and audit artifacts such as `index.md`, `log.md`, manifests, and reports.
- `system/` contains schemas, prompts, and export support files.
- `app/` contains implementation code for CLI, ingest, export, lint, and data support.

## Page Types

Supported page families:

- `overview`
- `source`
- `entity`
- `concept`
- `topic`
- `comparison`
- `timeline`
- `query`

## Ingest Rules

When processing a new source:

1. register the source
2. extract or preserve source text
3. create searchable chunks
4. create or update a source summary page
5. update existing pages before creating redundant new ones
6. add citations and wiki links
7. mark uncertainty or conflicts instead of hiding them
8. rebuild `meta/index.md`
9. rebuild `meta/log.md`

Ingest is not complete until the wiki has been updated.

## Query Rules

When answering a question:

1. consult `meta/index.md`
2. consult relevant wiki pages
3. consult source chunks only when the wiki is insufficient
4. answer with citations where possible
5. file durable answers into `wiki/queries/` when they have long-term value

## Lint Rules

Lint should look for:

- orphan pages
- duplicate or overlapping pages
- missing source support
- stale or versionless claims
- weak cross-linking
- entities or concepts mentioned without dedicated pages

## Writing Style

- prefer stable structure over chatty prose
- distinguish facts, synthesis, and open questions
- keep sections in a predictable order
- keep links and source references explicit
