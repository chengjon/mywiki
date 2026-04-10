import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';

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

test('ask uses extracted entities after ingest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'people.md');
  const chunks = [];
  const stdout = {
    write(value) {
      chunks.push(String(value));
    }
  };

  await writeFile(file, '# OpenAI\n\nSam Altman leads OpenAI.', 'utf8');
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'People Notes'], { stdout });

  chunks.length = 0;
  await runCli(['ask', '--root', root, '--question', 'Who is Sam Altman?'], { stdout });

  const output = chunks.join('');
  assert.match(output, /## Answer/);
  assert.match(output, /## Relations/);
  assert.match(output, /## Evidence/);
  assert.match(output, /Sam Altman/);
  assert.match(output, /leads OpenAI/);
});

test('ingest-source exports topic and concept pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'concepts.md');
  await writeFile(file, '# Agent Memory\n\nIn-context learning improves prompting quality.\n\nRetrieval augmentation helps grounding.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'Agent Memory Notes']);

  const topicPage = await readFile(path.join(root, 'wiki', 'topics', 'agent-memory.md'), 'utf8');
  const conceptPage = await readFile(path.join(root, 'wiki', 'concepts', 'in-context-learning.md'), 'utf8');

  assert.match(topicPage, /# Agent Memory/);
  assert.match(conceptPage, /# In-Context Learning/);
});

test('ingest-source can fetch and ingest a web url', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('# Web Agents\n\nTool use improves agent memory.\n\nRetrieval augmentation helps grounding.');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/wiki`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', url, '--title', 'Web Agents']);

    const rawWeb = await readFile(path.join(root, 'raw', 'web', 'web-agents.md'), 'utf8');
    const sourcePage = await readFile(path.join(root, 'wiki', 'sources', 'web-agents.md'), 'utf8');
    const topicPage = await readFile(path.join(root, 'wiki', 'topics', 'web-agents-topic.md'), 'utf8');

    assert.match(rawWeb, /Source URL:/);
    assert.match(rawWeb, /Tool use improves agent memory/);
    assert.match(sourcePage, /# Web Agents/);
    assert.match(topicPage, /# Web Agents/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('batch-ingest scans raw inbox sequentially and refreshes navigation artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await runCli(['doctor', '--root', root], { stdout });
  await writeFile(path.join(root, 'raw', 'inbox', '01-anthropic-notes.md'), '# Anthropic\n\nAnthropic builds Claude.', 'utf8');
  await writeFile(path.join(root, 'raw', 'inbox', '02-openai-notes.md'), '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  const batchOutput = stdoutChunks.join('');
  const anthropicPage = await readFile(path.join(root, 'wiki', 'sources', '01-anthropic-notes.md'), 'utf8');
  const openaiPage = await readFile(path.join(root, 'wiki', 'sources', '02-openai-notes.md'), 'utf8');
  const indexPage = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');
  const overviewPage = await readFile(path.join(root, 'wiki', 'overview', 'mywiki-overview.md'), 'utf8');
  const reportPage = await readFile(path.join(root, 'meta', 'reports', 'latest-batch-ingest.md'), 'utf8');

  assert.match(batchOutput, /Processed 2 source files/i);
  assert.ok(batchOutput.indexOf('01-anthropic-notes.md') < batchOutput.indexOf('02-openai-notes.md'));
  assert.match(anthropicPage, /# 01-anthropic-notes/);
  assert.match(openaiPage, /# 02-openai-notes/);
  assert.match(indexPage, /\[\[01-anthropic-notes\]\]/);
  assert.match(indexPage, /\[\[02-openai-notes\]\]/);
  assert.match(logPage, /ingest \| 01-anthropic-notes/i);
  assert.match(logPage, /ingest \| 02-openai-notes/i);
  assert.match(overviewPage, /\[\[01-anthropic-notes\]\]/);
  assert.match(overviewPage, /\[\[02-openai-notes\]\]/);
  assert.match(reportPage, /# Batch Ingest Report/);
  assert.match(reportPage, /Mode: incremental/);
  assert.match(reportPage, /Processed: 2/);
  assert.match(reportPage, /Skipped: 0/);
  assert.match(reportPage, /Failed: 0/);
});

test('batch-ingest incremental mode skips imported files and only processes new arrivals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await runCli(['doctor', '--root', root], { stdout });
  await writeFile(path.join(root, 'raw', 'inbox', '01-openai-notes.md'), '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  await writeFile(path.join(root, 'raw', 'inbox', '02-anthropic-notes.md'), '# Anthropic\n\nAnthropic builds Claude.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  const batchOutput = stdoutChunks.join('');
  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const reportPage = await readFile(path.join(root, 'meta', 'reports', 'latest-batch-ingest.md'), 'utf8');

  assert.match(batchOutput, /Processed 1 source files/i);
  assert.match(batchOutput, /Skipped 1 source files/i);
  assert.ok(batchOutput.indexOf('SKIP 01-openai-notes.md') < batchOutput.indexOf('OK 02-anthropic-notes.md'));
  assert.equal(state.sources.length, 2);
  assert.match(reportPage, /Processed: 1/);
  assert.match(reportPage, /Skipped: 1/);
  assert.match(reportPage, /Failed: 0/);
  assert.match(reportPage, /already imported from local path/i);
});

test('batch-ingest incremental mode skips renamed files when source content was already imported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await runCli(['doctor', '--root', root], { stdout });
  await writeFile(path.join(root, 'raw', 'inbox', '01-openai-notes.md'), '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  await writeFile(path.join(root, 'raw', 'inbox', '02-openai-notes-renamed.md'), '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  const batchOutput = stdoutChunks.join('');
  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const reportPage = await readFile(path.join(root, 'meta', 'reports', 'latest-batch-ingest.md'), 'utf8');

  assert.match(batchOutput, /Processed 0 source files/i);
  assert.match(batchOutput, /Skipped 2 source files/i);
  assert.match(batchOutput, /SKIP 02-openai-notes-renamed\.md \| duplicate content already imported/i);
  assert.equal(state.sources.length, 1);
  assert.match(reportPage, /Processed: 0/);
  assert.match(reportPage, /Skipped: 2/);
  assert.match(reportPage, /duplicate content already imported/i);
});

test('batch-ingest incremental mode reprocesses an already imported path when file content changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await runCli(['doctor', '--root', root], { stdout });
  const filePath = path.join(root, 'raw', 'inbox', '01-openai-notes.md');
  await writeFile(filePath, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  await writeFile(filePath, '# OpenAI\n\nOpenAI builds ChatGPT.\n\nOpenAI also offers APIs.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  const batchOutput = stdoutChunks.join('');
  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const sourcePage = await readFile(path.join(root, 'wiki', 'sources', '01-openai-notes.md'), 'utf8');
  const reportPage = await readFile(path.join(root, 'meta', 'reports', 'latest-batch-ingest.md'), 'utf8');

  assert.match(batchOutput, /Processed 1 source files/i);
  assert.match(batchOutput, /Skipped 0 source files/i);
  assert.match(batchOutput, /OK 01-openai-notes\.md -> \[\[01-openai-notes\]\]/i);
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].metadata.contentDrift, true);
  assert.match(sourcePage, /Content drift detected: yes/);
  assert.match(sourcePage, /Observed versions: 2/);
  assert.match(reportPage, /Processed: 1/);
  assert.match(reportPage, /Skipped: 0/);
});

test('batch-ingest remembers renamed duplicate paths and reingests later changes into the same source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await runCli(['doctor', '--root', root], { stdout });
  const firstPath = path.join(root, 'raw', 'inbox', '01-openai-notes.md');
  const renamedPath = path.join(root, 'raw', 'inbox', '02-openai-notes-renamed.md');
  await writeFile(firstPath, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  await writeFile(renamedPath, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');
  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  await writeFile(renamedPath, '# OpenAI\n\nOpenAI builds ChatGPT.\n\nOpenAI also offers APIs.', 'utf8');
  stdoutChunks.length = 0;
  await runCli(['batch-ingest', '--root', root], { stdout });

  const batchOutput = stdoutChunks.join('');
  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const source = state.sources[0];
  const sourcePage = await readFile(path.join(root, 'wiki', 'sources', '01-openai-notes.md'), 'utf8');

  assert.match(batchOutput, /Processed 1 source files/i);
  assert.match(batchOutput, /OK 02-openai-notes-renamed\.md -> \[\[01-openai-notes\]\]/i);
  assert.equal(state.sources.length, 1);
  assert.equal(source.localPath, renamedPath);
  assert.equal(source.metadata.lastSeenLocalPath, renamedPath);
  assert.deepEqual(
    source.metadata.localPathHistory,
    [firstPath, renamedPath]
  );
  assert.equal(source.metadata.contentDrift, true);
  assert.match(sourcePage, /Content drift detected: yes/);
});

test('doctor honors governance config overrides and reports missing governance targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: 'docs/project-standards.md',
        agentRules: 'governance/agent-rules.md',
        readme: 'docs/project-readme.md'
      },
      paths: {
        proposalSpecsDir: 'governance/specs',
        implementationPlansDir: 'governance/plans'
      }
    }, null, 2),
    'utf8'
  );
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'project-standards.md'), '# Project Standards\n', 'utf8');

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Standards document: docs\/project-standards\.md \(ok\)/);
  assert.match(doctorOutput, /Agent rules document: governance\/agent-rules\.md \(missing\)/);
  assert.match(doctorOutput, /README document: docs\/project-readme\.md \(missing\)/);
  assert.match(doctorOutput, /Proposal specs dir: governance\/specs \(ok\)/);
  assert.match(doctorOutput, /Implementation plans dir: governance\/plans \(ok\)/);
  assert.match(doctorOutput, /Governance issues: 2/);
});

test('doctor reports invalid governance config json and falls back to defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(path.join(root, 'system', 'governance.json'), '{ invalid json', 'utf8');

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: invalid json/i);
  assert.match(doctorOutput, /Standards document: STANDARDS\.md \(missing\)/);
  assert.match(doctorOutput, /Proposal specs dir: docs\/superpowers\/specs \(ok\)/);
});

test('doctor reports governance schema issues for blank or missing configured paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: '',
        readme: 'docs/project-readme.md'
      },
      paths: {
        proposalSpecsDir: '',
        implementationPlansDir: 'governance/plans'
      }
    }, null, 2),
    'utf8'
  );

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: schema issues detected/i);
  assert.match(doctorOutput, /Governance config issues:/i);
  assert.match(doctorOutput, /documents\.standards/i);
  assert.match(doctorOutput, /documents\.agentRules/i);
  assert.match(doctorOutput, /paths\.proposalSpecsDir/i);
  assert.match(doctorOutput, /Standards document: STANDARDS\.md \(missing, defaulted\)/);
  assert.match(doctorOutput, /Agent rules document: AGENTS\.md \(missing, defaulted\)/);
  assert.match(doctorOutput, /Proposal specs dir: docs\/superpowers\/specs \(ok, defaulted\)/);
  assert.match(doctorOutput, /Implementation plans dir: governance\/plans \(ok\)/);
});

test('doctor counts governance config fallback issues even when fallback targets exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: '',
        agentRules: 'AGENTS.md',
        readme: 'README.md'
      },
      paths: {
        proposalSpecsDir: 'docs/superpowers/specs',
        implementationPlansDir: 'docs/superpowers/plans'
      }
    }, null, 2),
    'utf8'
  );
  await writeFile(path.join(root, 'STANDARDS.md'), '# Standards\n', 'utf8');
  await writeFile(path.join(root, 'AGENTS.md'), '# Agent Rules\n', 'utf8');
  await writeFile(path.join(root, 'README.md'), '# Readme\n', 'utf8');

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: schema issues detected/i);
  assert.match(doctorOutput, /Governance issues: 1/);
  assert.match(doctorOutput, /Standards document: STANDARDS\.md \(ok, defaulted\)/);
});

test('doctor reports unknown governance config keys instead of silently ignoring them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: 'STANDARDS.md',
        standardz: 'docs/typo.md'
      },
      paths: {
        proposalSpecsDir: 'docs/superpowers/specs',
        implementationPlanDir: 'docs/typo-plans'
      },
      extraSection: {
        enabled: true
      }
    }, null, 2),
    'utf8'
  );
  await writeFile(path.join(root, 'STANDARDS.md'), '# Standards\n', 'utf8');

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: schema issues detected/i);
  assert.match(doctorOutput, /Governance config issues:/i);
  assert.match(doctorOutput, /documents\.standardz/i);
  assert.match(doctorOutput, /paths\.implementationPlanDir/i);
  assert.match(doctorOutput, /extraSection/i);
});

test('doctor rejects absolute governance paths and falls back to repo-local defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: '/etc/passwd'
      },
      paths: {
        proposalSpecsDir: '/tmp/mywiki-outside-specs'
      }
    }, null, 2),
    'utf8'
  );

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: schema issues detected/i);
  assert.match(doctorOutput, /documents\.standards/i);
  assert.match(doctorOutput, /paths\.proposalSpecsDir/i);
  assert.match(doctorOutput, /Standards document: STANDARDS\.md \(missing, defaulted\)/);
  assert.match(doctorOutput, /Proposal specs dir: docs\/superpowers\/specs \(ok, defaulted\)/);
});

test('doctor rejects governance paths that escape the repository with dot segments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        readme: '../outside-readme.md'
      },
      paths: {
        implementationPlansDir: '../../external-plans'
      }
    }, null, 2),
    'utf8'
  );

  await runCli(['doctor', '--root', root], { stdout });

  const doctorOutput = stdoutChunks.join('');
  assert.match(doctorOutput, /Governance config: schema issues detected/i);
  assert.match(doctorOutput, /documents\.readme/i);
  assert.match(doctorOutput, /paths\.implementationPlansDir/i);
  assert.match(doctorOutput, /README document: README\.md \(missing, defaulted\)/);
  assert.match(doctorOutput, /Implementation plans dir: docs\/superpowers\/plans \(ok, defaulted\)/);
});

test('lint-wiki writes a report with knowledge health findings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'source.md');
  await writeFile(file, '# Drift Notes\n\nIn-context learning improves prompting quality.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'Drift Notes']);
  const statePath = path.join(root, 'meta', 'manifests', 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const topicPage = state.pages.find((page) => page.type === 'topic' && page.slug === 'drift-notes-topic');
  topicPage.sourceIds = [];
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  await runCli(['lint-wiki', '--root', root]);

  const report = await readFile(path.join(root, 'meta', 'reports', 'latest-lint.md'), 'utf8');
  assert.match(report, /Lint Report/);
  assert.match(report, /topic-source-drift/);
});

test('later ingests update exported topic synthesis pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const firstFile = path.join(root, 'first.md');
  const secondFile = path.join(root, 'second.md');

  await writeFile(firstFile, '# Agent Memory\n\nIn-context learning improves prompting quality.', 'utf8');
  await writeFile(secondFile, '# Agent Memory\n\nRetrieval augmentation improves grounding.\n\nIn-context learning benefits from better examples.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', firstFile, '--title', 'Agent Memory Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', secondFile, '--title', 'Agent Memory Article']);

  const topicPage = await readFile(path.join(root, 'wiki', 'topics', 'agent-memory.md'), 'utf8');
  const conceptPage = await readFile(path.join(root, 'wiki', 'concepts', 'in-context-learning.md'), 'utf8');

  assert.match(topicPage, /2 sources/);
  assert.match(topicPage, /Retrieval Augmentation/);
  assert.match(conceptPage, /2 sources/);
});

test('conflicting entity relations are exported into entity and topic open questions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const firstFile = path.join(root, 'career-a.md');
  const secondFile = path.join(root, 'career-b.md');

  await writeFile(firstFile, '# OpenAI\n\nSam Altman works for OpenAI.', 'utf8');
  await writeFile(secondFile, '# OpenAI\n\nSam Altman works for Anthropic.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', firstFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', secondFile, '--title', 'OpenAI Career Update']);

  const entityPage = await readFile(path.join(root, 'wiki', 'entities', 'sam-altman.md'), 'utf8');
  const topicPage = await readFile(path.join(root, 'wiki', 'topics', 'openai-topic.md'), 'utf8');

  assert.match(entityPage, /## Open Questions/);
  assert.match(entityPage, /Sam Altman/);
  assert.match(entityPage, /works_at/);
  assert.match(entityPage, /Anthropic/);
  assert.match(topicPage, /## Open Questions/);
  assert.match(topicPage, /Sam Altman/);
  assert.match(topicPage, /works_at/);
});

test('ask and file-answer surface conflict open questions for entity queries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const firstFile = path.join(root, 'career-a.md');
  const secondFile = path.join(root, 'career-b.md');
  const chunks = [];
  const stdout = {
    write(value) {
      chunks.push(String(value));
    }
  };

  await writeFile(firstFile, '# OpenAI\n\nSam Altman works for OpenAI.', 'utf8');
  await writeFile(secondFile, '# OpenAI\n\nSam Altman works for Anthropic.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', firstFile, '--title', 'OpenAI Notes'], { stdout });
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', secondFile, '--title', 'OpenAI Career Update'], { stdout });

  chunks.length = 0;
  await runCli(['ask', '--root', root, '--question', 'Who is Sam Altman?'], { stdout });
  const askOutput = chunks.join('');
  assert.match(askOutput, /unresolved conflicts/i);
  assert.match(askOutput, /## Open Questions/);
  assert.match(askOutput, /Anthropic/);
  assert.match(askOutput, /OpenAI/);

  await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Conflict Query'], { stdout });
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-conflict-query.md'), 'utf8');
  assert.match(queryPage, /unresolved conflicts/i);
  assert.match(queryPage, /## Open Questions/);
  assert.match(queryPage, /multiple works_at targets/);
});

test('ask and file-answer prefer newer web evidence when conflicts remain unresolved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/older')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
      <html>
        <head>
          <title>Older Career Note</title>
          <meta property="article:published_time" content="2026-04-01T10:00:00Z" />
          <link rel="canonical" href="https://example.com/older-career-note" />
        </head>
        <body>
          <article>
            <h1>OpenAI Career Note</h1>
            <p>Sam Altman works for OpenAI.</p>
          </article>
        </body>
      </html>`);
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
    <html>
      <head>
        <title>Newer Career Note</title>
        <meta name="author" content="Jane Doe" />
        <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
        <link rel="canonical" href="https://example.com/newer-career-note" />
      </head>
      <body>
        <article>
          <h1>OpenAI Career Note</h1>
          <p>Sam Altman works for Anthropic.</p>
        </article>
      </body>
    </html>`);
  });
  const chunks = [];
  const stdout = {
    write(value) {
      chunks.push(String(value));
    }
  };

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const olderUrl = `http://127.0.0.1:${address.port}/older`;
  const newerUrl = `http://127.0.0.1:${address.port}/newer`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', olderUrl, '--title', 'Older Career Note'], { stdout });
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', newerUrl, '--title', 'Newer Career Note'], { stdout });

    chunks.length = 0;
    await runCli(['ask', '--root', root, '--question', 'Who is Sam Altman?'], { stdout });
    const askOutput = chunks.join('');
    assert.match(askOutput, /leans toward Anthropic/i);
    assert.match(askOutput, /newer/i);

    await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Preferred Conflict Query'], { stdout });
    const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-preferred-conflict-query.md'), 'utf8');
    assert.match(queryPage, /leans toward Anthropic/i);
    assert.match(queryPage, /newer/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('repository preference file can change conflict prioritization strategy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/richer')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
      <html>
        <head>
          <title>Richer Career Note</title>
          <meta name="author" content="Jane Doe" />
          <meta property="article:published_time" content="2026-04-01T10:00:00Z" />
          <link rel="canonical" href="https://example.com/richer-career-note" />
        </head>
        <body>
          <article>
            <h1>OpenAI Career Note</h1>
            <p>Sam Altman works for OpenAI.</p>
          </article>
        </body>
      </html>`);
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
    <html>
      <head>
        <title>Newer Career Note</title>
        <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
        <link rel="canonical" href="https://example.com/newer-career-note" />
      </head>
      <body>
        <article>
          <h1>OpenAI Career Note</h1>
          <p>Sam Altman works for Anthropic.</p>
        </article>
      </body>
    </html>`);
  });
  const chunks = [];
  const stdout = {
    write(value) {
      chunks.push(String(value));
    }
  };

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const richerUrl = `http://127.0.0.1:${address.port}/richer`;
  const newerUrl = `http://127.0.0.1:${address.port}/newer`;

  try {
    await runCli(['doctor', '--root', root], { stdout });
    await writeFile(
      path.join(root, 'system', 'preferences.json'),
      JSON.stringify({
        conflictResolution: {
          order: ['metadataCompleteness', 'publishedAt']
        }
      }, null, 2),
      'utf8'
    );

    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', richerUrl, '--title', 'Richer Career Note'], { stdout });
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', newerUrl, '--title', 'Newer Career Note'], { stdout });

    chunks.length = 0;
    await runCli(['ask', '--root', root, '--question', 'Who is Sam Altman?'], { stdout });
    const askOutput = chunks.join('');
    assert.match(askOutput, /leans toward OpenAI/i);
    assert.match(askOutput, /richer source metadata/i);

    await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Configured Conflict Query'], { stdout });
    const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-configured-conflict-query.md'), 'utf8');
    assert.match(queryPage, /leans toward OpenAI/i);
    assert.match(queryPage, /richer source metadata/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('repository preference file can prioritize source types over fresher web metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
    <html>
      <head>
        <title>Fresh Web Story</title>
        <meta name="author" content="Jane Doe" />
        <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
        <link rel="canonical" href="https://example.com/fresh-web-story" />
      </head>
      <body>
        <article>
          <h1>Fresh Web Story</h1>
          <p>Sam Altman works for Anthropic.</p>
        </article>
      </body>
    </html>`);
  });
  const chunks = [];
  const stdout = {
    write(value) {
      chunks.push(String(value));
    }
  };

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const webUrl = `http://127.0.0.1:${address.port}/fresh`;

  try {
    await runCli(['doctor', '--root', root], { stdout });
    await writeFile(
      path.join(root, 'system', 'preferences.json'),
      JSON.stringify({
        conflictResolution: {
          order: ['sourceTypeWeight', 'publishedAt', 'metadataCompleteness'],
          sourceTypeWeights: {
            note: 50,
            web: 10
          }
        }
      }, null, 2),
      'utf8'
    );

    await runCli([
      'ingest-source',
      '--root',
      root,
      '--type',
      'note',
      '--title',
      'Trusted Note',
      '--text',
      'Sam Altman works for OpenAI.'
    ], { stdout });
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', webUrl, '--title', 'Fresh Web Story'], { stdout });

    chunks.length = 0;
    await runCli(['ask', '--root', root, '--question', 'Who is Sam Altman?'], { stdout });
    const askOutput = chunks.join('');
    assert.match(askOutput, /leans toward OpenAI/i);
    assert.match(askOutput, /note sources are ranked above web/i);

    await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Source Type Preference Query'], { stdout });
    const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-source-type-preference-query.md'), 'utf8');
    assert.match(queryPage, /leans toward OpenAI/i);
    assert.match(queryPage, /note sources are ranked above web/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('file-answer converts structured ask output into a readable query page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'people.md');
  await writeFile(file, '# OpenAI\n\nSam Altman leads OpenAI.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'People Notes']);
  await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Query']);

  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-query.md'), 'utf8');

  assert.match(queryPage, /# Sam Altman Query/);
  assert.match(queryPage, /## Summary/);
  assert.match(queryPage, /Sam Altman is a person/);
  assert.match(queryPage, /## Key Points/);
  assert.match(queryPage, /Sam Altman leads OpenAI/);
  assert.match(queryPage, /## Details/);
  assert.match(queryPage, /Question: Who is Sam Altman\?/);
  assert.doesNotMatch(queryPage, /## Answer/);
});

test('file-answer preserves source metadata in filed query details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const html = `<!doctype html>
  <html>
    <head>
      <title>Metadata Query Article</title>
      <meta name="author" content="Jane Doe" />
      <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
      <link rel="canonical" href="https://example.com/metadata-query-article" />
    </head>
    <body>
      <article>
        <h1>OpenAI Update</h1>
        <p>Sam Altman leads OpenAI.</p>
      </article>
    </body>
  </html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/query-meta`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', url, '--title', 'Metadata Query Article']);
    await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Metadata Query']);

    const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'sam-altman-metadata-query.md'), 'utf8');
    assert.match(queryPage, /Jane Doe/);
    assert.match(queryPage, /127\.0\.0\.1/);
    assert.match(queryPage, /2026-04-08T10:00:00Z/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ingest and filed answers keep the overview page updated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const file = path.join(root, 'people.md');
  await writeFile(file, '# OpenAI\n\nSam Altman leads OpenAI.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', file, '--title', 'People Notes']);
  await runCli(['file-answer', '--root', root, '--question', 'Who is Sam Altman?', '--title', 'Sam Altman Query']);

  const overviewPage = await readFile(path.join(root, 'wiki', 'overview', 'mywiki-overview.md'), 'utf8');

  assert.match(overviewPage, /# MyWiki Overview/);
  assert.match(overviewPage, /\[\[people-notes\]\]/);
  assert.match(overviewPage, /\[\[sam-altman\]\]/);
  assert.match(overviewPage, /\[\[openai\]\]/);
  assert.match(overviewPage, /\[\[sam-altman-query\]\]/);
});

test('compare-pages creates a comparison page and refreshes navigation artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  const anthropicFile = path.join(root, 'anthropic.md');

  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', anthropicFile, '--title', 'Anthropic Notes']);
  await runCli(['compare-pages', '--root', root, '--left', 'openai', '--right', 'anthropic', '--title', 'OpenAI vs Anthropic']);

  const comparisonPage = await readFile(path.join(root, 'wiki', 'comparisons', 'openai-vs-anthropic.md'), 'utf8');
  const overviewPage = await readFile(path.join(root, 'wiki', 'overview', 'mywiki-overview.md'), 'utf8');
  const indexPage = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');

  assert.match(comparisonPage, /# OpenAI vs Anthropic/);
  assert.match(comparisonPage, /## Summary/);
  assert.match(comparisonPage, /## Details/);
  assert.match(comparisonPage, /### Overlap/);
  assert.match(comparisonPage, /\[\[openai\]\]/);
  assert.match(comparisonPage, /\[\[anthropic\]\]/);
  assert.match(overviewPage, /\[\[openai-vs-anthropic\]\]/);
  assert.match(indexPage, /## Comparisons/);
  assert.match(indexPage, /\[\[openai-vs-anthropic\]\]/);
  assert.match(logPage, /comparison \| OpenAI vs Anthropic/i);
});

test('compare-pages supports explicit left and right page types', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  const anthropicFile = path.join(root, 'anthropic.md');

  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', anthropicFile, '--title', 'Anthropic Notes']);
  await runCli([
    'compare-pages',
    '--root', root,
    '--left', 'openai',
    '--left-type', 'topic',
    '--right', 'anthropic',
    '--right-type', 'topic',
    '--title', 'OpenAI Topic vs Anthropic Topic'
  ]);

  const comparisonPage = await readFile(path.join(root, 'wiki', 'comparisons', 'openai-topic-vs-anthropic-topic.md'), 'utf8');

  assert.match(comparisonPage, /# OpenAI Topic vs Anthropic Topic/);
  assert.match(comparisonPage, /\[\[openai-topic\]\]/);
  assert.match(comparisonPage, /\[\[anthropic-topic\]\]/);
  assert.match(comparisonPage, /Shared Related Pages:/);
  assert.match(comparisonPage, /\[\[api\]\]/);
});

test('build-timeline creates a timeline page and refreshes navigation artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const html = `<!doctype html>
  <html>
    <head>
      <title>OpenAI Timeline Article</title>
      <meta name="author" content="Jane Doe" />
      <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
      <link rel="canonical" href="https://example.com/openai-timeline-article" />
    </head>
    <body>
      <article>
        <h1>OpenAI</h1>
        <p>OpenAI builds ChatGPT and an API platform.</p>
      </article>
    </body>
  </html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/timeline`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', url, '--title', 'OpenAI Timeline Article']);
    await runCli(['file-answer', '--root', root, '--question', 'What is OpenAI?', '--title', 'OpenAI Query']);
    await runCli(['build-timeline', '--root', root, '--slug', 'openai', '--title', 'OpenAI Timeline']);

    const timelinePage = await readFile(path.join(root, 'wiki', 'timelines', 'openai-timeline.md'), 'utf8');
    const overviewPage = await readFile(path.join(root, 'wiki', 'overview', 'mywiki-overview.md'), 'utf8');
    const indexPage = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
    const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');

    assert.match(timelinePage, /# OpenAI Timeline/);
    assert.match(timelinePage, /## Summary/);
    assert.match(timelinePage, /## Details/);
    assert.match(timelinePage, /### Chronology/);
    assert.match(timelinePage, /2026-04-08T10:00:00Z/);
    assert.match(timelinePage, /\[\[openai\]\]/);
    assert.match(timelinePage, /\[\[openai-query\]\]/);
    assert.match(overviewPage, /\[\[openai-timeline\]\]/);
    assert.match(indexPage, /## Timelines/);
    assert.match(indexPage, /\[\[openai-timeline\]\]/);
    assert.match(logPage, /timeline \| OpenAI Timeline/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('file-artifact routes questions into query comparison and timeline pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  const anthropicFile = path.join(root, 'anthropic.md');
  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', anthropicFile, '--title', 'Anthropic Notes']);

  await runCli(['file-artifact', '--root', root, '--question', 'OpenAI 和 Anthropic 有什么区别？', '--title', 'OpenAI vs Anthropic Auto']);
  await runCli(['file-artifact', '--root', root, '--question', 'OpenAI 时间线', '--title', 'OpenAI Auto Timeline']);
  await runCli(['file-artifact', '--root', root, '--question', 'Who is OpenAI?', '--title', 'OpenAI Auto Query']);

  const comparisonPage = await readFile(path.join(root, 'wiki', 'comparisons', 'openai-vs-anthropic-auto.md'), 'utf8');
  const timelinePage = await readFile(path.join(root, 'wiki', 'timelines', 'openai-auto-timeline.md'), 'utf8');
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-auto-query.md'), 'utf8');
  const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');

  assert.match(comparisonPage, /# OpenAI vs Anthropic Auto/);
  assert.match(comparisonPage, /\[\[openai-topic\]\]/);
  assert.match(comparisonPage, /\[\[anthropic-topic\]\]/);
  assert.match(timelinePage, /# OpenAI Auto Timeline/);
  assert.match(timelinePage, /## Details/);
  assert.match(queryPage, /# OpenAI Auto Query/);
  assert.match(queryPage, /## Summary/);
  assert.match(logPage, /comparison \| OpenAI vs Anthropic Auto/i);
  assert.match(logPage, /timeline \| OpenAI Auto Timeline/i);
  assert.match(logPage, /query \| OpenAI Auto Query/i);
});

test('file-artifact supports explicit comparison overrides', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  const anthropicFile = path.join(root, 'anthropic.md');
  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', anthropicFile, '--title', 'Anthropic Notes']);

  await runCli([
    'file-artifact',
    '--root', root,
    '--question', '请生成比较页',
    '--artifact-type', 'comparison',
    '--left', 'openai',
    '--left-type', 'topic',
    '--right', 'anthropic',
    '--right-type', 'topic',
    '--title', 'OpenAI Topic vs Anthropic Topic Auto'
  ]);

  const comparisonPage = await readFile(path.join(root, 'wiki', 'comparisons', 'openai-topic-vs-anthropic-topic-auto.md'), 'utf8');

  assert.match(comparisonPage, /# OpenAI Topic vs Anthropic Topic Auto/);
  assert.match(comparisonPage, /\[\[openai-topic\]\]/);
  assert.match(comparisonPage, /\[\[anthropic-topic\]\]/);
});

test('file-artifact supports explicit timeline and query slug overrides', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);

  await runCli([
    'file-artifact',
    '--root', root,
    '--question', '随便什么问题都行',
    '--artifact-type', 'timeline',
    '--slug', 'openai',
    '--title', 'Explicit OpenAI Timeline'
  ]);

  await runCli([
    'file-artifact',
    '--root', root,
    '--question', 'Who is OpenAI?',
    '--artifact-type', 'query',
    '--slug', 'openai-manual-query',
    '--title', 'OpenAI Manual Query'
  ]);

  const timelinePage = await readFile(path.join(root, 'wiki', 'timelines', 'explicit-openai-timeline.md'), 'utf8');
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-manual-query.md'), 'utf8');

  assert.match(timelinePage, /# Explicit OpenAI Timeline/);
  assert.match(timelinePage, /\[\[openai\]\]/);
  assert.match(queryPage, /# OpenAI Manual Query/);
  assert.match(queryPage, /slug: openai-manual-query/);
});

test('file-artifact manual artifact type overrides automatic routing intent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  const anthropicFile = path.join(root, 'anthropic.md');
  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', anthropicFile, '--title', 'Anthropic Notes']);

  await runCli([
    'file-artifact',
    '--root', root,
    '--question', 'OpenAI 和 Anthropic 有什么区别？',
    '--artifact-type', 'query',
    '--slug', 'forced-query',
    '--title', 'Forced Query'
  ]);

  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'forced-query.md'), 'utf8');
  const comparisonFiles = await readdir(path.join(root, 'wiki', 'comparisons'));

  assert.match(queryPage, /# Forced Query/);
  assert.equal(comparisonFiles.filter((name) => name.endsWith('.md')).length, 0);
});

test('file-artifact rejects invalid override flag combinations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));

  await assert.rejects(
    runCli([
      'file-artifact',
      '--root', root,
      '--question', '请生成比较页',
      '--artifact-type', 'comparison',
      '--left', 'openai'
    ]),
    /requires --left and --right/
  );

  await assert.rejects(
    runCli([
      'file-artifact',
      '--root', root,
      '--question', '请生成时间线',
      '--artifact-type', 'timeline'
    ]),
    /requires --slug/
  );

  await assert.rejects(
    runCli([
      'file-artifact',
      '--root', root,
      '--question', 'Who is OpenAI\?',
      '--artifact-type', 'query',
      '--left', 'openai'
    ]),
    /does not accept --left/
  );

  await assert.rejects(
    runCli([
      'file-artifact',
      '--root', root,
      '--question', 'Who is OpenAI\?',
      '--slug', 'openai-query'
    ]),
    /override flags require --artifact-type/
  );
});

test('file-answer merges repeated durable queries instead of creating duplicates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Notes']);
  await runCli(['file-answer', '--root', root, '--question', 'Who is OpenAI?', '--title', 'OpenAI Identity Query']);
  await runCli(['file-answer', '--root', root, '--question', 'Who is OpenAI', '--title', 'OpenAI Identity Query Followup']);

  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const queryPages = state.pages.filter((page) => page.type === 'query');
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-identity-query.md'), 'utf8');
  const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');

  assert.equal(queryPages.length, 1);
  assert.match(queryPage, /# OpenAI Identity Query/);
  assert.match(queryPage, /Merged durable query update/i);
  assert.match(logPage, /query \| OpenAI Identity Query/i);
  assert.match(logPage, /Updated existing durable query page.*using question match/i);
});

test('file-answer surfaces similar durable query conflicts and requires explicit slug control', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI Platform\n\nOpenAI offers APIs and ChatGPT.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Platform Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain the OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'Summarize the OpenAI platform overview',
      '--title', 'OpenAI Platform Summary'
    ]),
    /Similar durable query pages exist:\n- \[\[openai-platform-overview\]\].*Existing question: Explain the OpenAI platform overview.*--slug openai-platform-overview/is
  );

  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Summarize the OpenAI platform overview',
    '--title', 'OpenAI Platform Summary',
    '--slug', 'openai-platform-overview'
  ]);

  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const queryPages = state.pages.filter((page) => page.type === 'query');
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-platform-overview.md'), 'utf8');
  const logPage = await readFile(path.join(root, 'meta', 'log.md'), 'utf8');

  assert.equal(queryPages.length, 1);
  assert.match(queryPage, /Merged durable query update/i);
  assert.match(logPage, /Updated existing durable query page.*using slug match/i);
});

test('file-answer does not auto-merge same-title durable queries when the stored question differs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI Platform\n\nOpenAI offers APIs, ChatGPT, and pricing tiers.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Platform Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain the OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'How does OpenAI platform pricing work?',
      '--title', 'OpenAI Platform Overview'
    ]),
    /Similar durable query pages exist:\n- \[\[openai-platform-overview\]\].*Existing question: Explain the OpenAI platform overview.*--slug openai-platform-overview/is
  );

  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'How does OpenAI platform pricing work?',
    '--title', 'OpenAI Platform Overview',
    '--slug', 'openai-platform-overview'
  ]);

  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
  const queryPages = state.pages.filter((page) => page.type === 'query');
  const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-platform-overview.md'), 'utf8');

  assert.equal(queryPages.length, 1);
  assert.match(queryPage, /Merged durable query update/i);
});

test('file-answer lists multiple similar durable query candidates on separate lines with slug hints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const sourceFile = path.join(root, 'openai.md');
  await writeFile(sourceFile, '# OpenAI\n\nOpenAI offers platform, API, and overview materials.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', sourceFile, '--title', 'OpenAI Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain OpenAI API overview',
    '--title', 'OpenAI API Overview',
    '--slug', 'openai-api-overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'Summarize OpenAI overview',
      '--title', 'OpenAI Overview Summary'
    ]),
    (error) => {
      assert.match(error.message, /Similar durable query pages exist:/i);
      const apiLine = '- [[openai-api-overview]]';
      const platformLine = '- [[openai-platform-overview]]';
      assert.ok(error.message.includes(apiLine));
      assert.ok(error.message.includes(platformLine));
      assert.ok(error.message.includes('use --slug openai-api-overview'));
      assert.ok(error.message.includes('use --slug openai-platform-overview'));
      assert.ok(error.message.indexOf(apiLine) < error.message.indexOf(platformLine));
      return true;
    }
  );
});

test('file-answer truncates long similar-query reasons to keep conflict output readable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const sourceFile = path.join(root, 'openai.md');
  const longTitle = 'OpenAI Platform Overview with an Extremely Verbose Durable Query Title That Should Not Flood the CLI Output';
  const longQuestion = 'Explain the OpenAI platform overview with exhaustive detail about APIs, pricing, models, onboarding, governance, enterprise controls, and integration workflows for a new team evaluating adoption today.';
  const similarQuestion = 'Summarize the OpenAI platform overview with exhaustive detail about APIs, pricing, models, onboarding, governance, enterprise controls, and integration workflows for a new team evaluating adoption tomorrow.';

  await writeFile(sourceFile, '# OpenAI\n\nOpenAI offers platform, API, and overview materials.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', sourceFile, '--title', 'OpenAI Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', longQuestion,
    '--title', longTitle
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', similarQuestion,
      '--title', 'OpenAI Platform Overview Summary'
    ]),
    (error) => {
      assert.match(error.message, /Similar durable query pages exist:/i);
      assert.match(error.message, /Existing title: .*\.\.\./i);
      assert.match(error.message, /Existing question: .*\.\.\./i);
      assert.ok(!error.message.includes('integration workflows for a new team evaluating adoption today.'));
      return true;
    }
  );
});

test('file-answer avoids redundant generic overlap reasons in similar-query conflicts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const sourceFile = path.join(root, 'openai.md');

  await writeFile(sourceFile, '# OpenAI\n\nOpenAI offers platform, API, and overview materials.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', sourceFile, '--title', 'OpenAI Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain the OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'Summarize the OpenAI platform overview',
      '--title', 'OpenAI Platform Summary'
    ]),
    (error) => {
      assert.match(error.message, /Title overlap: openai, platform/i);
      assert.match(error.message, /Question overlap: openai, overview, platform/i);
      assert.ok(!/Overlapping terms:/i.test(error.message));
      return true;
    }
  );
});

test('file-answer hides similarity score when only one similar-query candidate exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI Platform\n\nOpenAI offers APIs and ChatGPT.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Platform Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain the OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'Summarize the OpenAI platform overview',
      '--title', 'OpenAI Platform Summary'
    ]),
    (error) => {
      assert.match(error.message, /Similar durable query pages exist:/i);
      assert.ok(!/Similarity score:/i.test(error.message));
      return true;
    }
  );
});

test('file-answer prints overlap reasons with deterministic term ordering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const openaiFile = path.join(root, 'openai.md');
  await writeFile(openaiFile, '# OpenAI Platform\n\nOpenAI offers APIs and ChatGPT.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', openaiFile, '--title', 'OpenAI Platform Notes']);
  await runCli([
    'file-answer',
    '--root', root,
    '--question', 'Explain the OpenAI platform overview',
    '--title', 'OpenAI Platform Overview'
  ]);

  await assert.rejects(
    runCli([
      'file-answer',
      '--root', root,
      '--question', 'Overview OpenAI summarize platform',
      '--title', 'Platform OpenAI Summary'
    ]),
    (error) => {
      assert.match(error.message, /Title overlap: openai, platform/i);
      assert.match(error.message, /Question overlap: openai, overview, platform/i);
      return true;
    }
  );
});

test('repeated duplicate ingests do not create extra source pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const firstFile = path.join(root, 'first.md');
  const secondFile = path.join(root, 'second.md');

  await writeFile(firstFile, '# OpenAI\n\nSam Altman leads OpenAI.', 'utf8');
  await writeFile(secondFile, '# OpenAI\n\nSam Altman leads OpenAI.', 'utf8');

  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', firstFile, '--title', 'OpenAI Notes']);
  await runCli(['ingest-source', '--root', root, '--type', 'file', '--path', secondFile, '--title', 'OpenAI Notes Copy']);

  const sourceFiles = (await readdir(path.join(root, 'wiki', 'sources'))).filter((name) => name.endsWith('.md'));
  const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));

  assert.equal(sourceFiles.length, 1);
  assert.equal(state.sources.length, 1);
});

test('web source metadata is written into stored source records and source pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const html = `<!doctype html>
  <html>
    <head>
      <title>Metadata Web Article</title>
      <meta name="author" content="Jane Doe" />
      <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
      <link rel="canonical" href="https://example.com/canonical-metadata-article" />
    </head>
    <body>
      <article>
        <h1>Metadata Web Article</h1>
        <p>OpenAI publishes model updates.</p>
      </article>
    </body>
  </html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/meta`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', url, '--title', 'Metadata Web Article']);
    const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
    const source = state.sources.find((entry) => entry.slug === 'metadata-web-article');
    const sourcePage = await readFile(path.join(root, 'wiki', 'sources', 'metadata-web-article.md'), 'utf8');

    assert.equal(source.metadata.author, 'Jane Doe');
    assert.equal(source.metadata.domain, '127.0.0.1');
    assert.equal(source.metadata.canonicalUrl, 'https://example.com/canonical-metadata-article');
    assert.match(sourcePage, /Author: Jane Doe/);
    assert.match(sourcePage, /Published: 2026-04-08T10:00:00Z/);
    assert.match(sourcePage, /Domain: 127.0.0.1/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('web ingests with different urls but same canonical url reuse one source page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const html = `<!doctype html>
  <html>
    <head>
      <title>Canonical Reused Article</title>
      <link rel="canonical" href="https://example.com/canonical-reused-article" />
    </head>
    <body>
      <article>
        <h1>Canonical Reused Article</h1>
        <p>Agent memory compounds over time.</p>
      </article>
    </body>
  </html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const firstUrl = `http://127.0.0.1:${address.port}/canonical?ref=feed`;
  const secondUrl = `http://127.0.0.1:${address.port}/canonical?utm_source=rss`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', firstUrl, '--title', 'Canonical Reused Article']);
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', secondUrl, '--title', 'Canonical Reused Article Refresh']);

    const sourceFiles = (await readdir(path.join(root, 'wiki', 'sources'))).filter((name) => name.endsWith('.md'));
    const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));

    assert.equal(sourceFiles.length, 1);
    assert.equal(state.sources.length, 1);
    assert.equal(state.sources[0].metadata.canonicalUrl, 'https://example.com/canonical-reused-article');
    assert.ok(state.sources[0].aliases.includes('Canonical Reused Article Refresh'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('canonical web reingest with changed content marks source drift in records and page details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  let body = `<!doctype html>
  <html>
    <head>
      <title>Drifted Article</title>
      <meta name="author" content="Jane Doe" />
      <meta property="article:published_time" content="2026-04-08T10:00:00Z" />
      <link rel="canonical" href="https://example.com/drifted-article" />
    </head>
    <body>
      <article>
        <h1>Drifted Article</h1>
        <p>First version.</p>
      </article>
    </body>
  </html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const firstUrl = `http://127.0.0.1:${address.port}/drift?ref=feed`;
  const secondUrl = `http://127.0.0.1:${address.port}/drift?utm_source=rss`;

  try {
    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', firstUrl, '--title', 'Drifted Article']);

    body = `<!doctype html>
    <html>
      <head>
        <title>Drifted Article</title>
        <meta name="author" content="Jane Doe" />
        <meta property="article:published_time" content="2026-04-09T10:00:00Z" />
        <link rel="canonical" href="https://example.com/drifted-article" />
      </head>
      <body>
        <article>
          <h1>Drifted Article</h1>
          <p>Second version with edits.</p>
        </article>
      </body>
    </html>`;

    await runCli(['ingest-source', '--root', root, '--type', 'web', '--url', secondUrl, '--title', 'Drifted Article Refresh']);

    const state = JSON.parse(await readFile(path.join(root, 'meta', 'manifests', 'state.json'), 'utf8'));
    const source = state.sources.find((entry) => entry.slug === 'drifted-article');
    const sourcePage = await readFile(path.join(root, 'wiki', 'sources', 'drifted-article.md'), 'utf8');

    assert.equal(source.metadata.contentDrift, true);
    assert.equal(source.metadata.contentVersionCount, 2);
    assert.match(sourcePage, /Content drift detected: yes/);
    assert.match(sourcePage, /Observed versions: 2/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
