import test from 'node:test';
import assert from 'node:assert/strict';

import { createPaths, defaultGovernanceConfig, slugify } from '../app/config.js';

test('slugify normalizes titles into stable slugs', () => {
  assert.equal(slugify('RAG vs LLM Wiki'), 'rag-vs-llm-wiki');
});

test('createPaths returns required repository directories', () => {
  const paths = createPaths('/repo');
  assert.equal(paths.rawInbox, '/repo/raw/inbox');
  assert.equal(paths.wikiTopics, '/repo/wiki/topics');
  assert.equal(paths.metaIndex, '/repo/meta/index.md');
});

test('defaultGovernanceConfig defines canonical governance document and planning paths', () => {
  assert.equal(defaultGovernanceConfig.documents.standards, 'STANDARDS.md');
  assert.equal(defaultGovernanceConfig.documents.agentRules, 'AGENTS.md');
  assert.equal(defaultGovernanceConfig.paths.proposalSpecsDir, 'docs/superpowers/specs');
  assert.equal(defaultGovernanceConfig.paths.implementationPlansDir, 'docs/superpowers/plans');
});
