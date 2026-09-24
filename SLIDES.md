# Slide presentasi A05 — versi teknis (maks. 5 slide)

Demo inti ≤ 2 menit: `npm run uji -- --run demo01`, lalu buka `bukti/demo01/ringkasan.md`.
Versi tanpa istilah teknis: `SLIDES-AWAM.md`. Build: `./tools/buat-pdf.sh`.

---

## 1. Masalah

::: {.lead}
Tiket bantuan harus diarahkan ke antrean layanan **FINANCE**, **TECH**, atau **GENERAL** tanpa membuat penerimaan tiket ikut lambat.
:::

::: {.dua}
::: {.kartu .buruk}
**Sinkron (tanpa broker)**

Penerima tiket memanggil pemroses secara langsung. Bila pemroses lambat atau mati, penerimaan ikut tertahan atau gagal.
:::
::: {.kartu .baik}
**Asinkron (dengan broker)**

Penerima hanya menerbitkan event `ticket.created`. Worker memproses secara terpisah dengan **aturan tetap**: billing → FINANCE, technical → TECH, lainnya → GENERAL.
:::
:::

::: {.istilah}
Kasus A05, pola W (work queue). Semua data sintetis/fiktif.
:::

## 2. Desain

::: {.alur}
[**Producer**<br>publish + confirm]{.kotak}
[→]{.panah}
[**Exchange**<br>`support` (direct)]{.kotak}
[→]{.panah}
[**Queue `triage`**<br>durable]{.kotak .utama}
[→]{.panah}
[**Worker**<br>validasi + klasifikasi]{.kotak}
[→]{.panah}
[**PostgreSQL**<br>assignment]{.kotak}
:::

::: {.dua}
::: {.kartu .baik}
**Pesan valid**

Inbox + assignment disimpan dalam **satu transaksi**, lalu pesan di-**ack**.
:::
::: {.kartu .buruk}
**Pesan tidak valid**

Dicatat di `ticket_rejections`, lalu di-**nack** ke `support.dlx` → `triage.rejected` (DLQ).
:::
:::

::: {.istilah}
Exchange = pengarah pesan · queue = antrean · worker = pemroses · ack = konfirmasi selesai · DLQ = antrean pesan gagal
:::

## 3. Satu event sampai efek bisnis

::: {.langkah}
1. **Producer** menyimpan envelope `run01-N01` ke file, lalu publish dengan **confirm + mandatory** agar pesan dipastikan masuk queue.
2. **Broker** menyimpan pesan persistent di queue durable `triage`.
3. **Worker** memvalidasi kontrak, lalu `classify("billing")` → **FINANCE**.
4. **Satu transaksi DB**: cek `event_id` di inbox → simpan assignment `ASSIGNED` → COMMIT → **ack**.
5. **Kirim ulang?** `event_id` sudah ada di inbox, jadi dicatat `DUPLICATE` tanpa assignment kedua.
:::

::: {.istilah}
Crash sebelum ack → broker mengirim ulang pesan (redelivered) → inbox menahan duplikat. Bukti: bukti/run01/worker-w1.log
:::

## 4. Bukti pengujian

| Uji | Skenario | Hasil |
|---|---|---|
| U1 | 20 event valid (N01–N20) | ✅ 20 assignment (7 / 7 / 6) |
| U2 | Worker dihentikan, kirim G01–G05 | ✅ ready=5, consumers=0 → pulih → 25 |
| U3 | Replay N01–N05 (ID dan payload sama) | ✅ Tetap 25, 5 × `DUPLICATE` |
| U4 | X01 tanpa `ticket_id`, lalu V01 | ✅ X01 ke DLQ, V01 diproses → 26 |

::: {.angka}
[**26**<br>assignment unik]{.stat}
[**0**<br>duplikat bisnis]{.stat}
[**1**<br>pesan ke DLQ (X01)]{.stat}
:::

## 5. Kesimpulan dan batasan

::: {.dua}
::: {.kartu .baik}
**Yang sudah terbukti**

- Pesan bertahan saat worker mati dan saat broker restart
- `kill -9` saat proses → redelivered → tetap 1 assignment
- Replay tidak menambah hasil bisnis (idempotent)
- Routing key salah terdeteksi (`basic.return`)
:::
::: {.kartu .netral}
**Batasan**

- Producer tanpa outbox, jadi tidak ada klaim "tanpa kehilangan pesan"
- Single-node; hanya gangguan consumer dan restart broker yang diuji
- At-least-once + idempotent, **bukan** exactly-once end-to-end
- Error DB → worker berhenti, belum ada retry berjeda
:::
:::
