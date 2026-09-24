// Cocokkan himpunan ID input dengan assignment tersimpan.
//   node tools/cek.js --run run01 --tahap U4 [--simpan]
// Keluar dengan kode 1 bila target belum tercapai.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const config = require('../src/config');
const { checkRun } = require('../src/observasi');
const { parseArgs, runIdOf } = require('../src/args');

async function main() {
  const opt = parseArgs();
  const runId = runIdOf(opt);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const { result, rows } = await checkRun(pool, runId, String(opt.tahap || 'U4'));
    console.log(JSON.stringify(result, null, 2));
    if (opt.simpan) {
      const dir = join(config.ROOT, 'bukti', runId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${result.stage}-cek.json`), JSON.stringify(result, null, 2) + '\n');
      writeFileSync(join(dir, `${result.stage}-assignments.csv`),
        'event_id,ticket_id,category,service_queue,status,worker_id,assigned_at\n' +
        rows.map(r => [r.event_id, r.ticket_id, r.category, r.service_queue, r.status, r.worker_id, r.assigned_at.toISOString()].join(',')).join('\n') + '\n');
      console.error(`disimpan di ${dir}`);
    }
    if (!result.lulus) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
