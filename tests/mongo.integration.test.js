import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';

import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { runCli } from '../app/cli/index.js';
import { createRepositories } from '../app/db/repositories.js';

test('mongo storage mode persists ingest results through repository adapters', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'mongo-note.md');
  await writeFile(file, '# Anthropic\n\nClaude is built by Anthropic.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongod.getUri(),
      '--db-name', 'mywiki_test',
      '--type', 'file',
      '--path', file,
      '--title', 'Anthropic Note'
    ]);

    const repos = await createRepositories({
      rootDir: root,
      storage: 'mongo',
      mongoUri: mongod.getUri(),
      dbName: 'mywiki_test'
    });

    try {
      const sources = await repos.sources.all();
      const pages = await repos.pages.all();
      const entities = await repos.entities.all();

      assert.equal(sources.length, 1);
      assert.ok(pages.some((page) => page.slug === 'anthropic-note'));
      assert.ok(entities.some((entity) => entity.name === 'Anthropic'));
    } finally {
      await repos.close();
    }
  } finally {
    await mongod.stop();
  }
});

test('mongo storage mode creates indexes and keeps exported wiki artifacts in sync', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'openai-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_index_test';

  await writeFile(file, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', file,
      '--title', 'OpenAI Note'
    ]);

    await runCli([
      'file-answer',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--question', 'Who is OpenAI?',
      '--title', 'OpenAI Mongo Query'
    ]);

    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
      const db = client.db(dbName);
      const pageIndexes = await db.collection('pages').indexes();
      const sourceIndexes = await db.collection('sources').indexes();
      const auditIndexes = await db.collection('audit_log').indexes();
      const queryPage = await readFile(path.join(root, 'wiki', 'queries', 'openai-mongo-query.md'), 'utf8');
      const sourcePage = await readFile(path.join(root, 'wiki', 'sources', 'openai-note.md'), 'utf8');

      assert.ok(pageIndexes.some((index) => index.key?.slug === 1));
      assert.ok(pageIndexes.some((index) => index.key?.type === 1 && index.key?.slug === 1));
      assert.ok(sourceIndexes.some((index) => index.key?.id === 1));
      assert.ok(sourceIndexes.some((index) => index.key?.localPath === 1));
      assert.ok(sourceIndexes.some((index) => index.key?.checksum === 1));
      assert.ok(sourceIndexes.some((index) => index.key?.uri === 1));
      assert.ok(sourceIndexes.some((index) => index.key?.['metadata.canonicalUrl'] === 1));
      assert.ok(auditIndexes.some((index) => index.key?.createdAt === 1));
      assert.match(queryPage, /# OpenAI Mongo Query/);
      assert.match(sourcePage, /# OpenAI Note/);
    } finally {
      await client.close();
    }
  } finally {
    await mongod.stop();
  }
});

test('doctor reports mongo export drift and repair restores missing wiki files', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'openai-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_repair_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await writeFile(file, '# OpenAI\n\nOpenAI builds ChatGPT and an API platform.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', file,
      '--title', 'OpenAI Note'
    ], { stdout });

    await runCli([
      'file-answer',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--question', 'Who is OpenAI?',
      '--title', 'OpenAI Mongo Query'
    ], { stdout });

    const queryPath = path.join(root, 'wiki', 'queries', 'openai-mongo-query.md');
    await unlink(queryPath);

    stdoutChunks.length = 0;
    await runCli([
      'doctor',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const doctorOutput = stdoutChunks.join('');

    assert.match(doctorOutput, /Mongo indexes: ok/i);
    assert.match(doctorOutput, /Missing wiki exports: 1/i);

    stdoutChunks.length = 0;
    await runCli([
      'repair',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });

    const repairedPage = await readFile(queryPath, 'utf8');
    assert.match(repairedPage, /# OpenAI Mongo Query/);
  } finally {
    await mongod.stop();
  }
});

test('doctor detects missing mongo indexes and repair restores them', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'openai-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_missing_index_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await writeFile(file, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', file,
      '--title', 'OpenAI Note'
    ], { stdout });

    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
      await client.db(dbName).collection('sources').dropIndex('sources_checksum');
    } finally {
      await client.close();
    }

    stdoutChunks.length = 0;
    await runCli([
      'doctor',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const doctorOutput = stdoutChunks.join('');

    assert.match(doctorOutput, /Mongo indexes: missing in sources \(sources_checksum\)/i);

    stdoutChunks.length = 0;
    await runCli([
      'repair',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const repairOutput = stdoutChunks.join('');

    const repairedClient = new MongoClient(mongoUri);
    await repairedClient.connect();

    try {
      const sourceIndexes = await repairedClient.db(dbName).collection('sources').indexes();
      assert.match(repairOutput, /Repaired mongo indexes: sources \(sources_checksum\)/i);
      assert.match(repairOutput, /Mongo indexes: ok/i);
      assert.ok(sourceIndexes.some((index) => index.name === 'sources_checksum'));
    } finally {
      await repairedClient.close();
    }
  } finally {
    await mongod.stop();
  }
});

test('doctor detects missing mongo collections and repair restores them', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'openai-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_missing_collection_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await writeFile(file, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', file,
      '--title', 'OpenAI Note'
    ], { stdout });

    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
      await client.db(dbName).collection('queries').drop();
    } finally {
      await client.close();
    }

    stdoutChunks.length = 0;
    await runCli([
      'doctor',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const doctorOutput = stdoutChunks.join('');

    assert.match(doctorOutput, /Mongo indexes: ok/i);
    assert.match(doctorOutput, /Missing collections: queries/i);

    stdoutChunks.length = 0;
    await runCli([
      'repair',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const repairOutput = stdoutChunks.join('');

    const repairedClient = new MongoClient(mongoUri);
    await repairedClient.connect();

    try {
      const collections = await repairedClient.db(dbName).listCollections().toArray();
      assert.match(repairOutput, /Repaired mongo collections: queries/i);
      assert.match(repairOutput, /Missing collections: none/i);
      assert.ok(collections.some((collection) => collection.name === 'queries'));
    } finally {
      await repairedClient.close();
    }
  } finally {
    await mongod.stop();
  }
});

test('doctor lists extra wiki exports and repair --prune removes them', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const file = path.join(root, 'openai-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_prune_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await writeFile(file, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', file,
      '--title', 'OpenAI Note'
    ], { stdout });

    const orphanPath = path.join(root, 'wiki', 'queries', 'orphan-query.md');
    await writeFile(orphanPath, '# Orphan Query\n', 'utf8');

    stdoutChunks.length = 0;
    await runCli([
      'doctor',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });
    const doctorOutput = stdoutChunks.join('');

    assert.match(doctorOutput, /Extra wiki exports: 1/i);
    assert.match(doctorOutput, /orphan-query\.md/);

    stdoutChunks.length = 0;
    await runCli([
      'repair',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--prune'
    ], { stdout });

    await assert.rejects(readFile(orphanPath, 'utf8'), /ENOENT/);
  } finally {
    await mongod.stop();
  }
});

test('doctor --compare-storage reports file and mongo drift with concrete slugs', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const openaiFile = path.join(root, 'openai-note.md');
  const anthropicFile = path.join(root, 'anthropic-note.md');
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_compare_storage_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  await writeFile(openaiFile, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');
  await writeFile(anthropicFile, '# Anthropic\n\nAnthropic builds Claude.', 'utf8');

  try {
    await runCli([
      'ingest-source',
      '--root', root,
      '--type', 'file',
      '--path', openaiFile,
      '--title', 'OpenAI Note'
    ], { stdout });

    const statePath = path.join(root, 'meta', 'manifests', 'state.json');
    const fileState = JSON.parse(await readFile(statePath, 'utf8'));
    const fileSource = fileState.sources.find((source) => source.slug === 'openai-note');
    const filePage = fileState.pages.find((page) => page.slug === 'openai-note');
    fileSource.localPath = '/tmp/file-only-openai-note.md';
    fileSource.checksum = 'file-only-checksum';
    fileSource.metadata = {
      ...(fileSource.metadata ?? {}),
      lastSeenLocalPath: '/tmp/file-only-last-seen.md',
      localPathHistory: ['/tmp/file-only-history.md']
    };
    filePage.title = 'OpenAI Note File Variant';
    await writeFile(statePath, JSON.stringify(fileState, null, 2), 'utf8');

    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', openaiFile,
      '--title', 'OpenAI Note'
    ], { stdout });

    await runCli([
      'ingest-source',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--type', 'file',
      '--path', anthropicFile,
      '--title', 'Anthropic Note'
    ], { stdout });

    stdoutChunks.length = 0;
    await runCli([
      'doctor',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName,
      '--compare-storage'
    ], { stdout });
    const doctorOutput = stdoutChunks.join('');

    assert.match(doctorOutput, /Storage consistency: drift detected/i);
    assert.match(doctorOutput, /Mongo-only sources: anthropic-note/i);
    assert.match(doctorOutput, /Mongo-only pages: .*anthropic-note/i);
    assert.match(doctorOutput, /Source local path mismatches: openai-note/i);
    assert.match(doctorOutput, /Source last seen path mismatches: openai-note/i);
    assert.match(doctorOutput, /Source path history mismatches: openai-note/i);
    assert.match(doctorOutput, /Source checksum mismatches: openai-note/i);
    assert.match(doctorOutput, /Title mismatches: openai-note/i);
  } finally {
    await mongod.stop();
  }
});

test('mongo batch-ingest remembers renamed duplicate paths and reingests later changes into the same source', async () => {
  const mongod = await MongoMemoryServer.create();
  const root = await mkdtemp(path.join(os.tmpdir(), 'mywiki-mongo-'));
  const mongoUri = mongod.getUri();
  const dbName = 'mywiki_mongo_batch_path_history_test';
  const stdoutChunks = [];
  const stdout = {
    write(value) {
      stdoutChunks.push(String(value));
    }
  };

  try {
    await runCli(['doctor', '--root', root], { stdout });

    const firstPath = path.join(root, 'raw', 'inbox', '01-openai-notes.md');
    const renamedPath = path.join(root, 'raw', 'inbox', '02-openai-notes-renamed.md');
    await writeFile(firstPath, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

    stdoutChunks.length = 0;
    await runCli([
      'batch-ingest',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });

    await writeFile(renamedPath, '# OpenAI\n\nOpenAI builds ChatGPT.', 'utf8');

    stdoutChunks.length = 0;
    await runCli([
      'batch-ingest',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });

    await writeFile(renamedPath, '# OpenAI\n\nOpenAI builds ChatGPT.\n\nOpenAI also offers APIs.', 'utf8');

    stdoutChunks.length = 0;
    await runCli([
      'batch-ingest',
      '--root', root,
      '--storage', 'mongo',
      '--mongo-uri', mongoUri,
      '--db-name', dbName
    ], { stdout });

    const batchOutput = stdoutChunks.join('');
    const reportPage = await readFile(path.join(root, 'meta', 'reports', 'latest-batch-ingest.md'), 'utf8');
    const sourcePage = await readFile(path.join(root, 'wiki', 'sources', '01-openai-notes.md'), 'utf8');
    const repos = await createRepositories({
      rootDir: root,
      storage: 'mongo',
      mongoUri,
      dbName
    });

    try {
      const sources = await repos.sources.all();
      const source = sources[0];

      assert.match(batchOutput, /Processed 1 source files/i);
      assert.match(batchOutput, /OK 02-openai-notes-renamed\.md -> \[\[01-openai-notes\]\]/i);
      assert.equal(sources.length, 1);
      assert.equal(source.localPath, renamedPath);
      assert.equal(source.metadata.lastSeenLocalPath, renamedPath);
      assert.deepEqual(
        source.metadata.localPathHistory,
        [firstPath, renamedPath]
      );
      assert.equal(source.metadata.contentDrift, true);
      assert.match(reportPage, /Processed: 1/);
      assert.match(reportPage, /Skipped: 1/);
      assert.match(sourcePage, /Content drift detected: yes/);
    } finally {
      await repos.close();
    }
  } finally {
    await mongod.stop();
  }
});
