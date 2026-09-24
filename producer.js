// Producer CLI A05: menerbitkan event ticket.created ke exchange support.
//
//   node producer.js --run run01 --ids N01-N20
//   node producer.js --run run01 --ids N01-N05 --replay     # kirim ulang envelope yang sama persis
//   node producer.js --run run01 --ids V01 --routing-key ticket.typo   # uji pesan tidak ter-route
//
// Envelope setiap ID disimpan di bukti/<run>/envelope/<ID>.json SEBELUM publish.
// Replay membaca file itu kembali, sehingga event_id, occurred_at, dan payload identik.
// Publish dianggap berhasil hanya bila broker mengirim confirm (ack) dan pesan
// tidak dikembalikan (basic.return karena mandatory=true dan tidak ada binding).
const amqp = require('amqplib');
const { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const config = require('./src/config');
const { EVENT_TYPE } = require('./src/kontrak');
const { TOPOLOGY, declareTopology } = require('./src/topologi');
const { parseIds, buildPayload } = require('./src/dataset');
const { parseArgs, runIdOf } = require('./src/args');

async function main() {
  const opt = parseArgs();
  const runId = runIdOf(opt);
  if (typeof opt.ids !== 'string') throw new Error('--ids wajib, misal N01-N20 atau G01-G05,V01');
  const ids = parseIds(opt.ids);
  const replay = opt.replay === true || opt.replay === 'true';
  const routingKey = typeof opt['routing-key'] === 'string' ? opt['routing-key'] : TOPOLOGY.routingKey;
  const dir = join(config.ROOT, 'bukti', runId);
  mkdirSync(join(dir, 'envelope'), { recursive: true });

  // Siapkan envelope (baru atau dari arsip untuk replay) sebelum menyentuh broker.
  const envelopes = ids.map(id => {
    const file = join(dir, 'envelope', `${id}.json`);
    if (existsSync(file)) {
      if (!replay) throw new Error(`${id} sudah pernah dikirim pada ${runId}; gunakan --replay atau run baru`);
      return { id, envelope: JSON.parse(readFileSync(file, 'utf8')) };
    }
    if (replay) throw new Error(`--replay: envelope ${id} belum ada di ${file}`);
    const envelope = { event_id: `${runId}-${id}`, event_type: EVENT_TYPE, occurred_at: new Date().toISOString(), payload: buildPayload(runId, id) };
    writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n');
    return { id, envelope };
  });

  const connection = await amqp.connect(config.amqpUrl);
  const channel = await connection.createConfirmChannel();
  await declareTopology(channel);
  const returned = new Set();
  channel.on('return', msg => returned.add(msg.properties.messageId));

  const results = await Promise.all(envelopes.map(({ id, envelope }) => new Promise(resolve => {
    channel.publish(TOPOLOGY.exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
      persistent: true, mandatory: true, contentType: 'application/json',
      messageId: envelope.event_id, type: EVENT_TYPE,
    }, err => {
      // RabbitMQ mengirim basic.return sebelum basic.ack untuk pesan mandatory yang tidak ter-route.
      const result = err ? 'NACKED' : returned.has(envelope.event_id) ? 'RETURNED_UNROUTABLE' : 'CONFIRMED';
      resolve({ at: new Date().toISOString(), id, event_id: envelope.event_id, replay, routingKey, result });
    });
  })));
  await channel.close();
  await connection.close();

  for (const r of results) appendFileSync(join(dir, 'kirim.jsonl'), JSON.stringify(r) + '\n');
  const summary = results.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  console.log(JSON.stringify({ runId, ids: ids.length, replay, routingKey, summary }));
  const failed = results.filter(r => r.result !== 'CONFIRMED');
  if (failed.length) {
    console.error(`Tidak terkonfirmasi: ${failed.map(r => `${r.id}=${r.result}`).join(', ')}. Periksa routing lalu kirim ulang dengan --replay.`);
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
