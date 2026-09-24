// Observasi broker dan database untuk bukti uji.
const amqp = require('amqplib');
const config = require('./config');
const { TOPOLOGY } = require('./topologi');
const { classify } = require('./kontrak');
const { DATA, EXPECTED_IDS } = require('./dataset');

// ready & consumers dari AMQP (tepat saat itu); unacked dari Management API
// (statistiknya diperbarui berkala, bisa tertinggal beberapa detik).
async function queueState() {
  const connection = await amqp.connect(config.amqpUrl);
  const channel = await connection.createChannel();
  const out = { observed_at: new Date().toISOString() };
  try {
    for (const name of [TOPOLOGY.queue, TOPOLOGY.dlq]) {
      const q = await channel.checkQueue(name);
      out[name] = { ready: q.messageCount, consumers: q.consumerCount };
    }
  } finally {
    await connection.close().catch(() => {});
  }
  try {
    const { url, user, pass, vhost } = config.mgmt;
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    for (const name of [TOPOLOGY.queue, TOPOLOGY.dlq]) {
      const res = await fetch(`${url}/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(name)}`,
        { headers: { authorization: auth }, signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      Object.assign(out[name], { unacked_mgmt: body.messages_unacknowledged ?? null, durable: body.durable,
        dead_letter_exchange: body.arguments?.['x-dead-letter-exchange'] ?? null });
    }
  } catch (error) {
    out.mgmt_error = `Management API tidak terbaca (${error.message}); ready/consumers tetap valid`;
  }
  return out;
}

// Bandingkan himpunan ID input dengan assignment di DB untuk satu run dan tahap uji.
async function checkRun(pool, runId, stage) {
  const expectedIds = EXPECTED_IDS[stage];
  if (!expectedIds) throw new Error('--tahap harus U1, U2, U3, atau U4');
  const like = `${runId}-%`;
  const rows = (await pool.query(
    `SELECT event_id, ticket_id, category, service_queue, status, worker_id, assigned_at
       FROM ticket_assignments WHERE event_id LIKE $1 ORDER BY event_id`, [like])).rows;
  const rejections = (await pool.query(
    'SELECT rejection_key, event_id, reason, rejected_at FROM ticket_rejections WHERE event_id LIKE $1 ORDER BY event_id', [like])).rows;
  const deliveries = (await pool.query(
    `SELECT outcome, count(*)::int AS n, count(*) FILTER (WHERE redelivered)::int AS redelivered
       FROM ticket_delivery_log WHERE event_id LIKE $1 GROUP BY outcome ORDER BY outcome`, [like])).rows;
  const perEvent = (await pool.query(
    `SELECT event_id, count(*)::int AS deliveries, string_agg(outcome, ',' ORDER BY id) AS outcomes
       FROM ticket_delivery_log WHERE event_id LIKE $1 GROUP BY event_id HAVING count(*) > 1 ORDER BY event_id`, [like])).rows;

  const expected = new Set(expectedIds.map(id => `${runId}-${id}`));
  const actual = new Set(rows.map(r => r.event_id));
  const missing = [...expected].filter(id => !actual.has(id));
  const unexpected = [...actual].filter(id => !expected.has(id));
  const ruleViolations = rows.filter(r => classify(r.category) !== r.service_queue)
    .map(r => ({ event_id: r.event_id, category: r.category, service_queue: r.service_queue, expected: classify(r.category) }));
  const perQueue = { FINANCE: 0, TECH: 0, GENERAL: 0 };
  for (const r of rows) perQueue[r.service_queue]++;
  const target = DATA.harapan[stage];
  const countsMatch = rows.length === target.total && ['FINANCE', 'TECH', 'GENERAL'].every(q => perQueue[q] === target[q]);

  const result = {
    run: runId, stage, checked_at: new Date().toISOString(),
    target, actual: { total: rows.length, ...perQueue },
    missing, unexpected, rule_violations: ruleViolations,
    unique_ticket_ids: new Set(rows.map(r => r.ticket_id)).size,
    rejections, deliveries, events_with_multiple_deliveries: perEvent,
  };
  result.lulus = missing.length === 0 && unexpected.length === 0 && ruleViolations.length === 0 && countsMatch
    && result.unique_ticket_ids === rows.length;
  if (stage === 'U4') {
    const x01 = rejections.find(r => r.event_id === `${runId}-X01`);
    result.x01_ditolak = Boolean(x01);
    result.lulus = result.lulus && result.x01_ditolak && !actual.has(`${runId}-X01`);
  }
  return { result, rows };
}

module.exports = { queueState, checkRun };
