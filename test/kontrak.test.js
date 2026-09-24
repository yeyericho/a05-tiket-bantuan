// Uji unit aturan klasifikasi dan kontrak pesan (tanpa broker/database).
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, validateEvent } = require('../src/kontrak');
const { DATA, EXPECTED_IDS, parseIds, buildPayload } = require('../src/dataset');

const valid = () => ({
  event_id: 'run01-N01', event_type: 'ticket.created', occurred_at: '2026-09-21T02:00:00Z',
  payload: { ticket_id: 'TKT-001', customer_id: 'CUS-001', category: 'billing', subject: 'Permintaan salinan tagihan' },
});

test('aturan: billing->FINANCE, technical->TECH, lainnya->GENERAL', () => {
  assert.equal(classify('billing'), 'FINANCE');
  assert.equal(classify('technical'), 'TECH');
  for (const c of ['account', 'delivery', 'feedback', 'bill', '']) assert.equal(classify(c), 'GENERAL');
});

test('aturan: kategori dinormalisasi (spasi dan huruf besar)', () => {
  assert.equal(classify(' Billing '), 'FINANCE');
  assert.equal(classify('TECHNICAL'), 'TECH');
});

test('kontrak: event valid diterima', () => {
  assert.doesNotThrow(() => validateEvent(valid()));
});

test('kontrak: field wajib yang hilang ditolak dengan alasan jelas', () => {
  const cases = [
    [e => delete e.payload.ticket_id, /ticket_id/],
    [e => delete e.event_id, /event_id/],
    [e => { e.event_type = 'order.created'; }, /event_type/],
    [e => { e.occurred_at = 'kemarin'; }, /occurred_at/],
    [e => delete e.payload.category, /category/],
    [e => { e.payload = null; }, /payload/],
  ];
  for (const [mutate, reason] of cases) {
    const event = valid();
    mutate(event);
    assert.throws(() => validateEvent(event), reason);
  }
});

test('dataset: X01 tidak punya ticket_id dan ditolak kontrak', () => {
  const payload = buildPayload('run01', 'X01');
  assert.equal(payload.ticket_id, undefined);
  assert.throws(() => validateEvent({ ...valid(), event_id: 'run01-X01', payload }), /ticket_id/);
});

test('dataset: target per layanan cocok dengan aturan', () => {
  for (const [stage, ids] of Object.entries(EXPECTED_IDS)) {
    const counts = { FINANCE: 0, TECH: 0, GENERAL: 0 };
    for (const id of ids) counts[classify(DATA.tiket[id].category)]++;
    const target = DATA.harapan[stage];
    assert.deepEqual({ total: ids.length, ...counts }, target, stage);
  }
});

test('dataset: minimal tiga kategori dan ticket_id unik per event valid', () => {
  const ids = EXPECTED_IDS.U4;
  assert.ok(new Set(ids.map(id => DATA.tiket[id].category)).size >= 3);
  assert.equal(new Set(ids.map(id => buildPayload('run01', id).ticket_id)).size, ids.length);
});

test('parseIds: rentang dan daftar', () => {
  assert.deepEqual(parseIds('N01-N03,V01'), ['N01', 'N02', 'N03', 'V01']);
  assert.throws(() => parseIds('N05-N01'));
  assert.throws(() => parseIds('Z99'));
});
