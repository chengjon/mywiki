function createMongoCollection(collection) {
  return {
    async all() {
      return collection.find({}).toArray();
    },
    async getById(id) {
      return collection.findOne({ id });
    },
    async findBy(field, value) {
      return collection.findOne({ [field]: value });
    },
    async filter(predicate) {
      const rows = await collection.find({}).toArray();
      return rows.filter(predicate);
    },
    async insert(record) {
      await collection.insertOne(record);
      return record;
    },
    async upsert(record, field = 'id') {
      await collection.updateOne({ [field]: record[field] }, { $set: record }, { upsert: true });
      return record;
    },
    async replaceAll(records) {
      await collection.deleteMany({});
      if (records.length > 0) {
        await collection.insertMany(records);
      }
      return records;
    }
  };
}

export const requiredMongoCollections = [
  'sources',
  'source_chunks',
  'pages',
  'entities',
  'relations',
  'queries',
  'jobs',
  'audit_log'
];

export const requiredMongoIndexChecks = {
  sources: [
    (index) => index.key?.id === 1,
    (index) => index.key?.slug === 1,
    (index) => index.key?.localPath === 1,
    (index) => index.key?.checksum === 1,
    (index) => index.key?.uri === 1,
    (index) => index.key?.['metadata.canonicalUrl'] === 1
  ],
  source_chunks: [
    (index) => index.key?.id === 1,
    (index) => index.key?.sourceId === 1
  ],
  pages: [
    (index) => index.key?.id === 1,
    (index) => index.key?.slug === 1,
    (index) => index.key?.type === 1 && index.key?.slug === 1
  ],
  entities: [
    (index) => index.key?.id === 1,
    (index) => index.key?.slug === 1
  ],
  relations: [
    (index) => index.key?.id === 1,
    (index) => index.key?.fromId === 1 && index.key?.relationType === 1
  ],
  queries: [
    (index) => index.key?.id === 1
  ],
  jobs: [
    (index) => index.key?.id === 1
  ],
  audit_log: [
    (index) => index.key?.id === 1,
    (index) => index.key?.createdAt === 1
  ]
};

async function ensureMongoIndexes(db) {
  await Promise.all([
    db.collection('sources').createIndexes([
      { key: { id: 1 }, name: 'sources_id_unique', unique: true },
      { key: { slug: 1 }, name: 'sources_slug' },
      { key: { localPath: 1 }, name: 'sources_local_path', sparse: true },
      { key: { checksum: 1 }, name: 'sources_checksum' },
      { key: { uri: 1 }, name: 'sources_uri', sparse: true },
      { key: { 'metadata.canonicalUrl': 1 }, name: 'sources_canonical_url', sparse: true }
    ]),
    db.collection('source_chunks').createIndexes([
      { key: { id: 1 }, name: 'source_chunks_id_unique', unique: true },
      { key: { sourceId: 1 }, name: 'source_chunks_source_id' }
    ]),
    db.collection('pages').createIndexes([
      { key: { id: 1 }, name: 'pages_id_unique', unique: true },
      { key: { slug: 1 }, name: 'pages_slug', unique: true },
      { key: { type: 1, slug: 1 }, name: 'pages_type_slug' }
    ]),
    db.collection('entities').createIndexes([
      { key: { id: 1 }, name: 'entities_id_unique', unique: true },
      { key: { slug: 1 }, name: 'entities_slug' },
      { key: { name: 1 }, name: 'entities_name' }
    ]),
    db.collection('relations').createIndexes([
      { key: { id: 1 }, name: 'relations_id_unique', unique: true },
      { key: { fromId: 1, relationType: 1 }, name: 'relations_from_relation_type' },
      { key: { toId: 1 }, name: 'relations_to_id' }
    ]),
    db.collection('queries').createIndexes([
      { key: { id: 1 }, name: 'queries_id_unique', unique: true }
    ]),
    db.collection('jobs').createIndexes([
      { key: { id: 1 }, name: 'jobs_id_unique', unique: true }
    ]),
    db.collection('audit_log').createIndexes([
      { key: { id: 1 }, name: 'audit_log_id_unique', unique: true },
      { key: { createdAt: 1 }, name: 'audit_log_created_at' },
      { key: { relatedIds: 1 }, name: 'audit_log_related_ids' }
    ])
  ]);
}

export async function createMongoRepositories({ mongoUri, dbName = 'mywiki' }) {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required when storage is set to mongo');
  }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  await ensureMongoIndexes(db);

  return {
    kind: 'mongo',
    sources: createMongoCollection(db.collection('sources')),
    sourceChunks: createMongoCollection(db.collection('source_chunks')),
    pages: createMongoCollection(db.collection('pages')),
    entities: createMongoCollection(db.collection('entities')),
    relations: createMongoCollection(db.collection('relations')),
    queries: createMongoCollection(db.collection('queries')),
    jobs: createMongoCollection(db.collection('jobs')),
    auditLog: createMongoCollection(db.collection('audit_log')),
    diagnostics: {
      async listCollections() {
        return db.listCollections().toArray();
      },
      async listIndexes() {
        return Object.fromEntries(
          await Promise.all(
            requiredMongoCollections.map(async (name) => [name, await db.collection(name).indexes()])
          )
        );
      }
    },
    async close() {
      await client.close();
    }
  };
}
