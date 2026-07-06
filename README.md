# Reed 🌿

Pembaca EPUB untuk Windows — ringan, modern, dengan installer kecil. Dibangun dengan Tauri 2 + React + epub.js.

## Fitur

- **Rak buku** dengan sampul, penulis, dan progres baca tiap buku
- **Buka EPUB** lewat dialog, seret-lepas ke jendela, atau klik dua kali file `.epub` (asosiasi file otomatis saat instal)
- **Mode baca berhalaman** (satu/dua halaman) dengan animasi transisi
- **Daftar isi** dengan penanda bab aktif
- **3 tema baca**: Kertas, Sepia, Lumut (gelap) — berlaku ke seluruh UI dan isi buku
- **Atur tipografi**: ukuran huruf, jenis huruf, jarak baris
- **Progres tersimpan otomatis** — buku terbuka kembali di posisi terakhir
- **Navigasi keyboard**: `←`/`→`/`PageUp`/`PageDown`/`Spasi` ganti halaman, `Esc` kembali
- Font di-bundle lokal (Literata + Inter) — tidak butuh internet

## Pengembangan

```bash
npm install
npm run tauri dev     # port dev: 1430 (sengaja bukan 1420 agar tidak bentrok app Tauri lain)
```

## Build installer

```bash
npm run tauri build
```

Installer NSIS dihasilkan di `src-tauri/target/release/bundle/nsis/`.

## Struktur

- `src/` — frontend React (rak buku, pembaca, pengaturan)
- `src/lib/` — penyimpanan localStorage, util epub.js
- `src-tauri/` — backend Rust: command `read_epub` (baca file sebagai bytes) dan `get_launch_file` (dukungan "Open with")
