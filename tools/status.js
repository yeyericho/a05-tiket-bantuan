// Tampilkan kondisi queue triage dan triage.rejected (ready/unacked/consumers).
//   node tools/status.js [--run run01 --simpan U2-saat-gangguan]
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const config = require('../src/config');
const { queueState } = require('../src/observasi');
const { parseArgs, runIdOf } = require('../src/args');

async function main() {
  const opt = parseArgs();
  const state = await queueState();
  console.log(JSON.stringify(state, null, 2));
  if (opt.simpan) {
    const dir = join(config.ROOT, 'bukti', runIdOf(opt));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${opt.simpan}-queue.json`);
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    console.error(`disimpan: ${file}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
