# Diagram arsitektur A05

```mermaid
flowchart LR
  P["Producer tiket<br/>(CLI producer.js)"] -- "publish persistent<br/>mandatory, confirm<br/>rk = ticket.created" --> X{{"exchange support<br/>direct, durable"}}
  X -- "binding ticket.created" --> Q[("queue triage<br/>durable<br/>DLX = support.dlx")]
  Q -- "prefetch 4<br/>manual ack" --> W["Worker triage<br/>(worker.js)<br/>aturan r1"]
  W -- "1 transaksi:<br/>inbox + assignment" --> DB[("PostgreSQL<br/>ticket_inbox<br/>ticket_assignments<br/>ticket_delivery_log")]
  W -. "ack SETELAH commit" .-> Q
  W -- "kontrak tidak valid:<br/>catat + nack(requeue=false)" --> DBR[("ticket_rejections")]
  Q -. "dead-letter<br/>rk = rejected" .-> DLX{{"exchange support.dlx<br/>direct"}}
  DLX --> DLQ[("queue triage.rejected<br/>durable, untuk inspeksi")]
  X -. "tanpa binding cocok:<br/>basic.return" .-> P
```

## Alur acknowledgment satu pesan

```
1. Producer menyimpan envelope bukti/<run>/envelope/<ID>.json, publish, menunggu confirm.
   basic.return (tidak ter-route) → gagal; basic.ack → CONFIRMED.
2. Broker menyimpan pesan persistent di queue durable triage.
3. Worker menerima (unacked), memvalidasi kontrak.
   a. Tidak valid → INSERT ticket_rejections + delivery_log(REJECTED); COMMIT; nack(requeue=false) → triage.rejected.
   b. Valid → BEGIN
             INSERT ticket_inbox(event_id) ON CONFLICT DO NOTHING
             baris baru?  ya → INSERT ticket_assignments (service_queue = classify(category), ASSIGNED)
                          tidak → duplikat, tanpa efek bisnis
             INSERT ticket_delivery_log(outcome)
           COMMIT → ack
4. Worker mati sebelum ack → pesan kembali ready, dikirim ulang (redelivered=true) → langkah 3b
   menemukan inbox sudah ada → DUPLICATE → ack. Tidak ada assignment kedua.
5. Error database → ROLLBACK, TIDAK ack, worker berhenti; pesan kembali ready untuk worker berikutnya.
```

## Identitas dan kunci

| Kunci | Arti | Penjaga |
|---|---|---|
| `event_id` (`<run>-<ID>`) | satu kejadian | PK `ticket_inbox`, PK `ticket_assignments` |
| `ticket_id` (`TKT-<run>-<ID>`) | satu tiket bisnis | UNIQUE `ticket_assignments` |
| `messageId` AMQP | sama dengan `event_id` | dipakai producer mencocokkan return/confirm |
