// Worker triage A05: konsumsi queue triage, klasifikasi tiket, simpan assignment.
//
//   WORKER_ID=w1 node worker.js
//
// Urutan per pesan:
//   1. Parse + validasi kontrak. Gagal -> catat di ticket_rejections, nack tanpa
//      requeue -> DLX support.dlx -> queue triage.rejected. Tidak ada efek bisnis.
//   2. Satu transaksi: INSERT ticket_inbox(event_id) ON CONFLICT DO NOTHING.
//      Baris baru -> INSERT ticket_assignments. Sudah ada -> duplikat, tanpa efek.
//   3. COMMIT, lalu ack. Crash sebelum ack -> broker mengirim ulang, inbox menahan duplikat.
//   4. Error database -> tidak ack, worker berhenti (hindari loop requeue cepat);
//      pesan kembali ke ready saat koneksi tertutup.
const amqp = require('amqplib');
const { Pool } = require('pg');
const { createHash } = require('node:crypto');
const config = require('./src/config');
const { classify, validateEvent, RULE_VERSION } = require('./src/kontrak');
const { TOPOLOGY, declareTopology } = require('./src/topologi');

const workerId = process.env.WORKER_ID || `w${process.pid}`;
const prefetch = config.prefetch();
const workMs = config.workMs();
const log = entry => console.log(JSON.stringify({ at: new Date().toISOString(), worker: workerId, ...entry }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reject(client, message, raw, reason) {
  let eventId = null;
  try { eventId = JSON.parse(raw)?.event_id ?? null; } catch { /* bukan JSON */ }
  if (typeof eventId !== 'string') eventId = null;
  const key = eventId || 'sha256:' + createHash('sha256').update(raw).digest('hex');
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO ticket_rejections (rejection_key, event_id, reason, raw) VALUES ($1,$2,$3,$4) ON CONFLICT (rejection_key) DO NOTHING',
    [key, eventId, reason, raw.slice(0, 4000)]);
  await client.query('INSERT INTO ticket_delivery_log (event_id, outcome, redelivered, worker_id) VALUES ($1,$2,$3,$4)',
    [eventId, 'REJECTED', message.fields.redelivered, workerId]);
  await client.query('COMMIT');
  return eventId;
}

async function apply(client, message, event) {
  const p = event.payload;
  const serviceQueue = classify(p.category);
  await client.query('BEGIN');
  const inbox = await client.query(
    'INSERT INTO ticket_inbox (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id', [event.event_id]);
  let outcome = 'DUPLICATE';
  if (inbox.rowCount === 1) {
    const inserted = await client.query(
      `INSERT INTO ticket_assignments
         (event_id, ticket_id, customer_id, category, subject, service_queue, rule_version, worker_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (ticket_id) DO NOTHING`,
      [event.event_id, p.ticket_id, p.customer_id, p.category, p.subject, serviceQueue, RULE_VERSION, workerId, event.occurred_at]);
    // Event baru tetapi ticket_id sudah punya assignment dari event lain: tidak ditugaskan dua kali.
    outcome = inserted.rowCount === 1 ? 'APPLIED' : 'DUPLICATE_TICKET';
  }
  await client.query('INSERT INTO ticket_delivery_log (event_id, outcome, redelivered, worker_id) VALUES ($1,$2,$3,$4)',
    [event.event_id, outcome, message.fields.redelivered, workerId]);
  await client.query('COMMIT');
  return { outcome, serviceQueue };
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl, max: Math.max(2, prefetch) });
  const connection = await amqp.connect(config.amqpUrl);
  const channel = await connection.createChannel();
  await declareTopology(channel);
  await channel.prefetch(prefetch);

  let stopping = false;
  let active = 0;
  let consumerTag = null;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    log({ stopping: true, active });
    if (consumerTag) await channel.cancel(consumerTag).catch(() => {});
    while (active > 0) await delay(50);
    await channel.close().catch(() => {});
    await connection.close().catch(() => {});
    await pool.end().catch(() => {});
    log({ stopped: true });
    process.exit(code);
  }
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  connection.on('close', () => { if (!stopping) { log({ error: 'Koneksi broker tertutup' }); process.exit(1); } });

  const consumed = await channel.consume(TOPOLOGY.queue, async message => {
    if (!message) { log({ error: 'Consumer dibatalkan broker' }); return void stop(1); }
    if (stopping) return; // unacked; kembali ke queue saat channel ditutup
    active++;
    const raw = message.content.toString('utf8');
    let client;
    try {
      client = await pool.connect();
      let event;
      try {
        event = validateEvent(JSON.parse(raw));
      } catch (error) {
        const eventId = await reject(client, message, raw, error.message);
        channel.nack(message, false, false); // -> support.dlx -> triage.rejected
        log({ outcome: 'REJECTED', event_id: eventId, reason: error.message });
        return;
      }
      if (workMs) await delay(workMs); // simulasi kerja klasifikasi, untuk memperlebar jendela uji
      const { outcome, serviceQueue } = await apply(client, message, event);
      channel.ack(message);
      log({ outcome, event_id: event.event_id, ticket_id: event.payload.ticket_id,
        category: event.payload.category, service_queue: serviceQueue, redelivered: message.fields.redelivered });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      log({ error: 'Gagal memproses; pesan TIDAK di-ack, worker berhenti', reason: error.message });
      void stop(1);
    } finally {
      if (client) client.release();
      active--;
    }
  }, { noAck: false });
  consumerTag = consumed.consumerTag;
  log({ ready: true, queue: TOPOLOGY.queue, prefetch, workMs, rule: RULE_VERSION });
}

main().catch(error => { console.error(error.message); process.exit(1); });
