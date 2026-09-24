// Menjalankan skenario uji bersama U1-U4 secara berurutan dan menyimpan bukti.
//   node tools/uji.js --run run01 [--batas 60]
//
// Worker dan producer dijalankan sebagai PROSES TERPISAH (child process);
// skrip ini hanya mengatur urutan, menghentikan/memulihkan worker, dan mencatat observasi.
// Semua bukti ditulis ke bukti/<run>/.
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync, createWriteStream } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const config = require('../src/config');
const { queueState, checkRun } = require('../src/observasi');
const { parseArgs, runIdOf } = require('../src/args');
const { TOPOLOGY } = require('../src/topologi');

const opt = parseArgs();
const runId = runIdOf(opt);
const limitMs = Number(opt.batas || 60) * 1000;
const dir = join(config.ROOT, 'bukti', runId);
mkdirSync(dir, { recursive: true });
const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + '\n');
const say = text => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const commands = [];
const workers = new Set(); // dimatikan saat skrip berakhir, termasuk bila gagal

function node(args, logName) {
  commands.push(`node ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: config.ROOT, env: process.env });
    const out = createWriteStream(join(dir, logName), { flags: 'a' });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('error', reject);
    child.on('exit', code => { out.end(); code === 0 ? resolve() : reject(new Error(`${args.join(' ')} keluar dengan kode ${code}; lihat ${logName}`)); });
  });
}

function startWorker(id) {
  commands.push(`WORKER_ID=${id} node worker.js`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['worker.js'], { cwd: config.ROOT, env: { ...process.env, WORKER_ID: id } });
    workers.add(child);
    child.on('exit', () => workers.delete(child));
    const out = createWriteStream(join(dir, `worker-${id}.log`), { flags: 'a' });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    let buffer = '';
    const onData = chunk => {
      buffer += chunk;
      if (buffer.includes('"ready":true')) { child.stdout.off('data', onData); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.on('exit', code => reject(new Error(`worker ${id} berhenti sebelum siap (kode ${code})`)));
  });
}

function stopWorker(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

async function waitFor(label, fn) {
  const started = Date.now();
  let last;
  while (Date.now() - started < limitMs) {
    last = await fn();
    if (last.ok) return { ...last, waitedMs: Date.now() - started };
    await delay(500);
  }
  throw new Error(`Batas tunggu ${limitMs / 1000} dtk habis saat menunggu: ${label}. Observasi terakhir: ${JSON.stringify(last)}`);
}

async function stageCheck(stage) {
  const { result } = await checkRun(pool, runId, stage);
  return { ok: result.lulus, result };
}

async function duplicates() {
  const r = await pool.query("SELECT count(*)::int AS n FROM ticket_delivery_log WHERE event_id LIKE $1 AND outcome = 'DUPLICATE'", [`${runId}-%`]);
  return r.rows[0].n;
}

async function main() {
  const summary = { run: runId, dimulai: new Date().toISOString(), batas_tunggu_dtk: limitMs / 1000, uji: {} };
  const awal = await queueState();
  save('00-awal-queue.json', awal);
  if (awal[TOPOLOGY.queue].consumers > 0 || awal[TOPOLOGY.queue].ready > 0) {
    throw new Error(`Queue ${TOPOLOGY.queue} tidak bersih (ready=${awal[TOPOLOGY.queue].ready}, consumers=${awal[TOPOLOGY.queue].consumers}). Hentikan worker lain dulu.`);
  }
  const dlqAwal = awal[TOPOLOGY.dlq].ready;

  say('Menyalakan worker w1');
  let worker = await startWorker('w1');

  // U1: 20 event valid.
  say('U1: kirim N01-N20');
  await node(['producer.js', '--run', runId, '--ids', 'N01-N20'], 'producer.log');
  const u1 = await waitFor('U1 = 20 assignment', () => stageCheck('U1'));
  save('U1-cek.json', u1.result);
  summary.uji.U1 = { lulus: true, hasil: u1.result.actual, tunggu_ms: u1.waitedMs };
  say(`U1 lulus: ${JSON.stringify(u1.result.actual)}`);

  // U2: gangguan consumer.
  say('U2: hentikan worker w1 (satu-satunya consumer triage)');
  await stopWorker(worker);
  save('U2-a-sebelum-kirim-queue.json', await queueState());
  say('U2: kirim G01-G05 saat worker mati');
  await node(['producer.js', '--run', runId, '--ids', 'G01-G05'], 'producer.log');
  const tertahan = await waitFor('5 pesan ready di triage', async () => {
    const q = await queueState();
    return { ok: q[TOPOLOGY.queue].ready === 5 && q[TOPOLOGY.queue].consumers === 0, q };
  });
  save('U2-b-saat-gangguan-queue.json', tertahan.q);
  const saatGangguan = (await checkRun(pool, runId, 'U2')).result;
  save('U2-b-saat-gangguan-cek.json', saatGangguan);
  say(`U2: tertahan ready=${tertahan.q[TOPOLOGY.queue].ready}, assignment masih ${saatGangguan.actual.total}`);
  say('U2: pulihkan worker w1 (tanpa kirim ulang manual)');
  worker = await startWorker('w1');
  const u2 = await waitFor('U2 = 25 assignment', () => stageCheck('U2'));
  save('U2-c-sesudah-pulih-cek.json', u2.result);
  save('U2-c-sesudah-pulih-queue.json', await queueState());
  summary.uji.U2 = { lulus: saatGangguan.actual.total === 20 && tertahan.q[TOPOLOGY.queue].ready === 5,
    saat_gangguan: { ready: tertahan.q[TOPOLOGY.queue].ready, consumers: tertahan.q[TOPOLOGY.queue].consumers, assignment: saatGangguan.actual.total },
    hasil: u2.result.actual, tunggu_pulih_ms: u2.waitedMs };
  say(`U2 lulus: ${JSON.stringify(u2.result.actual)}`);

  // U3: replay N01-N05 dengan envelope yang sama persis.
  const dupAwal = await duplicates();
  say('U3: replay N01-N05 (event_id dan payload semula)');
  await node(['producer.js', '--run', runId, '--ids', 'N01-N05', '--replay'], 'producer.log');
  await waitFor('5 delivery DUPLICATE tercatat', async () => ({ ok: (await duplicates()) - dupAwal >= 5 }));
  const u3 = await stageCheck('U3');
  save('U3-cek.json', u3.result);
  summary.uji.U3 = { lulus: u3.ok, hasil: u3.result.actual, duplikat_ditahan: (await duplicates()) - dupAwal };
  if (!u3.ok) throw new Error('U3 gagal: replay mengubah hasil bisnis; lihat U3-cek.json');
  say(`U3 lulus: ${JSON.stringify(u3.result.actual)}, duplikat ditahan ${summary.uji.U3.duplikat_ditahan}`);

  // U4: payload tidak valid X01, lalu V01.
  say('U4: kirim X01 (tanpa ticket_id), lalu V01');
  await node(['producer.js', '--run', runId, '--ids', 'X01'], 'producer.log');
  await node(['producer.js', '--run', runId, '--ids', 'V01'], 'producer.log');
  const u4 = await waitFor('U4 = 26 assignment dan X01 ditolak', () => stageCheck('U4'));
  const q4 = await queueState();
  save('U4-cek.json', u4.result);
  save('U4-queue.json', q4);
  summary.uji.U4 = { lulus: true, hasil: u4.result.actual, x01: u4.result.rejections.find(r => r.event_id === `${runId}-X01`),
    dlq_bertambah: q4[TOPOLOGY.dlq].ready - dlqAwal };
  say(`U4 lulus: ${JSON.stringify(u4.result.actual)}, X01 -> ${summary.uji.U4.x01.reason}`);

  await stopWorker(worker);
  // Simpan CSV assignment akhir sebagai bukti mentah.
  await node(['tools/cek.js', '--run', runId, '--tahap', 'U4', '--simpan'], 'cek.log');
  summary.selesai = new Date().toISOString();
  summary.perintah = commands;
  save('ringkasan.json', summary);
  writeFileSync(join(dir, 'ringkasan.md'), markdown(summary));
  say(`Selesai. Bukti di ${dir}`);
}

function markdown(s) {
  const f = h => `total ${h.total} (FINANCE ${h.FINANCE}, TECH ${h.TECH}, GENERAL ${h.GENERAL})`;
  return `# Ringkasan uji A05 — ${s.run}

Dijalankan ${s.dimulai} s.d. ${s.selesai}. Batas tunggu per langkah ${s.batas_tunggu_dtk} detik.

| Uji | Target | Hasil aktual | Status | Bukti |
|---|---|---|---|---|
| U1 | 20 assignment unik N01–N20 | ${f(s.uji.U1.hasil)} | LULUS | U1-cek.json |
| U2 | 5 pesan menunggu saat worker mati; 25 setelah pulih | saat gangguan: ready=${s.uji.U2.saat_gangguan.ready}, consumers=${s.uji.U2.saat_gangguan.consumers}, assignment=${s.uji.U2.saat_gangguan.assignment}; sesudah pulih: ${f(s.uji.U2.hasil)} | ${s.uji.U2.lulus ? 'LULUS' : 'GAGAL'} | U2-*.json, worker-w1.log |
| U3 | Replay N01–N05 tidak menambah assignment (tetap 25) | ${f(s.uji.U3.hasil)}; ${s.uji.U3.duplikat_ditahan} delivery ditandai DUPLICATE | ${s.uji.U3.lulus ? 'LULUS' : 'GAGAL'} | U3-cek.json |
| U4 | X01 ditolak tanpa efek bisnis; V01 selesai (26) | ${f(s.uji.U4.hasil)}; X01: "${s.uji.U4.x01.reason}"; DLQ +${s.uji.U4.dlq_bertambah} | LULUS | U4-*.json, U4-assignments.csv |

## Perintah yang dijalankan

\`\`\`
${s.perintah.join('\n')}
\`\`\`
`;
}

main()
  .catch(error => { console.error(`GAGAL: ${error.message}`); process.exitCode = 1; })
  .finally(async () => {
    await Promise.all([...workers].map(stopWorker));
    await pool.end();
  });
