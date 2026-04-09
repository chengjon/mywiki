import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { createPaths } from '../config.js';
import { ensureRepositoryLayout } from '../fs.js';
import { createMongoRepositories } from './mongo.js';

const stateShape = () => ({
  sources: [],
  sourceChunks: [],
  pages: [],
  entities: [],
  relations: [],
  queries: [],
  jobs: [],
  auditLog: []
});

function createMemoryCollection(store) {
  return {
    async all() {
      return [...store];
    },
    async getById(id) {
      return store.find((item) => item.id === id) ?? null;
    },
    async findBy(field, value) {
      return store.find((item) => item[field] === value) ?? null;
    },
    async filter(predicate) {
      return store.filter(predicate);
    },
    async insert(record) {
      store.push(record);
      return record;
    },
    async upsert(record, field = 'id') {
      const index = store.findIndex((item) => item[field] === record[field]);
      if (index >= 0) {
        store[index] = record;
      } else {
        store.push(record);
      }
      return record;
    },
    async replaceAll(records) {
      store.splice(0, store.length, ...records);
      return records;
    }
  };
}

function createMemoryRepositoriesFromState(state) {
  return {
    kind: 'memory',
    sources: createMemoryCollection(state.sources),
    sourceChunks: createMemoryCollection(state.sourceChunks),
    pages: createMemoryCollection(state.pages),
    entities: createMemoryCollection(state.entities),
    relations: createMemoryCollection(state.relations),
    queries: createMemoryCollection(state.queries),
    jobs: createMemoryCollection(state.jobs),
    auditLog: createMemoryCollection(state.auditLog),
    async close() {}
  };
}

async function loadFileState(rootDir) {
  await ensureRepositoryLayout(rootDir);
  const statePath = path.join(createPaths(rootDir).metaManifests, 'state.json');
  try {
    const text = await readFile(statePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return stateShape();
  }
}

async function saveFileState(rootDir, state) {
  const statePath = path.join(createPaths(rootDir).metaManifests, 'state.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function createFileCollection(rootDir, state, key) {
  const collection = state[key];
  return {
    async all() {
      return [...collection];
    },
    async getById(id) {
      return collection.find((item) => item.id === id) ?? null;
    },
    async findBy(field, value) {
      return collection.find((item) => item[field] === value) ?? null;
    },
    async filter(predicate) {
      return collection.filter(predicate);
    },
    async insert(record) {
      collection.push(record);
      await saveFileState(rootDir, state);
      return record;
    },
    async upsert(record, field = 'id') {
      const index = collection.findIndex((item) => item[field] === record[field]);
      if (index >= 0) {
        collection[index] = record;
      } else {
        collection.push(record);
      }
      await saveFileState(rootDir, state);
      return record;
    },
    async replaceAll(records) {
      collection.splice(0, collection.length, ...records);
      await saveFileState(rootDir, state);
      return records;
    }
  };
}

export function createInMemoryRepositories() {
  return createMemoryRepositoriesFromState(stateShape());
}

export async function createFileRepositories(rootDir) {
  const state = await loadFileState(rootDir);
  return {
    kind: 'file',
    sources: createFileCollection(rootDir, state, 'sources'),
    sourceChunks: createFileCollection(rootDir, state, 'sourceChunks'),
    pages: createFileCollection(rootDir, state, 'pages'),
    entities: createFileCollection(rootDir, state, 'entities'),
    relations: createFileCollection(rootDir, state, 'relations'),
    queries: createFileCollection(rootDir, state, 'queries'),
    jobs: createFileCollection(rootDir, state, 'jobs'),
    auditLog: createFileCollection(rootDir, state, 'auditLog'),
    async close() {}
  };
}

export async function createRepositories({ rootDir, storage = 'file', mongoUri, dbName, ensureIndexes = true }) {
  if (storage === 'mongo') {
    return createMongoRepositories({ mongoUri, dbName, ensureIndexes });
  }
  return createFileRepositories(rootDir);
}
