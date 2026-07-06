import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookRecord, LibrarySort } from "../lib/types";
import { loadSort, saveSort } from "../lib/storage";
import logoUrl from "../assets/logo.svg";

interface Props {
  books: BookRecord[];
  importing: boolean;
  watchFolder: string | null;
  onOpen: (book: BookRecord) => void;
  onImport: () => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: Pick<BookRecord, "title" | "author">) => void;
  onPickWatchFolder: () => void;
  onClearWatchFolder: () => void;
  onRescan: () => void;
}

const gridVariants = {
  show: { transition: { staggerChildren: 0.045 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 320, damping: 28 },
  },
};

function formatPercent(p: number): string {
  if (p <= 0) return "Belum dibaca";
  if (p >= 0.995) return "Selesai";
  return `${Math.round(p * 100)}% dibaca`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} j ${m} m` : `${m} m`;
}

const IcFolder = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const SORT_LABELS: Record<LibrarySort, string> = {
  recent: "Terakhir dibaca",
  title: "Judul",
  author: "Penulis",
  progress: "Progres",
};

export default function Library({
  books,
  importing,
  watchFolder,
  onOpen,
  onImport,
  onRemove,
  onEdit,
  onPickWatchFolder,
  onClearWatchFolder,
  onRescan,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>(() => loadSort());
  const [editing, setEditing] = useState<BookRecord | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");

  const changeSort = (s: LibrarySort) => {
    setSort(s);
    saveSort(s);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? books.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q))
      : [...books];
    switch (sort) {
      case "title":
        filtered.sort((a, b) => a.title.localeCompare(b.title, "id"));
        break;
      case "author":
        filtered.sort((a, b) => a.author.localeCompare(b.author, "id"));
        break;
      case "progress":
        filtered.sort((a, b) => b.percent - a.percent);
        break;
      default:
        filtered.sort((a, b) => b.lastOpened - a.lastOpened);
    }
    return filtered;
  }, [books, query, sort]);

  const startEdit = (book: BookRecord) => {
    setEditing(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
  };

  const saveEdit = () => {
    if (!editing) return;
    onEdit(editing.id, {
      title: editTitle.trim() || editing.title,
      author: editAuthor.trim() || "Penulis tidak diketahui",
    });
    setEditing(null);
  };

  const watchFolderName = watchFolder?.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

  return (
    <motion.main
      className="library"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <header className="library-header">
        <div className="brand">
          <img src={logoUrl} alt="" className="brand-logo" />
          <div>
            <h1 className="brand-name">Reed</h1>
            <p className="brand-tag">Rak buku Anda</p>
          </div>
        </div>
        <button className="btn-primary" onClick={onImport} disabled={importing}>
          {importing ? "Memuat…" : "Buka EPUB"}
        </button>
      </header>

      {books.length > 0 && (
        <div className="library-tools">
          <input
            type="search"
            className="lib-search"
            placeholder="Cari judul atau penulis…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <label className="lib-sort">
            Urutkan
            <select value={sort} onChange={(e) => changeSort(e.currentTarget.value as LibrarySort)}>
              {(Object.keys(SORT_LABELS) as LibrarySort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          {watchFolder ? (
            <div className="watch-chip" title={watchFolder}>
              <span>
                <IcFolder /> {watchFolderName}
              </span>
              <button onClick={onRescan} title="Pindai ulang folder">
                ↻
              </button>
              <button onClick={onClearWatchFolder} title="Berhenti memantau folder ini">
                ✕
              </button>
            </div>
          ) : (
            <button className="watch-btn" onClick={onPickWatchFolder}>
              <IcFolder /> Folder pantau…
            </button>
          )}
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty-state">
          <img src={logoUrl} alt="" className="empty-reed" />
          <h2>Rak masih kosong</h2>
          <p>
            Seret file <strong>.epub</strong> ke jendela ini, atau klik{" "}
            <button className="link-btn" onClick={onImport}>
              Buka EPUB
            </button>
            .
          </p>
          <p>
            Bisa juga pilih{" "}
            <button className="link-btn" onClick={onPickWatchFolder}>
              folder pantau
            </button>{" "}
            yang otomatis dipindai untuk EPUB baru.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          <h2>Tidak ada hasil</h2>
          <p>Tidak ada buku yang cocok dengan "{query}".</p>
        </div>
      ) : (
        <motion.ul className="book-grid" variants={gridVariants} initial="hidden" animate="show">
          {shown.map((book) => {
            const duration = formatDuration(book.readingSeconds ?? 0);
            return (
              <motion.li key={book.id} className="book-card" variants={cardVariants}>
                <button
                  className="book-cover-btn"
                  onClick={() => onOpen(book)}
                  aria-label={`Baca ${book.title}`}
                >
                  {book.cover ? (
                    <img src={book.cover} alt="" className="book-cover" />
                  ) : (
                    <span className="book-cover book-cover-placeholder">
                      <span>{book.title}</span>
                    </span>
                  )}
                  <span className="book-cover-sheen" aria-hidden />
                </button>
                <div className="book-card-actions">
                  <button
                    className="book-action"
                    title="Ubah judul & penulis"
                    aria-label={`Ubah metadata ${book.title}`}
                    onClick={() => startEdit(book)}
                  >
                    ✎
                  </button>
                  <button
                    className="book-action"
                    title="Hapus dari rak (file tidak dihapus)"
                    aria-label={`Hapus ${book.title} dari rak`}
                    onClick={() => onRemove(book.id)}
                  >
                    ✕
                  </button>
                </div>
                <div className="book-meta">
                  <h3 className="book-title" title={book.title}>
                    {book.title}
                  </h3>
                  <p className="book-author" title={book.author}>
                    {book.author}
                  </p>
                  <div className="book-progress" aria-hidden>
                    <span
                      className="book-progress-fill"
                      style={{ width: `${book.percent * 100}%` }}
                    />
                  </div>
                  <p className="book-percent">
                    {formatPercent(book.percent)}
                    {duration && ` · ${duration}`}
                  </p>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      <AnimatePresence>
        {editing && (
          <>
            <motion.div
              className="modal-scrim"
              onClick={() => setEditing(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="edit-modal"
              role="dialog"
              aria-label="Ubah metadata buku"
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              <h2>Ubah metadata</h2>
              <label>
                Judul
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                />
              </label>
              <label>
                Penulis
                <input
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                />
              </label>
              <div className="edit-modal-actions">
                <button className="btn-ghost" onClick={() => setEditing(null)}>
                  Batal
                </button>
                <button className="btn-primary" onClick={saveEdit}>
                  Simpan
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.main>
  );
}
