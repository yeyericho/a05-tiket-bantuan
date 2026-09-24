// Kontrak pesan ticket.created dan aturan klasifikasi A05.
// Validasi dilakukan di worker (consumer), sehingga producer dapat menyuntikkan
// X01 untuk menguji jalur penolakan. Aturan ini murni dan diuji di test/.

const EVENT_TYPE = 'ticket.created';
const RULE_VERSION = 'r1';

// Aturan klasifikasi deterministik (panduan A05):
//   billing   -> FINANCE
//   technical -> TECH
//   lainnya   -> GENERAL
// Kategori dinormalisasi (trim + huruf kecil) sebelum dicocokkan.
const RULES = { billing: 'FINANCE', technical: 'TECH' };
const SERVICE_QUEUES = ['FINANCE', 'TECH', 'GENERAL'];

function classify(category) {
  return RULES[String(category).trim().toLowerCase()] || 'GENERAL';
}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`payload.${name} wajib berupa teks 1-${max} karakter`);
  }
}

// Mengembalikan event yang valid atau melempar Error berisi alasan penolakan.
function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Pesan bukan objek JSON');
  if (typeof event.event_id !== 'string' || !ID.test(event.event_id)) throw new Error('event_id wajib dan harus cocok ' + ID);
  if (event.event_type !== EVENT_TYPE) throw new Error(`event_type harus ${EVENT_TYPE}`);
  if (typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at))) {
    throw new Error('occurred_at wajib berupa waktu ISO-8601');
  }
  const p = event.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('payload wajib berupa objek');
  if (typeof p.ticket_id !== 'string' || !ID.test(p.ticket_id)) throw new Error('payload.ticket_id wajib ada');
  if (typeof p.customer_id !== 'string' || !ID.test(p.customer_id)) throw new Error('payload.customer_id wajib ada');
  text(p.category, 'category', 40);
  text(p.subject, 'subject', 200);
  return event;
}

module.exports = { EVENT_TYPE, RULE_VERSION, SERVICE_QUEUES, classify, validateEvent };
