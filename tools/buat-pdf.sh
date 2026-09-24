#!/usr/bin/env bash
# Membuat dokumen/LAPORAN.pdf, dokumen/SLIDES.pdf, dan dokumen/SLIDES-AWAM.pdf dari Markdown.
# Butuh: pandoc dan Google Chrome (atau set CHROME=/path/ke/chrome).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p dokumen

pandoc LAPORAN.md -s --self-contained -c tools/pdf/laporan.css \
  --metadata pagetitle="Laporan A05 Tiket Bantuan Pelanggan" -o "$TMP/laporan.html"

# Slide: buang catatan pembuka (sampai garis ---), satu bagian "##" = satu halaman.
awk 'f{print} /^---$/{f=1}' SLIDES.md > "$TMP/slides.md"
pandoc "$TMP/slides.md" -s --section-divs --self-contained -c tools/pdf/slides.css \
  --metadata pagetitle="Slide A05 Tiket Bantuan Pelanggan" -o "$TMP/slides.html"
awk 'f{print} /^---$/{f=1}' SLIDES-AWAM.md > "$TMP/slides-awam.md"
pandoc "$TMP/slides-awam.md" -s --section-divs --self-contained -c tools/pdf/slides.css \
  --metadata pagetitle="Slide A05 ramah awam" -o "$TMP/slides-awam.html"

for name in laporan slides slides-awam; do
  out="dokumen/$(echo "$name" | tr a-z A-Z).pdf"
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$PWD/$out" "file://$TMP/$name.html" 2>/dev/null
  echo "dibuat: $out"
done
