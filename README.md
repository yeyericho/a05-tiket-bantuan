# A05 — Tiket Bantuan Pelanggan

Capstone MP-11 *Implementasi dan Pengelolaan Message Broker untuk Arsitektur Microservices* (BPPK 2026).
Kasus **A05, pola W (work queue)**: klasifikasi deterministik dan penugasan tiket.

| | |
|---|---|
| Kode kasus | A05 Tiket Bantuan Pelanggan |
| Pola | W: satu queue `triage`, satu peran consumer (worker triage) |
| Anggota | Floribertus Yericho Pramudya (koordinator), Inkka Ruslly Dwitama, Luqman Adhi Kuncoro |
| Kontribusi | Floribertus: desain arsitektur, kontrak event, aturan klasifikasi, producer, README · Inkka: worker triage, skema database, idempotency, jalur penolakan/DLQ, dataset sintetis · Luqman: otomasi uji U1–U4, uji tambahan, bukti, diagnosis gangguan, laporan · Bersama: review kode, laporan, dan slide. Rincian di [LAPORAN.md](LAPORAN.md) bagian 7. |
| Data | Sintetis. Semua pelanggan, tiket, dan subjek fiktif (`data/tiket.json`) |

Pusat bantuan fiktif menerima tiket dan harus mengarahkannya ke antrean layanan. Producer
hanya menerbitkan event `ticket.created`; worker triage mengklasifikasikan tiket dengan
aturan tetap lalu menyimpan satu assignment `ASSIGNED` per tiket di PostgreSQL.

```
Producer tiket → support (direct) → triage → worker → ticket_assignments
                   ticket.created      │ nack(requeue=false)
                                       └→ support.dlx → triage.rejected
```

Aturan klasifikasi (`src/kontrak.js`, versi `r1`): kategori dinormalisasi (trim + huruf kecil),
lalu `billing → FINANCE`, `technical → TECH`, lainnya `→ GENERAL`. FINANCE/TECH/GENERAL
adalah nilai kolom `service_queue`, bukan queue broker tambahan.

Diagram lengkap: [DIAGRAM.md](DIAGRAM.md). Laporan: [LAPORAN.md](LAPORAN.md). Slide: [SLIDES.md](SLIDES.md).

## Prasyarat

- Node.js ≥ 20.6 (diuji dengan v24.15.0)
- Docker Desktop dengan Docker Compose v2 (diuji dengan Docker Engine 29.8.0)
- Port lokal bebas: **5673** (AMQP), **15673** (Management UI), **5442** (PostgreSQL).
  Port ini sengaja berbeda dari `simpel-lab` sehingga keduanya bisa hidup bersamaan.

## Setup, start, uji, stop

```bash
npm install
npm run infra:up          # RabbitMQ 4 + PostgreSQL 16 (menunggu healthy)
npm run siapkan           # buat tabel + deklarasi exchange/queue/binding (idempoten)
npm test                  # uji unit aturan klasifikasi dan kontrak (tanpa broker)
npm run uji -- --run run01    # skenario U1–U4 otomatis, bukti ke bukti/run01/
npm run infra:down        # stop; volume data DIPERTAHANKAN
npm run infra:hapus       # stop + hapus volume (mulai dari nol)
```

Gunakan **prefiks run baru** untuk setiap pengujian baru (`run02`, `run03`, …) supaya bukti tidak
bercampur. Producer menolak mengirim ID yang sudah pernah dikirim pada run yang sama kecuali
dengan `--replay`.

Konfigurasi bawaan sudah cocok dengan `compose.yml`. Untuk broker/DB lain, salin
`.env.contoh` ke `.env` dan ubah `AMQP_URL` / `DATABASE_URL`. Jangan commit `.env`.

## Menjalankan manual (per proses)

Worker dan producer adalah proses terpisah. Buka dua terminal:

```bash
# Terminal 1 — worker (Ctrl+C untuk berhenti dengan rapi)
WORKER_ID=w1 npm run worker

# Terminal 2 — producer dan pemeriksaan
npm run kirim -- --run run02 --ids N01-N20              # U1
npm run cek   -- --run run02 --tahap U1 --simpan

# U2: hentikan worker di Terminal 1, lalu:
npm run kirim  -- --run run02 --ids G01-G05
npm run status -- --run run02 --simpan U2-saat-gangguan # ready=5, consumers=0
# nyalakan lagi worker di Terminal 1, lalu:
npm run cek   -- --run run02 --tahap U2 --simpan

npm run kirim -- --run run02 --ids N01-N05 --replay     # U3
npm run cek   -- --run run02 --tahap U3 --simpan

npm run kirim -- --run run02 --ids X01                  # U4
npm run kirim -- --run run02 --ids V01
npm run cek   -- --run run02 --tahap U4 --simpan
```

`cek` keluar dengan kode 1 bila target belum tercapai. Queue kosong saja tidak dianggap bukti:
`cek` mencocokkan himpunan `event_id` input dengan baris di `ticket_assignments`, memeriksa aturan
per baris, jumlah per layanan, keunikan `ticket_id`, dan (U4) catatan penolakan X01.

Uji tambahan routing (pesan tidak ter-route):

```bash
npm run kirim -- --run run03 --ids V01 --routing-key ticket.typo
# → RETURNED_UNROUTABLE, exit code 1. Kirim ulang dengan routing key benar: --replay
```

## Cara memeriksa hasil

- Management UI: <http://localhost:15673> (user dummy `simpel` / `simpel123`) → Queues → `triage`, `triage.rejected`.
- SQL langsung:

  ```bash
  docker compose exec postgres psql -U simpel -d tiket -c \
    "SELECT service_queue, count(*) FROM ticket_assignments WHERE event_id LIKE 'run01-%' GROUP BY 1"
  ```

## Struktur

```
producer.js          CLI producer (confirm channel, mandatory, envelope disimpan untuk replay)
worker.js            worker triage (validasi → transaksi inbox+assignment → ack)
src/kontrak.js       kontrak event + aturan klasifikasi
src/topologi.js      deklarasi exchange/queue/binding/DLX
src/dataset.js       dataset sintetis + himpunan ID per uji
src/observasi.js     observasi queue (AMQP + Management API) dan pencocokan ID
db/skema.sql         tabel inbox, assignment, rejection, delivery log
data/tiket.json      27 tiket sintetis + target per uji
tools/               siapkan, status, cek, uji (orkestrasi U1–U4)
test/                uji unit node:test
bukti/               bukti per run (input envelope, log, hasil cek, CSV, status queue)
```

## Bukti

| Folder | Isi |
|---|---|
| `bukti/run01/` | Skenario wajib U1–U4, ringkasan di [`ringkasan.md`](bukti/run01/ringkasan.md) |
| `bukti/cek01/` | Uji tambahan: publish dengan routing key salah → `RETURNED_UNROUTABLE` |
| `bukti/cek02/` | Uji tambahan: 3 pesan menunggu tetap ada setelah `docker compose restart rabbitmq` |

## Penggunaan starter, referensi, dan AI

Pola dipakai ulang dari `simpel-lab`: confirm channel + `mandatory` (Lab 3), ack setelah commit
dan DLX untuk kontrak tidak valid (Lab 3), inbox per consumer (Lab 5), urutan diagnosis (Lab 7).
Kode proyek ini ditulis ulang untuk kontrak A05. Kerangka kode dan dokumen disusun dengan bantuan
asisten AI (Claude); peserta bertanggung jawab memahami, menjalankan ulang, dan mempertanggungjawabkan hasilnya.
