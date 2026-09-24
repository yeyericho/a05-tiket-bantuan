# Slide presentasi A05 — versi ramah orang awam (maks. 5 slide)

Versi tanpa istilah teknis, memakai perumpamaan kantor layanan. Slide teknis tetap ada di
`SLIDES.md` untuk sesi tanya jawab. Build: `./tools/buat-pdf.sh`.

---

## 1. Masalahnya

::: {.lead}
Pusat bantuan menerima banyak keluhan pelanggan sekaligus. Setiap keluhan harus diteruskan ke bagian yang tepat.
:::

::: {.dua}
::: {.kartu .buruk}
**Tanpa antrean**

Petugas loket harus menunggu keluhan selesai dipilah. Bila pemilah lambat atau berhalangan, loket ikut macet dan pelanggan menunggu lama.
:::
::: {.kartu .baik}
**Yang kami inginkan**

Loket cukup menerima keluhan lalu langsung siap melayani pelanggan berikutnya. Pemilahan berjalan terpisah tanpa ada keluhan yang terlewat.
:::
:::

::: {.istilah}
Semua pelanggan dan keluhan dalam proyek ini fiktif (data latihan).
:::

## 2. Solusinya: kotak antrean

::: {.alur}
[📥 **Loket**<br>menerima keluhan]{.kotak}
[→]{.panah}
[📮 **Kotak antrean**<br>menyimpan dengan aman]{.kotak .utama}
[→]{.panah}
[🧑‍💼 **Petugas pemilah**<br>membaca & memilah]{.kotak}
[→]{.panah}
[📒 **Buku catatan**<br>hasil tersimpan]{.kotak}
:::

::: {.aturan}
Aturan pemilahan yang selalu sama: **tagihan → Keuangan** · **teknis → Tim Teknis** · **lainnya → Layanan Umum**
:::

::: {.istilah}
Istilah teknis: loket = producer · kotak antrean = RabbitMQ (queue `triage`) · petugas pemilah = worker · buku catatan = database PostgreSQL
:::

## 3. Perjalanan satu keluhan

::: {.langkah}
1. **Keluhan masuk dengan nomor unik**, misalnya keluhan tagihan dari pelanggan CUS-001.
2. **Disimpan di kotak antrean.** Kotak memberi tanda terima bahwa keluhan sudah aman.
3. **Petugas pemilah membaca** keluhan itu lalu menentukan bagiannya: tagihan → **Keuangan**.
4. **Dicatat di buku dulu, baru dicentang "selesai".** Bila petugas tiba-tiba pergi sebelum mencentang, keluhan kembali ke kotak dan tidak hilang.
5. **Nomor yang sama tidak dicatat dua kali.** Bila keluhan yang sama terkirim ulang, petugas melihat nomornya sudah ada di buku lalu melewatinya.
:::

::: {.istilah}
Istilah teknis: tanda terima = publisher confirm · centang "selesai" = ack setelah commit · cek nomor = idempotency (inbox)
:::

## 4. Apa yang kami uji

| Situasi yang kami coba | Hasil |
|---|---|
| 20 keluhan biasa masuk | ✅ 20 tercatat di bagian yang benar |
| Petugas pemilah berhenti, lalu 5 keluhan baru datang | ✅ Kelimanya menunggu di kotak dan tidak hilang. Setelah petugas kembali, semuanya diproses (total 25) |
| 5 keluhan lama terkirim ulang | ✅ Tetap 25, tidak ada catatan ganda |
| Satu keluhan rusak (tanpa nomor) | ✅ Disisihkan ke kotak khusus. Keluhan berikutnya tetap diproses (total 26) |

::: {.angka}
[**26**<br>keluhan tercatat]{.stat}
[**0**<br>catatan ganda]{.stat}
[**0**<br>keluhan hilang saat uji]{.stat}
:::

## 5. Kesimpulan dan batasan

::: {.dua}
::: {.kartu .baik}
**Yang sudah terbukti**

- Loket tetap bisa menerima keluhan walau pemilah berhenti
- Keluhan yang menunggu tidak hilang dan diproses saat pemilah kembali
- Keluhan terkirim ulang tidak menimbulkan catatan ganda
- Keluhan rusak disisihkan tanpa mengganggu yang lain
:::
::: {.kartu .netral}
**Batasan yang jujur**

- Ini prototipe latihan dengan data fiktif di satu laptop
- Kami menguji petugas pemilah berhenti dan kotak antrean dinyalakan ulang, belum kerusakan besar seperti disk rusak atau jaringan putus
- Karena itu kami belum mengklaim "dijamin tidak pernah hilang"
:::
:::
