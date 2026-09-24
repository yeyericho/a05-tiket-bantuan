# cek02 — pesan menunggu bertahan setelah broker restart

24 September 2026, ~02:00 UTC. Perintah:

```
node producer.js --run cek02 --ids N01-N03     # CONFIRMED 3, tanpa worker
node tools/status.js                            # triage ready=3, consumers=0
docker compose restart rabbitmq ; sleep 15
node tools/status.js                            # triage ready=3, consumers=0
WORKER_ID=w9 node worker.js                     # lihat worker-w9.log: 3 x APPLIED
```

Hasil: ready 3 sebelum dan 3 sesudah restart (queue durable + pesan persistent).
Output status dicatat dari terminal. Log worker pemroses ada di worker-w9.log.
