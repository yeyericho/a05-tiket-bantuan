// Dataset sintetis dan daftar ID per uji.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const DATA = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'tiket.json'), 'utf8'));

// "N01-N20,G01" -> ['N01', ..., 'N20', 'G01']
function parseIds(spec) {
  const ids = [];
  for (const part of String(spec).split(',').map(s => s.trim()).filter(Boolean)) {
    const range = part.match(/^([A-Z])(\d{2})-\1(\d{2})$/);
    if (range) {
      const [, prefix, from, to] = range;
      if (Number(from) > Number(to)) throw new Error(`Rentang terbalik: ${part}`);
      for (let n = Number(from); n <= Number(to); n++) ids.push(prefix + String(n).padStart(2, '0'));
    } else if (/^[A-Z]\d{2}$/.test(part)) {
      ids.push(part);
    } else {
      throw new Error(`ID tidak dikenal: ${part}`);
    }
  }
  for (const id of ids) if (!DATA.tiket[id]) throw new Error(`ID ${id} tidak ada di data/tiket.json`);
  return ids;
}

// Himpunan ID valid yang diharapkan sudah punya assignment setelah tiap uji.
const EXPECTED_IDS = {
  U1: parseIds('N01-N20'),
  U2: parseIds('N01-N20,G01-G05'),
  U3: parseIds('N01-N20,G01-G05'),
  U4: parseIds('N01-N20,G01-G05,V01'),
};

function buildPayload(runId, id) {
  const row = DATA.tiket[id];
  const payload = { ticket_id: `TKT-${runId}-${id}`, customer_id: row.customer_id, category: row.category, subject: row.subject };
  if (row._tanpa_ticket_id) delete payload.ticket_id; // X01: field wajib sengaja dihilangkan
  return payload;
}

module.exports = { DATA, parseIds, EXPECTED_IDS, buildPayload };
