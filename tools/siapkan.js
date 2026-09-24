// Siapkan skema Postgres dan topology RabbitMQ A05. Idempoten.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const amqp = require('amqplib');
const { Client } = require('pg');
const config = require('../src/config');
const { declareTopology } = require('../src/topologi');

async function main() {
  const db = new Client({ connectionString: config.databaseUrl });
  await db.connect();
  try {
    await db.query(readFileSync(join(config.ROOT, 'db', 'skema.sql'), 'utf8'));
  } finally {
    await db.end();
  }
  const connection = await amqp.connect(config.amqpUrl);
  try {
    const channel = await connection.createChannel();
    const t = await declareTopology(channel);
    console.log(JSON.stringify({ db: 'skema siap', topology: t }));
  } finally {
    await connection.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
