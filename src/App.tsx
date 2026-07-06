import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Library from "./components/Library";
import Reader from "./components/Reader";
import { BookRecord, Settings } from "./lib/types";
import { importEpub } from "./lib/epub-utils";
import {
  bookId,
  loadBooks,
  loadSettings,
  removeCachedLocations,
  removeMarks,
  saveBooks,
  saveSettings,
} from "./lib/storage";

export default function App() {
  const [books, setBooks] = useState<BookRecord[]>(() => loadBooks());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [current, setCurrent] = useState<BookRecord | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const booksRef = useRef(books);
  booksRef.current = books;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveBooks(books);
  }, [books]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const addPaths = useCallback(async (paths: string[], openSingle: boolean) => {
    const epubs = paths.filter((p) => p.toLowerCase().endsWith(".epub"));
    if (epubs.length === 0) {
      if (paths.length > 0) setNotice("Hanya file .epub yang bisa dibuka.");
      return;
    }
    setImporting(true);
    let opened = false;
    let added = 0;
    for (const path of epubs) {
      const existing = booksRef.current.find((b) => b.id === bookId(path));
      if (existing) {
        if (openSingle && epubs.length === 1) {
          setCurrent(existing);
          opened = true;
        }
        continue;
      }
      try {
        const record = await importEpub(path);
        setBooks((prev) => [record, ...prev.filter((b) => b.id !== record.id)]);
        added++;
        if (openSingle && epubs.length === 1) {
          setCurrent(record);
          opened = true;
        }
      } catch (e) {
        setNotice(`Gagal membuka ${path.split(/[\\/]/).pop()}: ${String(e)}`);
      }
    }
    if (!opened && added > 0) {
      setNotice(added === 1 ? "1 buku ditambahkan ke rak." : `${added} buku ditambahkan ke rak.`);
    }
    setImporting(false);
  }, []);

  // File yang dibuka lewat "Open with" / klik dua kali file .epub
  useEffect(() => {
    invoke<string | null>("get_launch_file")
      .then((path) => {
        if (path) addPaths([path], true);
      })
      .catch(() => {});
  }, [addPaths]);

  // Seret & lepas file EPUB ke jendela
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over" || event.payload.type === "enter") {
        setDragActive(true);
      } else if (event.payload.type === "drop") {
        setDragActive(false);
        addPaths(event.payload.paths, true);
      } else {
        setDragActive(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addPaths]);

  // Folder pantau: pindai saat mulai dan saat folder diganti
  const scanningRef = useRef(false);
  const scanWatchFolder = useCallback(
    async (dir: string) => {
      if (scanningRef.current) return;
      scanningRef.current = true;
      try {
        const files = await invoke<string[]>("list_epub_files", { dir });
        const fresh = files.filter((p) => !booksRef.current.some((b) => b.id === bookId(p)));
        let added = 0;
        for (const path of fresh) {
          try {
            const record = await importEpub(path);
            setBooks((prev) => [record, ...prev.filter((b) => b.id !== record.id)]);
            added++;
          } catch {
            /* file rusak — lewati */
          }
        }
        if (added > 0) {
          setNotice(`${added} buku baru diimpor dari folder pantau.`);
        }
      } catch (e) {
        setNotice(`Folder pantau: ${String(e)}`);
      }
      scanningRef.current = false;
    },
    []
  );

  useEffect(() => {
    if (settings.watchFolder) scanWatchFolder(settings.watchFolder);
  }, [settings.watchFolder, scanWatchFolder]);

  const pickFiles = useCallback(async () => {
    const selected = await openDialog({
      multiple: true,
      title: "Buka EPUB",
      filters: [{ name: "Buku EPUB", extensions: ["epub"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    addPaths(paths, true);
  }, [addPaths]);

  const pickWatchFolder = useCallback(async () => {
    const dir = await openDialog({ directory: true, title: "Pilih folder pantau" });
    if (typeof dir === "string" && dir) {
      setSettings((s) => ({ ...s, watchFolder: dir }));
    }
  }, []);

  const removeBook = useCallback((id: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== id));
    removeCachedLocations(id);
    removeMarks(id);
  }, []);

  const editBook = useCallback((id: string, patch: Pick<BookRecord, "title" | "author">) => {
    setBooks((prev) => (prev.map((b) => (b.id === id ? { ...b, ...patch } : b))));
  }, []);

  const handleProgress = useCallback((id: string, cfi: string, percent: number) => {
    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, cfi, percent, lastOpened: Date.now() } : b))
    );
  }, []);

  const handleReadTime = useCallback((id: string, seconds: number) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, readingSeconds: (b.readingSeconds ?? 0) + seconds } : b
      )
    );
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <AnimatePresence mode="wait">
          {current ? (
            <Reader
              key={`reader-${current.id}`}
              book={current}
              settings={settings}
              onSettingsChange={setSettings}
              onBack={() => setCurrent(null)}
              onProgress={handleProgress}
              onReadTime={handleReadTime}
            />
          ) : (
            <Library
              key="library"
              books={books}
              importing={importing}
              watchFolder={settings.watchFolder}
              onOpen={(b) => setCurrent(b)}
              onImport={pickFiles}
              onRemove={removeBook}
              onEdit={editBook}
              onPickWatchFolder={pickWatchFolder}
              onClearWatchFolder={() => setSettings((s) => ({ ...s, watchFolder: null }))}
              onRescan={() => settings.watchFolder && scanWatchFolder(settings.watchFolder)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {dragActive && (
            <motion.div
              className="drop-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="drop-card">
                <span className="drop-icon" aria-hidden>
                  ⬇
                </span>
                Lepaskan untuk menambahkan ke rak
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {notice && (
            <motion.div
              className="toast"
              role="status"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              {notice}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
