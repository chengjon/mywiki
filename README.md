# MyWiki

`mywiki` is an LLM-driven incremental knowledge base built around the LLM Wiki pattern: immutable raw sources, a maintained Markdown wiki, and explicit agent rules that keep the wiki consistent over time.

The repository is designed for Obsidian browsing, while MongoDB acts as a support engine for query, merge, locate, and export workflows.

Development governance for this repository is defined in [STANDARDS.md](./STANDARDS.md). `AGENTS.md` and other entry documents should be read together with that file rather than duplicating the same rules.

Governance path conventions are stored in `system/governance.json` rather than hardcoded into scattered files, so proposal/spec/plan document locations can evolve without rewriting application logic.
Bootstrap now creates the configured planning directories from that file, and `doctor` validates the configured governance documents and directories explicitly.

## Architecture

- `raw/`: immutable source materials
- `wiki/`: exported Markdown pages for browsing in Obsidian
- `meta/`: index, log, manifests, and lint reports
- `system/`: schemas and prompt helpers
- `app/`: CLI, ingest, export, lint, search, and database support

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Bootstrap the repository:

```bash
node ./bin/mywiki.js doctor
```

3. Ingest a local Markdown file:

```bash
node ./bin/mywiki.js ingest-source --type file --path ./example.md --title "Example"
```

You can also ingest a whole inbox directory sequentially:

```bash
node ./bin/mywiki.js batch-ingest
```

Or point batch ingest at an explicit directory:

```bash
node ./bin/mywiki.js batch-ingest --dir ./imports
```

`batch-ingest` defaults to `--mode incremental`, which skips files already imported from the same local path, only processes new arrivals, and writes a run report to `meta/reports/latest-batch-ingest.md`.

4. Ask against the maintained wiki:

```bash
node ./bin/mywiki.js ask --question "What is Example?"
```

`ask` now returns a structured Markdown-style answer with stable sections such as `Answer`, `Relations`, `Evidence`, or `Sources`, so the result is easier to review and file back into the wiki.

After ingest, the system will also extract lightweight entities, create entity pages in `wiki/entities/`, infer simple typed relations such as `leads` and `works_at`, create topic and concept pages in `wiki/topics/` and `wiki/concepts/`, and use that graph during later `ask` calls.

Repeated ingests on the same topic will update the existing topic and concept pages instead of creating duplicates, so the exported wiki gradually becomes a multi-source synthesis rather than a pile of isolated summaries.

The repository also keeps a generated navigation page at `wiki/overview/mywiki-overview.md`, which is refreshed during ingest and query filing so Obsidian always has a stable landing page.

Filed query pages are also durable: if you ask the same question again, `mywiki` now prefers updating the existing query page instead of creating near-duplicate query files.
If a new question only looks similar to an existing durable query, `mywiki` now stops and asks you to take control with `--slug` instead of auto-merging ambiguously.

You can also compare two maintained wiki pages into a durable comparison memo:

```bash
node ./bin/mywiki.js compare-pages --left openai --right anthropic --title "OpenAI vs Anthropic"
```

This writes a structured page into `wiki/comparisons/` and refreshes the overview, index, and log artifacts.

If a base slug could refer to different page families, you can pin the target page type explicitly:

```bash
node ./bin/mywiki.js compare-pages --left openai --left-type topic --right anthropic --right-type topic --title "OpenAI Topic vs Anthropic Topic"
```

You can also generate a timeline page for an existing wiki page:

```bash
node ./bin/mywiki.js build-timeline --slug openai --title "OpenAI Timeline"
```

This writes a structured page into `wiki/timelines/` using dated source metadata, related pages, and matching audit events.

If you want the repository to decide the artifact type automatically, use:

```bash
node ./bin/mywiki.js file-artifact --question "OpenAI 和 Anthropic 有什么区别？" --title "OpenAI vs Anthropic Auto"
```

Routing is deterministic:
- comparison intent -> `wiki/comparisons/`
- timeline intent -> `wiki/timelines/`
- everything else -> `wiki/queries/`

If you want to bypass routing and force a specific artifact shape, add `--artifact-type`:

```bash
node ./bin/mywiki.js file-artifact --question "请生成比较页" --artifact-type comparison --left openai --left-type topic --right anthropic --right-type topic --title "OpenAI Topic vs Anthropic Topic Auto"
```

```bash
node ./bin/mywiki.js file-artifact --question "随便什么问题都行" --artifact-type timeline --slug openai --title "Explicit OpenAI Timeline"
```

```bash
node ./bin/mywiki.js file-artifact --question "Who is OpenAI?" --artifact-type query --slug openai-manual-query --title "OpenAI Manual Query"
```

Manual override rules:
- `--artifact-type comparison` requires `--left` and `--right`
- `--artifact-type timeline` requires `--slug`
- `--artifact-type query` accepts optional `--slug` for the output page slug
- invalid override combinations are rejected directly instead of being ignored
- without `--artifact-type`, `file-artifact` keeps using automatic routing

Repeated imports of the same exact source content, or repeated imports of the same source URL, now reuse the existing source record instead of creating duplicate source pages.

You can also ingest a web source directly:

```bash
node ./bin/mywiki.js ingest-source --type web --url "https://example.com/article" --title "Example Article"
```

For HTML responses, `mywiki` now performs a lightweight article extraction pass that drops scripts and styles and converts headings, paragraphs, and lists into Markdown-like text before indexing.

## Storage Modes

- `file` (default): stores operational state in `meta/manifests/state.json`
- `mongo`: stores operational state in MongoDB using `MONGODB_URI` and `MONGODB_DB`

Production use should prefer MongoDB. File storage exists so the repository can bootstrap and run locally without a database service.
Mongo mode now creates collection indexes on startup so lookups and long-running use stay stable.

To inspect repository health:

```bash
node ./bin/mywiki.js doctor
```

To compare file-state and mongo-state drift explicitly while using mongo storage:

```bash
node ./bin/mywiki.js doctor --storage mongo --compare-storage
```

To rebuild exported wiki files from the current repository state:

```bash
node ./bin/mywiki.js repair
```

To rebuild exports and prune orphaned wiki files that are no longer backed by repository state:

```bash
node ./bin/mywiki.js repair --prune
```

In mongo mode, `doctor` also checks collection indexes, wiki export drift, and names the missing or extra export files it finds.
With `--compare-storage`, it also reports file-only records, mongo-only records, and stable-field mismatches such as title drift.
In every storage mode, it also reports governance path health for the configured standards, agent rules, README, proposal specs directory, and implementation plans directory.

Example MongoDB session:

```bash
export MYWIKI_STORAGE=mongo
export MONGODB_URI=mongodb://127.0.0.1:27017
export MONGODB_DB=mywiki
node ./bin/mywiki.js doctor
node ./bin/mywiki.js ingest-source --type file --path ./example.md --title "Example"
node ./bin/mywiki.js ask --question "What is Example?"
```

## Commands

- `doctor`
- `repair`
- `ingest-source`
- `batch-ingest`
- `ask`
- `file-artifact`
- `compare-pages`
- `build-timeline`
- `file-answer`
- `lint-wiki`
- `rebuild-overview`
- `rebuild-index`
- `rebuild-log`
- `suggest-gaps`

`lint-wiki` currently checks for structural issues such as missing source backing, isolated concept pages, unintegrated sources, duplicate slugs, and topic/source drift.

## Obsidian Usage

Open this repository in Obsidian and browse primarily through:

- `meta/index.md`
- `wiki/overview/`
- `wiki/sources/`
- `wiki/entities/`
- `wiki/concepts/`
- `wiki/topics/`

The CLI exports stable Markdown files with frontmatter and wiki links so the graph view remains useful as the wiki grows.
Files under `wiki/` are auto-generated and should be edited through `mywiki` commands, not by hand.
