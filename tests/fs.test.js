import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';

import { ensureRepositoryLayout, exists, readGovernanceConfig } from '../app/fs.js';

test('ensureRepositoryLayout creates required wiki and meta files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);
  const indexText = await readFile(path.join(root, 'meta', 'index.md'), 'utf8');
  assert.match(indexText, /# MyWiki Index/);
});

test('ensureRepositoryLayout creates default conflict preference config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);
  const preferencesText = await readFile(path.join(root, 'system', 'preferences.json'), 'utf8');
  assert.match(preferencesText, /conflictResolution/);
  assert.match(preferencesText, /publishedAt/);
  assert.match(preferencesText, /sourceTypeWeight/);
  assert.match(preferencesText, /web/);
});

test('ensureRepositoryLayout creates default governance config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);
  const governanceText = await readFile(path.join(root, 'system', 'governance.json'), 'utf8');
  assert.match(governanceText, /proposalSpecsDir/);
  assert.match(governanceText, /implementationPlansDir/);
  assert.match(governanceText, /STANDARDS\.md/);
});

test('readGovernanceConfig merges repo overrides over defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await ensureRepositoryLayout(root);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: 'docs/project-standards.md'
      },
      paths: {
        proposalSpecsDir: 'docs/specs'
      }
    }, null, 2),
    'utf8'
  ));

  const config = await readGovernanceConfig(root);
  assert.equal(config.documents.standards, 'docs/project-standards.md');
  assert.equal(config.documents.agentRules, 'AGENTS.md');
  assert.equal(config.paths.proposalSpecsDir, 'docs/specs');
  assert.equal(config.paths.implementationPlansDir, 'docs/superpowers/plans');
});

test('ensureRepositoryLayout creates configured governance planning directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      paths: {
        proposalSpecsDir: 'governance/specs',
        implementationPlansDir: 'governance/plans'
      }
    }, null, 2),
    'utf8'
  );

  await ensureRepositoryLayout(root);

  assert.equal(await exists(path.join(root, 'governance', 'specs')), true);
  assert.equal(await exists(path.join(root, 'governance', 'plans')), true);
});

test('ensureRepositoryLayout falls back from out-of-repo governance paths to repo-local defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-'));
  const outsideDir = path.join(os.tmpdir(), `mywiki-outside-${Date.now()}`);
  await mkdir(path.join(root, 'system'), { recursive: true });
  await writeFile(
    path.join(root, 'system', 'governance.json'),
    JSON.stringify({
      documents: {
        standards: '/etc/passwd',
        readme: '../outside-readme.md'
      },
      paths: {
        proposalSpecsDir: outsideDir,
        implementationPlansDir: '../../external-plans'
      }
    }, null, 2),
    'utf8'
  );

  await ensureRepositoryLayout(root);

  assert.equal(await exists(path.join(root, 'docs', 'superpowers', 'specs')), true);
  assert.equal(await exists(path.join(root, 'docs', 'superpowers', 'plans')), true);
  assert.equal(await exists(outsideDir), false);
  assert.equal(await exists(path.join(path.dirname(root), 'outside-readme.md')), false);
});
