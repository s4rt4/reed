# Reed Pro — Rencana Lengkap (v2)

EPUB reader + creator/editor khusus Linux. Target utama Fedora/GNOME. Tanpa batasan "ringan" — fokus kelengkapan fitur. Open source.

Dokumen ini menggantikan draf awal. Perubahan terhadap draf ditandai dan dirangkum di bagian **Keputusan Kunci**. Referensi visual UI ada di [`docs/reed-ui-mockup.html`](docs/reed-ui-mockup.html) — mockup interaktif yang meniru UI Reed v1 (Tauri) dan menjadi acuan tampilan Reed Pro.

## Keputusan Kunci (revisi dari draf awal)

1. **Rendering pakai foliate-js, bukan engine pagination buatan sendiri.** foliate-js (MIT, dipakai Foliate/GNOME) di-vendor ke dalam QtWebEngine. Pagination, spine, CFI asli, fixed-layout EPUB3 — semuanya sudah jadi. Tidak menulis ulang epub.js/engine sendiri.
2. **Editor MVP adalah source-first, bukan WYSIWYG.** QScintilla + live preview *read-only* (QtWebEngineView). Preseden: Sigil menghapus Book View (WYSIWYG contenteditable) di v1.0 karena merusak markup. WYSIWYG sungguhan ditunda ke Phase 3.
3. **ebooklib hanya untuk jalur import.** `core/epub_model.py` bekerja langsung di atas zip + lxml, edit in-place: file yang tidak disentuh user tidak boleh berubah satu byte pun (prinsip round-trip fidelity ala Sigil).
4. **Lisensi aplikasi: GPL-3.0.** Konsekuensi PyQt6 dan QScintilla (keduanya GPL v3, *bukan* LGPL). Plugin yang mengimpor modul aplikasi ikut terikat GPL.
5. **Validator diposisikan sebagai linter,** bukan pengganti epubcheck. epubcheck eksternal dideteksi saat runtime (seperti pandoc) dan ditawarkan sebagai "Full validation" bila terpasang.
6. **TTS sync per kalimat** via speech-dispatcher (modul `speechd`, SSIP index marks). Sync per kata tidak realistis dengan speech-dispatcher — jangan dijanjikan.
7. **Full-text search pakai SQLite FTS5** (stdlib), bukan indexer buatan sendiri. Bonus: pencarian se-perpustakaan, bukan hanya dalam satu buku.
8. **Anotasi harus tahan edit.** Aplikasi ini juga *mengedit* buku, jadi CFI bisa invalid. Setiap anotasi menyimpan kutipan teks + hash konten dokumen untuk re-anchoring; yang gagal di-anchor ditandai *orphaned*, tidak dibuang.
9. **UI meniru Reed v1.** Design tokens, tema (paper/sepia/moss), ikon SVG garis, dan logo dibawa dari v1. Lihat mockup + bagian **UI & Design Tokens**.

## Stack

- Python 3.12+, PyQt6 (GPL-3.0)
- Rendering buku: **foliate-js** (vendored) di QtWebEngine + QWebChannel
- Editor kode: PyQt6-QScintilla (GPL-3.0)
- Live preview editor: QtWebEngineView (read-only)
- EPUB model/tulis: **zip + lxml langsung** (in-place); ebooklib hanya di importer
- Validasi EPUB: validator kustom (linter, tanpa JRE) + deteksi epubcheck eksternal (opsional)
- Storage: sqlite3 (stdlib) + FTS5
- TTS: speech-dispatcher via modul `speechd` (SSIP, index marks); fallback espeak-ng subprocess tanpa sync
- Kamus: StarDict via `sdcv` (subprocess). ~~pystardict~~ — tidak terawat, dibuang
- Konversi dokumen (import): pandoc subprocess — opsional, deteksi runtime, degrade gracefully
- Spellcheck: Hunspell bawaan QtWebEngine (preview) + hunspell untuk QScintilla
- Packaging: RPM + **COPR** (utama), .deb (sekunder), tanpa Flatpak di v1

**Risiko #1 yang harus diverifikasi sebelum mulai:** ketersediaan `python3-pyqt6-webengine` di repo Fedora target. Kalau tidak dipaket, strategi RPM berubah signifikan (bundle via pip — menyakitkan untuk QtWebEngine).

## Arsitektur Renderer (foliate-js + QWebChannel)

Aset web (foliate-js vendored + `reader.html/css/js`) dimuat QtWebEngineView. Bridge QWebChannel didesain **netral-engine** — kalau suatu saat foliate-js diganti, hanya modul ini yang tersentuh:

```
Python → JS (perintah): open(bookData), display(cfi|href), next(), prev(),
  setTheme(tokens), setTypography(opts), addHighlight(cfiRange, color),
  removeHighlight(cfiRange), search(query), getPositions()
JS → Python (sinyal):   onRelocated(cfi, fraction, section), onSelection(cfiRange, text, rect),
  onTocLoaded(toc), onSearchHit(cfi, excerpt), onClick(), onError(message)
```

Aturan: **tidak ada kode Python yang menyentuh DOM, tidak ada kode JS yang menyentuh disk.** Semua I/O file lewat Python.

## Validator Kustom (`core/validator.py`)

Linter tanpa JRE. Urutan pemeriksaan:

1. `mimetype`: ada, entri pertama di zip, tak terkompresi, isi == `application/epub+zip`
2. `META-INF/container.xml`: ada, XML valid, menunjuk path OPF yang valid
3. OPF: XML valid, Dublin Core wajib ada (title, identifier, language)
4. Manifest: setiap `item href` resolve ke file yang ada di zip
5. Spine: setiap `itemref idref` resolve ke item manifest
6. NCX / nav.xhtml: dirujuk dan resolvable
7. File yatim (ada di zip, tak dirujuk manifest) — warning, bukan error
8. Konten XHTML: well-formed XML (lxml)
9. **[baru]** `id` duplikat di manifest
10. **[baru]** `media-type` tidak cocok dengan ekstensi file
11. **[baru]** `itemref linear` bernilai tidak valid
12. **[baru]** Rujukan resource remote (http/https) di konten — warning
13. **[baru]** `META-INF/encryption.xml` ada → warning (DRM/font obfuscation, tidak didukung editor)

Output: list `{severity: error|warning, code, message, file, line}`. UI: panel daftar bisa diklik → lompat ke posisi kursor di QScintilla. Bila epubcheck terdeteksi di PATH: tombol "Validasi penuh (epubcheck)" menjalankannya di background dan mem-parse output-nya ke format yang sama.

## Struktur Modul

```
reedpro/
  main.py                  # entrypoint, QApplication
  core/
    epub_model.py          # model in-place: zip + lxml, preservasi byte file tak tersentuh
    validator.py           # linter kustom (di atas)
    packager.py            # repack zip, sinkronisasi manifest, mimetype first & stored
    search_index.py        # indexer FTS5 (ekstrak teks spine → db)
  db/
    schema.sql
    library_db.py          # wrapper sqlite: buku, progres, penanda, anotasi, tag, koleksi
    migrations.py          # migrasi berbasis PRAGMA user_version
  reader/
    web/                   # aset webview: foliate-js (vendored, pin versi), reader.html/css/js
    bridge.py              # QWebChannel API netral-engine (di atas)
    library_view.py        # rak buku (grid sampul, progres, cari/urut) — tiru mockup
    reader_view.py         # QtWebEngineView + topbar/bottombar overlay
    toc_panel.py
    annotation_manager.py  # highlight/catatan; re-anchoring via snippet + content_hash
    tts_controller.py      # speechd SSIP, sync per kalimat; fallback espeak-ng
    dictionary_lookup.py   # sdcv subprocess
  editor/
    source_editor.py       # QScintilla: XHTML/CSS, lint gutter
    preview_pane.py        # live preview READ-ONLY (QtWebEngineView), scroll-sync best effort
    metadata_editor.py     # form Dublin Core lengkap
    toc_generator.py       # auto-TOC dari pemindaian heading
    resource_manager.py    # font/CSS/gambar dalam manifest
    undo_stack.py          # QUndoStack lintas-file, termasuk operasi struktural split/merge
  importers/
    ebooklib_import.py     # import/normalisasi via ebooklib (BUKAN jalur edit)
    pandoc_bridge.py       # opsional, subprocess, feature-detect
  settings/
    themes.py              # design tokens (dari v1), tema baca kustom user
    typography.py
  assets/
    logo.svg               # dari v1 (src/assets/logo.svg)
    icons/                 # ikon SVG garis dari v1 (back, search, bookmark, notes, speak, folder)
  packaging/
    reedpro.spec           # RPM/COPR
    debian/                # sekunder
tests/
  fixtures/                # IDPF epub3-samples + EPUB rusak disengaja
docs/
  reed-ui-mockup.html      # mockup interaktif UI v1 — acuan visual
```

Phase 3 menambah: `editor/dual_view_editor.py` (WYSIWYG), `editor/clip_library.py`, `editor/template_engine.py` (Vellum-style), `plugins/plugin_api.py`.

## Skema SQLite

Perbaikan dari draf: PK/UNIQUE yang hilang, `ON DELETE CASCADE`, identitas buku tak bergantung path, re-anchoring anotasi, versioning migrasi, FTS5, dan statistik tanpa konsep "halaman" (tak terdefinisi di reflowable).

```sql
-- PRAGMA foreign_keys = ON;  -- setel di setiap koneksi (default sqlite3: OFF)
-- PRAGMA user_version = 1;   -- naikkan lewat db/migrations.py

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  identifier TEXT,                 -- dc:identifier; file bisa pindah, identitas tidak
  file_hash TEXT,                  -- SHA-256, deteksi file berubah/pindah
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  cover_path TEXT,
  added_at TEXT NOT NULL,          -- ISO-8601 UTC
  last_opened TEXT
);

CREATE TABLE progress (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  cfi TEXT,
  fraction REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE annotations (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi_start TEXT NOT NULL,
  cfi_end TEXT NOT NULL,
  color TEXT NOT NULL,             -- kunci warna: sun|leaf|sky|rose (dari v1)
  note TEXT NOT NULL DEFAULT '',
  text_snippet TEXT NOT NULL DEFAULT '',  -- kutipan utk re-anchoring pasca-edit
  spine_href TEXT,
  content_hash TEXT,               -- hash dokumen saat anotasi dibuat
  orphaned INTEGER NOT NULL DEFAULT 0,    -- 1 = gagal re-anchor, jangan dibuang
  created_at TEXT NOT NULL
);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE book_tags (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE collection_books (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  book_id       INTEGER NOT NULL REFERENCES books(id)       ON DELETE CASCADE,
  PRIMARY KEY (collection_id, book_id)
);

CREATE TABLE reading_sessions (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  chars_read INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE book_fts USING fts5(
  book_id UNINDEXED, spine_href UNINDEXED, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

## UI & Design Tokens (dari Reed v1)

**Acuan tunggal: `docs/reed-ui-mockup.html`** — buka di browser; interaktif (ganti tema, buka panel, ganti layar). Terjemahkan CSS-nya ke QSS untuk chrome Qt; untuk area baca (webview), CSS tema bisa dipakai nyaris apa adanya.

Token inti (tema `paper` / `sepia` / `moss`):

| Token | paper | sepia | moss |
|---|---|---|---|
| `--bg` | `#f7f5ec` | `#f2e8d5` | `#15170f` |
| `--surface` | `#fffdf4` | `#f9f1e0` | `#1e2115` |
| `--ink` | `#23261a` | `#443a27` | `#e3e1cf` |
| `--muted` | `#6f7260` | `#857659` | `#8f927c` |
| `--accent` | `#6e763d` | `#7d6a3e` | `#aab26b` |
| `--accent-deep` | `#333820` | `#4a3f26` | `#d6dda0` |
| `--line` | `#e2dfcd` | `#e0d3b8` | `#33371f` |

- Highlight buku: `--highlight: #fcffbb`. Warna sorotan: sun `#f2d64b`, leaf `#a9c46c`, sky `#86c3d7`, rose `#e59a9a`.
- Font display: **Literata** (fallback Georgia/serif); font UI: **Inter** (fallback system sans). Radius 10px, pill 999px untuk tombol utama/input cari.
- Ikon: **SVG garis stroke `currentColor`, bukan emoji** (preferensi tetap). Set ikon v1 ada di mockup dan `src/components/Reader.tsx:107-141`.
- Di Pro, tema tidak lagi fixed 3 — paper/sepia/moss jadi preset bawaan + user bisa membuat tema sendiri (`settings/themes.py`).

**Aset v1 yang dibawa langsung:**

| Aset | Sumber di repo v1 | Pemakaian di Pro |
|---|---|---|
| Logo | `src/assets/logo.svg` | Logo aplikasi, empty state, loading |
| Ikon app | `src-tauri/icons/icon.png` (+ ukuran lain) | Ikon desktop Linux (`hicolor`) |
| Ikon dokumen .epub | `src-tauri/icons/epub.ico` | Dikonversi PNG/SVG untuk asosiasi MIME `application/epub+zip` |
| Tema baca + tipografi | `src/styles.css` tokens, `applyStyles()` di `Reader.tsx` | CSS webview area baca |
| Model data | `src/lib/types.ts` | Pemetaan langsung ke skema SQLite |

`Reader.tsx` selebihnya menjadi **referensi perilaku UX** (bukan kode yang diport, karena engine-nya foliate-js): auto-hide chrome saat idle, palet sorot muncul saat seleksi, panel TOC kiri / penanda kanan, pencarian tengah-atas, pengaturan kanan-atas, slider progres "batang reed" di bawah.

## Threading & Kinerja

Semua operasi berat berjalan di `QThread`/`QRunnable` + sinyal ke UI — **tidak ada I/O blocking di main thread**: validasi, packaging, indexing FTS, import pandoc, hashing file, pemindaian watch folder, ekstraksi teks TTS. Progress bar / indikator untuk semua operasi > 200 ms.

## Undo/Redo, Autosave, Crash Recovery

- `QUndoStack` tunggal per buku yang dibuka di editor; operasi struktural (split/merge bab, rename resource, hapus file) dimodelkan sebagai command yang reversible — didesain sejak awal, bukan ditempel.
- Autosave snapshot berkala ke direktori kerja (`~/.local/share/reedpro/autosave/`); QtWebEngine crash tidak boleh menghilangkan pekerjaan.
- Simpan = tulis ke file temporer + atomic rename. Tidak pernah menulis langsung menimpa file asli.

## Kompatibilitas Format

- **Baca: EPUB2 dan EPUB3** (mayoritas file di alam liar masih EPUB2; foliate-js menangani keduanya).
- **Tulis/buat: EPUB3** + NCX untuk kompatibilitas mundur.
- Fixed-layout EPUB3: didukung di reader (foliate-js), read-only di editor v1.
- DRM: tidak didukung; terdeteksi → pesan jelas, bukan error misterius.

## Testing & CI

- pytest; target coverage tinggi di `core/` (validator, packager, epub_model round-trip).
- Fixture: [IDPF epub3-samples](https://github.com/IDPF/epub3-samples) + koleksi EPUB rusak disengaja (satu per aturan validator).
- Uji round-trip: buka → simpan tanpa edit → hasil harus identik byte-per-byte (kecuali mimetype ordering yang memang dinormalisasi).
- GitHub Actions: lint (ruff) + pytest di Fedora container; build RPM di CI.

## Fitur

### Reader
- Rak buku: sampul, penulis, progres, waktu baca; cari/urut/tag/koleksi
- Pagination (satu/dua halaman) + mode gulir
- TOC bersarang, bab aktif tersorot
- Tema baca kustom (preset paper/sepia/moss + buatan user)
- Tipografi: font, ukuran, jarak baris, jarak huruf, margin
- Auto-resume + penanda manual
- Pencarian: dalam buku (foliate-js) + se-perpustakaan (FTS5)
- Sorotan multi-warna + catatan; tahan edit (re-anchoring); ekspor Markdown (paritas v1)
- Kamus offline (StarDict/sdcv)
- TTS sync per kalimat (speech-dispatcher)
- Popup catatan kaki inline
- Fixed-layout EPUB3
- Statistik baca (waktu, sesi, karakter)

### Editor — Struktural (Sigil-style)
- **MVP: QScintilla + live preview read-only** (bukan WYSIWYG — lihat Keputusan Kunci #2)
- Auto-TOC dari heading
- Editor metadata Dublin Core lengkap
- Panel validator: klik → lompat ke sumber
- Spellcheck (Hunspell)
- Split/merge bab (undoable)
- Resource manager: font, CSS, gambar

### Editor — Visual (Vellum-style) — Phase 3
- Template front/back matter (judul, kolofon, dedikasi)
- Preview multi-perangkat berdampingan
- Tema gaya se-buku yang bisa ditukar; drop caps, ornamen pemisah adegan
- TOC bergaya otomatis mengikuti tema aktif
- Clip library (snippet reusable)

### Library (Calibre-style)
- Import/konversi via pandoc (opsional, feature-detect)
- Watch folder (paritas v1), bulk import
- Sort/filter/tag/koleksi
- Ambil metadata online — opsional, bisa dimatikan (Open Library API)

### Plugins — Phase 3
- API plugin Python, hook: pre-save, post-import, aksi menu kustom
- Ditunda agar API tidak terkunci sebelum arsitektur internal stabil

## Packaging

- **RPM + COPR** sejak rilis pertama. `Requires:` python3-pyqt6, python3-pyqt6-webengine, python3-lxml, python3-qscintilla-qt6. `Recommends:` (weak deps) sdcv, speech-dispatcher, pandoc, epubcheck — konsisten dengan degrade-gracefully.
- Desktop entry + MIME `application/epub+zip` + ikon dokumen (dari `epub.ico` v1).
- DEB: sekunder, control file mencerminkan deps RPM dengan penamaan Debian.
- Flatpak: tidak di v1; ditinjau ulang bila butuh jangkauan distribusi (runtime KDE menyediakan QtWebEngine, jadi jalannya ada).

## Peta Rilis

**MVP (v1.0)**
- Rak buku (paritas visual v1: grid sampul, progres, cari/urut, watch folder)
- Reader core: foliate-js + bridge (pagination/gulir, TOC, tema, tipografi, resume)
- Validator kustom + panel lompat-ke-error
- Editor source-only (QScintilla) + live preview read-only + undo/redo + autosave
- Editor metadata Dublin Core
- SQLite (skema penuh sejak awal, termasuk FTS5 walau UI pencarian library menyusul)
- RPM + COPR

**Phase 2**
- Sorotan + catatan (re-anchoring) + ekspor Markdown, penanda
- Pencarian dalam buku + se-perpustakaan (FTS5)
- Kamus (sdcv), TTS (sync kalimat), popup catatan kaki
- Fixed-layout di reader; split/merge bab; resource manager; spellcheck
- Tag/koleksi, bulk import, pandoc import, metadata online
- Statistik baca; .deb

**Phase 3**
- WYSIWYG editor sungguhan (dual view)
- Editor visual Vellum-style + template engine + clip library
- Plugin API
- Flatpak (bila diperlukan)

## Risiko Utama

1. `python3-pyqt6-webengine` tidak tersedia/tertinggal di Fedora → verifikasi sebelum mulai.
2. Round-trip fidelity `epub_model.py` — uji byte-identik sejak commit pertama.
3. Re-anchoring anotasi pasca-edit — algoritma pencocokan snippet perlu fuzzy match, batasi scope: exact match → fuzzy → orphaned.
4. foliate-js masih pra-1.0 — pin versi (vendored), tulis adapter di `reader/web/reader.js`, jangan panggil API internalnya dari mana-mana.
