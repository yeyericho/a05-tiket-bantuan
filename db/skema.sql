-- Skema A05 Tiket Bantuan Pelanggan. Idempoten (IF NOT EXISTS).
-- Dijalankan oleh `npm run siapkan`.

-- Inbox: satu baris per event_id yang pernah diterapkan. Pemeriksaan duplikat
-- dan penulisan assignment terjadi dalam SATU transaksi di worker.
CREATE TABLE IF NOT EXISTS ticket_inbox (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hasil bisnis: satu assignment per tiket.
CREATE TABLE IF NOT EXISTS ticket_assignments (
  event_id      TEXT PRIMARY KEY REFERENCES ticket_inbox (event_id),
  ticket_id     TEXT NOT NULL UNIQUE,
  customer_id   TEXT NOT NULL,
  category      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  service_queue TEXT NOT NULL CHECK (service_queue IN ('FINANCE', 'TECH', 'GENERAL')),
  status        TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status = 'ASSIGNED'),
  rule_version  TEXT NOT NULL,
  worker_id     TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jalur penolakan terdokumentasi: pesan kontrak tidak valid dicatat di sini
-- (tanpa efek bisnis), lalu di-nack ke DLQ triage.rejected.
CREATE TABLE IF NOT EXISTS ticket_rejections (
  rejection_key TEXT PRIMARY KEY,           -- event_id bila ada, selain itu sha256 isi pesan
  event_id      TEXT,
  reason        TEXT NOT NULL,
  raw           TEXT NOT NULL,
  rejected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log setiap delivery (termasuk duplikat dan redelivery) sebagai bukti.
-- Jumlah baris di sini boleh lebih besar dari jumlah assignment.
CREATE TABLE IF NOT EXISTS ticket_delivery_log (
  id           BIGSERIAL PRIMARY KEY,
  event_id     TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('APPLIED', 'DUPLICATE', 'DUPLICATE_TICKET', 'REJECTED')),
  redelivered  BOOLEAN NOT NULL,
  worker_id    TEXT NOT NULL,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_delivery_log_event ON ticket_delivery_log (event_id);
