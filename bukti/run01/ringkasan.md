# Ringkasan uji A05 — run01

Dijalankan 2026-09-24T01:59:01.294Z s.d. 2026-09-24T01:59:03.192Z. Batas tunggu per langkah 60 detik.

| Uji | Target | Hasil aktual | Status | Bukti |
|---|---|---|---|---|
| U1 | 20 assignment unik N01–N20 | total 20 (FINANCE 7, TECH 7, GENERAL 6) | LULUS | U1-cek.json |
| U2 | 5 pesan menunggu saat worker mati; 25 setelah pulih | saat gangguan: ready=5, consumers=0, assignment=20; sesudah pulih: total 25 (FINANCE 9, TECH 9, GENERAL 7) | LULUS | U2-*.json, worker-w1.log |
| U3 | Replay N01–N05 tidak menambah assignment (tetap 25) | total 25 (FINANCE 9, TECH 9, GENERAL 7); 5 delivery ditandai DUPLICATE | LULUS | U3-cek.json |
| U4 | X01 ditolak tanpa efek bisnis; V01 selesai (26) | total 26 (FINANCE 9, TECH 9, GENERAL 8); X01: "payload.ticket_id wajib ada"; DLQ +1 | LULUS | U4-*.json, U4-assignments.csv |

## Perintah yang dijalankan

```
WORKER_ID=w1 node worker.js
node producer.js --run run01 --ids N01-N20
node producer.js --run run01 --ids G01-G05
WORKER_ID=w1 node worker.js
node producer.js --run run01 --ids N01-N05 --replay
node producer.js --run run01 --ids X01
node producer.js --run run01 --ids V01
node tools/cek.js --run run01 --tahap U4 --simpan
```
