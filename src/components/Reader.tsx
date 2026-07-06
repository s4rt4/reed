import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Book, Rendition, NavItem } from "epubjs";
import {
  BookRecord,
  HIGHLIGHT_COLORS,
  Highlight,
  HighlightColorKey,
  Marks,
  Settings,
  ThemeName,
} from "../lib/types";
import { openEpub, readEpubBytes } from "../lib/epub-utils";
import { loadCachedLocations, loadMarks, saveCachedLocations, saveMarks } from "../lib/storage";
import logoUrl from "../assets/logo.svg";

interface Props {
  book: BookRecord;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  onBack: () => void;
  onProgress: (id: string, cfi: string, percent: number) => void;
  onReadTime: (id: string, seconds: number) => void;
}

interface SearchResult {
  cfi: string;
  excerpt: string;
  href: string;
}

const READER_COLORS: Record<ThemeName, { bg: string; ink: string; accent: string }> = {
  paper: { bg: "#f7f5ec", ink: "#26291c", accent: "#6e763d" },
  sepia: { bg: "#f2e8d5", ink: "#443a27", accent: "#7d6a3e" },
  moss: { bg: "#15170f", ink: "#d9d8c6", accent: "#aab26b" },
};

const FONT_STACKS: Record<Settings["fontFamily"], string | null> = {
  book: null,
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Segoe UI', system-ui, sans-serif",
};

let themeSeq = 0;

/** Terapkan tema + tipografi ke konten buku (iframe epub.js). */
function applyStyles(rendition: Rendition, settings: Settings) {
  const c = READER_COLORS[settings.theme];
  const body: Record<string, string> = {
    background: `${c.bg} !important`,
    color: `${c.ink} !important`,
    "line-height": `${settings.lineHeight} !important`,
  };
  const stack = FONT_STACKS[settings.fontFamily];
  if (stack) body["font-family"] = `${stack} !important`;
  if (settings.letterSpacing > 0) body["letter-spacing"] = `${settings.letterSpacing}em !important`;
  // Nama tema harus unik: epub.js tidak memperbarui tema terdaftar dengan nama sama
  const name = `reed-${++themeSeq}`;
  rendition.themes.register(name, {
    body,
    p: { "line-height": "inherit" },
    a: { color: `${c.accent} !important` },
    "a:visited": { color: `${c.accent} !important` },
    "::selection": { background: "#fcffbb" },
  });
  rendition.themes.select(name);
  rendition.themes.fontSize(`${settings.fontSize}%`);
}

function highlightStyle(color: HighlightColorKey): Record<string, string> {
  return {
    fill: HIGHLIGHT_COLORS[color],
    "fill-opacity": "0.45",
    "mix-blend-mode": "multiply",
  };
}

function flattenToc(items: NavItem[], depth = 0): Array<NavItem & { depth: number }> {
  return items.flatMap((item) => [
    { ...item, depth },
    ...flattenToc(item.subitems ?? [], depth + 1),
  ]);
}

function buildMarkdown(book: BookRecord, marks: Marks): string {
  const lines: string[] = [`# ${book.title}`, "", `Penulis: ${book.author}`, ""];
  if (marks.highlights.length > 0) {
    lines.push("## Sorotan", "");
    for (const hl of marks.highlights) {
      lines.push(`> ${hl.text.replace(/\s+/g, " ").trim()}`);
      if (hl.note.trim()) lines.push("", `Catatan: ${hl.note.trim()}`);
      lines.push("");
    }
  }
  if (marks.bookmarks.length > 0) {
    lines.push("## Penanda", "");
    for (const bm of marks.bookmarks) {
      lines.push(`- ${bm.label}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* Ikon garis kecil agar bilah atas konsisten (tanpa emoji berwarna) */
const IcBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </svg>
);
const IcSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);
const IcBookmark = ({ filled }: { filled: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h12V21l-6-4.2L6 21z" />
  </svg>
);
const IcNotes = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M4 6h16M4 12h16M4 18h9" />
  </svg>
);
const IcSpeak = ({ on }: { on: boolean }) =>
  on ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z" fill="currentColor" stroke="none" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );

export default function Reader({
  book,
  settings,
  onSettingsChange,
  onBack,
  onProgress,
  onReadTime,
}: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<Array<NavItem & { depth: number }>>([]);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [percent, setPercent] = useState(book.percent);
  const [locReady, setLocReady] = useState(false);
  const [exact, setExact] = useState(false);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [currentCfi, setCurrentCfi] = useState<string | null>(book.cfi);
  const [marks, setMarks] = useState<Marks>(() => loadMarks(book.id));
  const [selection, setSelection] = useState<{ cfiRange: string; text: string } | null>(null);
  const [focusHl, setFocusHl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  const spineCountRef = useRef(0);
  const spineIndexRef = useRef(0);
  const exactReadyRef = useRef(false);
  const cfiRef = useRef<string | null>(book.cfi);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const langRef = useRef<string | null>(null);
  const ttsActiveRef = useRef(false);
  const searchRunRef = useRef(0);
  const pageControls = useAnimationControls();
  const hideTimer = useRef<number | undefined>(undefined);
  const panelsOpen = useRef(false);
  panelsOpen.current = showToc || showSettings || showMarks || showSearch;

  const wakeChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!panelsOpen.current) setChrome(false);
    }, 2800);
  }, []);

  const closePanels = useCallback(() => {
    setShowToc(false);
    setShowSettings(false);
    setShowMarks(false);
    setShowSearch(false);
  }, []);

  const turn = useCallback(
    async (dir: 1 | -1) => {
      const r = renditionRef.current;
      if (!r) return;
      if (dir === 1) await r.next();
      else await r.prev();
      pageControls.start({
        x: [dir * 22, 0],
        opacity: [0.4, 1],
        transition: { duration: 0.3, ease: "easeOut" },
      });
    },
    [pageControls]
  );
  const turnRef = useRef(turn);
  turnRef.current = turn;

  const hlClick = useCallback((id: string) => {
    setShowMarks(true);
    setFocusHl(id);
    setChrome(true);
  }, []);
  const hlClickRef = useRef(hlClick);
  hlClickRef.current = hlClick;

  // Muat buku — dijalankan ulang bila mode alir (halaman/gulir) berubah
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await readEpubBytes(book.path);
        if (disposed) return;
        const b = openEpub(data);
        bookRef.current = b;
        await b.ready;
        if (disposed || !viewerRef.current) return;

        const rendition = b.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          flow: settingsRef.current.flow === "scrolled" ? "scrolled-doc" : "paginated",
          spread: settingsRef.current.spread ? "auto" : "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        applyStyles(rendition, settingsRef.current);

        rendition.on("relocated", (loc: any) => {
          const cfi: string = loc?.start?.cfi;
          if (!cfi) return;
          let pct: number;
          if (exactReadyRef.current) {
            pct = loc?.start?.percentage ?? 0;
          } else {
            // Perkiraan dari posisi bab di spine + posisi halaman dalam bab —
            // langsung tersedia tanpa memindai seluruh buku
            const idx: number = loc?.start?.index ?? 0;
            const page: number = loc?.start?.displayed?.page ?? 1;
            const total: number = loc?.start?.displayed?.total ?? 1;
            const n = Math.max(1, spineCountRef.current);
            pct = Math.min(1, (idx + (total > 0 ? page / total : 0)) / n);
          }
          cfiRef.current = cfi;
          spineIndexRef.current = loc?.start?.index ?? 0;
          setCurrentCfi(cfi);
          setPercent(pct);
          setCurrentHref(loc?.start?.href ?? null);
          setSelection(null);
          onProgress(book.id, cfi, pct);
        });

        // Klik di konten: tepi kiri/kanan = ganti halaman, tengah = tampilkan bilah
        rendition.on("click", (e: MouseEvent) => {
          if ((e.target as HTMLElement | null)?.closest?.("a")) return;
          if (settingsRef.current.flow === "scrolled") {
            setChrome((v) => !v);
            return;
          }
          const w = e.view?.innerWidth ?? 0;
          if (w && e.clientX < w * 0.3) turnRef.current(-1);
          else if (w && e.clientX > w * 0.7) turnRef.current(1);
          else setChrome((v) => !v);
        });

        // Seleksi teks → tampilkan palet sorotan
        rendition.on("selected", (cfiRange: string, contents: any) => {
          const text: string = contents?.window?.getSelection()?.toString() ?? "";
          if (text.trim()) setSelection({ cfiRange, text: text.trim() });
        });

        rendition.on("keydown", (e: KeyboardEvent) => handleKeyRef.current(e));

        await rendition.display(cfiRef.current ?? book.cfi ?? undefined);
        if (disposed) return;
        setLoading(false);

        // Pasang kembali sorotan tersimpan
        for (const hl of marksRef.current.highlights) {
          rendition.annotations.highlight(
            hl.cfiRange,
            { id: hl.id },
            () => hlClickRef.current(hl.id),
            "reed-hl",
            highlightStyle(hl.color)
          );
        }

        const meta = await b.loaded.metadata;
        langRef.current = meta.language || null;

        const nav = await b.loaded.navigation;
        if (!disposed) setToc(flattenToc(nav.toc));

        // Persentase perkiraan (berbasis spine) langsung aktif untuk semua buku
        const spineItems: Array<{ href: string }> = (b.spine as any)?.spineItems ?? [];
        spineCountRef.current = spineItems.length;
        setLocReady(true);

        // Peta lokasi akurat: dari cache, atau dihitung hanya untuk buku
        // berukuran wajar — buku raksasa tetap pakai perkiraan
        const cached = loadCachedLocations(book.id);
        if (cached) {
          b.locations.load(cached);
          exactReadyRef.current = true;
          setExact(true);
        } else if (spineItems.length <= 200) {
          try {
            await b.locations.generate(600);
            if (disposed) return;
            saveCachedLocations(book.id, b.locations.save());
            exactReadyRef.current = true;
            setExact(true);
          } catch {
            /* gagal menghitung — tetap pakai perkiraan */
          }
        }

        if (exactReadyRef.current) {
          const here = rendition.currentLocation() as any;
          if (here?.start?.cfi) {
            const pct = b.locations.percentageFromCfi(here.start.cfi);
            setPercent(pct);
            onProgress(book.id, here.start.cfi, pct);
          }
        }
      } catch (e) {
        if (!disposed) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(hideTimer.current);
      ttsActiveRef.current = false;
      window.speechSynthesis?.cancel();
      renditionRef.current = null;
      bookRef.current?.destroy();
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, settings.flow]);

  // Terapkan perubahan pengaturan tanpa memuat ulang buku
  useEffect(() => {
    const r = renditionRef.current;
    if (!r || loading) return;
    applyStyles(r, settings);
    if (settings.flow === "paginated") r.spread(settings.spread ? "auto" : "none");
  }, [settings, loading]);

  // Simpan penanda & sorotan
  useEffect(() => {
    saveMarks(book.id, marks);
  }, [book.id, marks]);

  // Catat waktu baca selama jendela aktif
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (document.hasFocus()) onReadTime(book.id, 15);
    }, 15_000);
    return () => window.clearInterval(iv);
  }, [book.id, onReadTime]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        turnRef.current(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        turnRef.current(-1);
      } else if (e.key === "Escape") {
        if (panelsOpen.current) closePanels();
        else onBack();
      }
      wakeChrome();
    },
    [onBack, wakeChrome, closePanels]
  );
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeyRef.current(e);
    window.addEventListener("keydown", listener);
    wakeChrome();
    return () => window.removeEventListener("keydown", listener);
  }, [wakeChrome]);

  const seek = useCallback(
    (fraction: number) => {
      const b = bookRef.current;
      const r = renditionRef.current;
      if (!b || !r || !locReady) return;
      if (exactReadyRef.current) {
        const cfi = b.locations.cfiFromPercentage(fraction);
        if (cfi) r.display(cfi);
      } else {
        // Tanpa peta akurat: lompat ke bab terdekat berdasarkan pecahan spine
        const items: Array<{ href: string }> = (b.spine as any)?.spineItems ?? [];
        if (items.length === 0) return;
        const idx = Math.min(
          items.length - 1,
          Math.max(0, Math.round(fraction * (items.length - 1)))
        );
        r.display(items[idx].href);
      }
    },
    [locReady]
  );

  const goTo = useCallback(
    (href: string) => {
      renditionRef.current?.display(href);
      closePanels();
    },
    [closePanels]
  );

  /* ---- Penanda ---- */
  const bookmarked = !!currentCfi && marks.bookmarks.some((bm) => bm.cfi === currentCfi);

  const chapterLabel = (() => {
    if (!currentHref) return "";
    const base = currentHref.split("#")[0];
    const hit = toc.find((t) => {
      const th = (t.href ?? "").split("#")[0];
      return th === base || th.endsWith(base) || base.endsWith(th);
    });
    return hit?.label?.trim() ?? "";
  })();

  const toggleBookmark = useCallback(() => {
    const cfi = cfiRef.current;
    if (!cfi) return;
    setMarks((prev) => {
      const existing = prev.bookmarks.find((bm) => bm.cfi === cfi);
      if (existing) {
        return { ...prev, bookmarks: prev.bookmarks.filter((bm) => bm.id !== existing.id) };
      }
      const pctLabel = `${exactReadyRef.current ? "" : "≈ "}${Math.round(percent * 100)}%`;
      return {
        ...prev,
        bookmarks: [
          ...prev.bookmarks,
          {
            id: crypto.randomUUID(),
            cfi,
            label: `${chapterLabel || book.title} — ${pctLabel}`,
            createdAt: Date.now(),
          },
        ],
      };
    });
  }, [book.title, chapterLabel, percent]);

  /* ---- Sorotan ---- */
  const clearSelection = useCallback(() => {
    const contents = (renditionRef.current?.getContents() as unknown as any[]) ?? [];
    for (const c of contents) c?.window?.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const addHighlight = useCallback(
    (color: HighlightColorKey) => {
      if (!selection) return;
      const hl: Highlight = {
        id: crypto.randomUUID(),
        cfiRange: selection.cfiRange,
        text: selection.text,
        color,
        note: "",
        createdAt: Date.now(),
      };
      renditionRef.current?.annotations.highlight(
        hl.cfiRange,
        { id: hl.id },
        () => hlClickRef.current(hl.id),
        "reed-hl",
        highlightStyle(color)
      );
      setMarks((prev) => ({ ...prev, highlights: [...prev.highlights, hl] }));
      clearSelection();
    },
    [selection, clearSelection]
  );

  const deleteHighlight = useCallback((hl: Highlight) => {
    try {
      renditionRef.current?.annotations.remove(hl.cfiRange, "highlight");
    } catch {
      /* anotasi belum terpasang di bagian yang sedang dirender */
    }
    setMarks((prev) => ({
      ...prev,
      highlights: prev.highlights.filter((h) => h.id !== hl.id),
    }));
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setMarks((prev) => ({
      ...prev,
      highlights: prev.highlights.map((h) => (h.id === id ? { ...h, note } : h)),
    }));
  }, []);

  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const exportMarks = useCallback(async () => {
    const md = buildMarkdown(book, marksRef.current);
    const path = await saveDialog({
      title: "Ekspor sorotan & catatan",
      defaultPath: `${book.title.replace(/[\\/:*?"<>|]/g, "_")} — catatan.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, contents: md });
      setExportMsg("Tersimpan ✓");
    } catch (e) {
      setExportMsg(String(e));
    }
    setTimeout(() => setExportMsg(null), 2500);
  }, [book]);

  /* ---- Pencarian dalam buku ---- */
  const runSearch = useCallback(async (q: string) => {
    const b = bookRef.current;
    const trimmed = q.trim();
    if (!b || trimmed.length < 2) return;
    const run = ++searchRunRef.current;
    setSearching(true);
    setSearchDone(false);
    setResults([]);
    const items: any[] = (b.spine as any)?.spineItems ?? [];
    const found: SearchResult[] = [];
    for (let i = 0; i < items.length; i++) {
      if (searchRunRef.current !== run) return;
      const item = items[i];
      try {
        await item.load(b.load.bind(b));
        const hits = (item.find(trimmed) ?? []) as Array<{ cfi: string; excerpt: string }>;
        for (const h of hits) found.push({ ...h, href: item.href });
      } catch {
        /* bagian tidak bisa dimuat — lewati */
      } finally {
        item.unload?.();
      }
      if (found.length >= 150) break;
      if (i % 4 === 0) {
        setResults([...found]);
        // beri napas ke UI agar tetap responsif di buku besar
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (searchRunRef.current === run) {
      setResults(found);
      setSearching(false);
      setSearchDone(true);
    }
  }, []);

  const cancelSearch = useCallback(() => {
    searchRunRef.current++;
    setSearching(false);
  }, []);

  const jumpToResult = useCallback(async (res: SearchResult) => {
    const r = renditionRef.current;
    if (!r) return;
    await r.display(res.cfi);
    // Kilatan sorotan sementara di hasil yang dituju
    try {
      r.annotations.highlight(res.cfi, {}, undefined, "reed-flash", {
        fill: "#f2d64b",
        "fill-opacity": "0.65",
      });
      setTimeout(() => {
        try {
          renditionRef.current?.annotations.remove(res.cfi, "highlight");
        } catch {
          /* sudah hilang */
        }
      }, 1800);
    } catch {
      /* cfi tidak bisa disorot — abaikan */
    }
  }, []);

  /* ---- Text-to-speech ---- */
  const stopTts = useCallback(() => {
    ttsActiveRef.current = false;
    setSpeaking(false);
    window.speechSynthesis?.cancel();
  }, []);

  const speakFromHere = useCallback(async () => {
    const r = renditionRef.current;
    const b = bookRef.current;
    if (!r || !b) return;
    while (ttsActiveRef.current) {
      const contents = (r.getContents() as unknown as any[]) ?? [];
      const text: string = contents[0]?.document?.body?.innerText ?? "";
      const chunks = (text.match(/[^.!?…\n]+[.!?…\n]*/g) ?? [text])
        .map((s) => s.trim())
        .filter(Boolean);
      for (const chunk of chunks) {
        if (!ttsActiveRef.current) return;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(chunk);
          if (langRef.current) u.lang = langRef.current;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      }
      if (!ttsActiveRef.current) return;
      // Bab selesai — lanjut ke bagian berikutnya, berhenti di akhir buku
      const items: Array<{ href: string }> = (b.spine as any)?.spineItems ?? [];
      const nextIdx = spineIndexRef.current + 1;
      if (nextIdx >= items.length) {
        stopTts();
        return;
      }
      await r.display(items[nextIdx].href);
      await new Promise((res) => setTimeout(res, 350));
    }
  }, [stopTts]);

  const toggleTts = useCallback(() => {
    if (ttsActiveRef.current) {
      stopTts();
    } else {
      ttsActiveRef.current = true;
      setSpeaking(true);
      speakFromHere();
    }
  }, [speakFromHere, stopTts]);

  const set = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch });

  const focusedHighlights = focusHl
    ? [...marks.highlights].sort((a, b) => (a.id === focusHl ? -1 : b.id === focusHl ? 1 : 0))
    : marks.highlights;

  return (
    <motion.div
      className="reader"
      onMouseMove={wakeChrome}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      {/* Panggung buku: animasi "buku terbuka" saat masuk */}
      <motion.div
        className="reader-stage"
        style={{ left: 64 + settings.margin, right: 64 + settings.margin }}
        initial={{ opacity: 0, rotateY: -7, scale: 0.985, transformPerspective: 1400 }}
        animate={{ opacity: 1, rotateY: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div className="reader-page" animate={pageControls}>
          <div ref={viewerRef} className="reader-viewer" />
        </motion.div>
      </motion.div>

      {loading && (
        <div className="reader-loading">
          <img src={logoUrl} alt="" className="loading-reed" />
          <p>Membuka buku…</p>
        </div>
      )}

      {error && (
        <div className="reader-error">
          <h2>Buku tidak bisa dibuka</h2>
          <p>{error}</p>
          <p className="reader-error-hint">
            Pastikan file masih ada di lokasi semula, lalu coba lagi dari rak.
          </p>
          <button className="btn-primary" onClick={onBack}>
            Kembali ke rak
          </button>
        </div>
      )}

      {/* Bilah atas */}
      <AnimatePresence>
        {chrome && !error && (
          <motion.header
            className="reader-topbar"
            initial={{ y: -56, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -56, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <button className="icon-btn" onClick={onBack} title="Kembali ke rak (Esc)">
              <IcBack />
            </button>
            <div className="reader-titles">
              <span className="reader-book-title">{book.title}</span>
              {chapterLabel && <span className="reader-chapter">{chapterLabel}</span>}
            </div>
            <div className="reader-actions">
              <button
                className={`icon-btn ${showSearch ? "active" : ""}`}
                onClick={() => {
                  const next = !showSearch;
                  closePanels();
                  setShowSearch(next);
                }}
                title="Cari dalam buku"
              >
                <IcSearch />
              </button>
              <button
                className={`icon-btn ${bookmarked ? "active" : ""}`}
                onClick={toggleBookmark}
                title={bookmarked ? "Hapus penanda halaman ini" : "Tandai halaman ini"}
              >
                <IcBookmark filled={bookmarked} />
              </button>
              <button
                className={`icon-btn ${showMarks ? "active" : ""}`}
                onClick={() => {
                  const next = !showMarks;
                  closePanels();
                  setShowMarks(next);
                }}
                title="Penanda & sorotan"
              >
                <IcNotes />
              </button>
              <button
                className={`icon-btn ${speaking ? "active" : ""}`}
                onClick={toggleTts}
                title={speaking ? "Hentikan pembacaan" : "Bacakan mulai bab ini"}
              >
                <IcSpeak on={speaking} />
              </button>
              <button
                className={`icon-btn ${showToc ? "active" : ""}`}
                onClick={() => {
                  const next = !showToc;
                  closePanels();
                  setShowToc(next);
                }}
                title="Daftar isi"
              >
                ☰
              </button>
              <button
                className={`icon-btn ${showSettings ? "active" : ""}`}
                onClick={() => {
                  const next = !showSettings;
                  closePanels();
                  setShowSettings(next);
                }}
                title="Pengaturan tampilan"
              >
                Aa
              </button>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Panah navigasi */}
      <AnimatePresence>
        {chrome && !loading && !error && settings.flow === "paginated" && (
          <>
            <motion.button
              key="prev"
              className="page-arrow page-arrow-left"
              onClick={() => turn(-1)}
              title="Halaman sebelumnya (←)"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
            >
              ‹
            </motion.button>
            <motion.button
              key="next"
              className="page-arrow page-arrow-right"
              onClick={() => turn(1)}
              title="Halaman berikutnya (→)"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
            >
              ›
            </motion.button>
          </>
        )}
      </AnimatePresence>

      {/* Palet sorotan saat teks diseleksi */}
      <AnimatePresence>
        {selection && (
          <motion.div
            className="highlight-bar"
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <span className="highlight-bar-label">Sorot:</span>
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColorKey[]).map((key) => (
              <button
                key={key}
                className="hl-dot"
                style={{ background: HIGHLIGHT_COLORS[key] }}
                onClick={() => addHighlight(key)}
                aria-label={`Sorot dengan warna ${key}`}
              />
            ))}
            <button className="hl-cancel" onClick={clearSelection} aria-label="Batalkan seleksi">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bilah bawah: progres batang reed */}
      <AnimatePresence>
        {chrome && !error && (
          <motion.footer
            className="reader-bottombar"
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <input
              type="range"
              className="stem-slider"
              style={{ "--val": percent * 100 } as CSSProperties}
              min={0}
              max={1000}
              value={Math.round(percent * 1000)}
              disabled={!locReady}
              onChange={(e) => seek(Number(e.currentTarget.value) / 1000)}
              aria-label="Posisi baca"
            />
            <span className="reader-percent">
              {locReady ? `${exact ? "" : "≈ "}${Math.round(percent * 100)}%` : "Memuat…"}
            </span>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* Daftar isi */}
      <AnimatePresence>
        {showToc && (
          <>
            <motion.div
              className="panel-scrim"
              onClick={closePanels}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="toc-panel"
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
            >
              <h2>Daftar isi</h2>
              {toc.length === 0 ? (
                <p className="toc-empty">Buku ini tidak punya daftar isi.</p>
              ) : (
                <ul>
                  {toc.map((item, i) => {
                    const active =
                      !!currentHref &&
                      (item.href ?? "").split("#")[0] === currentHref.split("#")[0];
                    return (
                      <li key={`${item.href}-${i}`} style={{ paddingLeft: item.depth * 14 }}>
                        <button
                          className={`toc-item ${active ? "active" : ""}`}
                          onClick={() => goTo(item.href)}
                        >
                          {item.label?.trim() || "Tanpa judul"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Penanda & sorotan */}
      <AnimatePresence>
        {showMarks && (
          <>
            <motion.div
              className="panel-scrim"
              onClick={() => {
                closePanels();
                setFocusHl(null);
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="marks-panel"
              initial={{ x: 340 }}
              animate={{ x: 0 }}
              exit={{ x: 340 }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
            >
              <div className="marks-head">
                <h2>Penanda & sorotan</h2>
                <button className="btn-ghost" onClick={exportMarks}>
                  {exportMsg ?? "Ekspor .md"}
                </button>
              </div>

              <h3>Penanda</h3>
              {marks.bookmarks.length === 0 ? (
                <p className="marks-empty">
                  Belum ada. Tekan ikon penanda di bilah atas untuk menandai halaman.
                </p>
              ) : (
                <ul className="marks-list">
                  {marks.bookmarks.map((bm) => (
                    <li key={bm.id} className="mark-item">
                      <button className="mark-jump" onClick={() => goTo(bm.cfi)}>
                        {bm.label}
                      </button>
                      <button
                        className="mark-delete"
                        onClick={() =>
                          setMarks((prev) => ({
                            ...prev,
                            bookmarks: prev.bookmarks.filter((x) => x.id !== bm.id),
                          }))
                        }
                        aria-label="Hapus penanda"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Sorotan</h3>
              {marks.highlights.length === 0 ? (
                <p className="marks-empty">
                  Belum ada. Seleksi teks di halaman, lalu pilih warna.
                </p>
              ) : (
                <ul className="marks-list">
                  {focusedHighlights.map((hl) => (
                    <li
                      key={hl.id}
                      className={`mark-item hl-item ${focusHl === hl.id ? "focused" : ""}`}
                    >
                      <span
                        className="hl-swatch"
                        style={{ background: HIGHLIGHT_COLORS[hl.color] }}
                      />
                      <div className="hl-body">
                        <button className="mark-jump" onClick={() => goTo(hl.cfiRange)}>
                          {hl.text.length > 160 ? `${hl.text.slice(0, 160)}…` : hl.text}
                        </button>
                        <textarea
                          className="hl-note"
                          placeholder="Tambah catatan…"
                          value={hl.note}
                          rows={hl.note ? 3 : 1}
                          onChange={(e) => setNote(hl.id, e.currentTarget.value)}
                        />
                      </div>
                      <button
                        className="mark-delete"
                        onClick={() => deleteHighlight(hl)}
                        aria-label="Hapus sorotan"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Pencarian dalam buku */}
      <AnimatePresence>
        {showSearch && (
          <>
            <motion.div
              className="panel-scrim transparent"
              onClick={() => {
                cancelSearch();
                closePanels();
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="search-panel"
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              <div className="search-row">
                <input
                  autoFocus
                  type="search"
                  placeholder="Cari dalam buku… (Enter)"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch(query);
                    if (e.key === "Escape") {
                      cancelSearch();
                      closePanels();
                    }
                  }}
                />
                <button className="btn-primary" onClick={() => runSearch(query)}>
                  Cari
                </button>
              </div>
              {(searching || searchDone) && (
                <p className="search-status">
                  {searching
                    ? `Mencari… ${results.length} hasil sejauh ini`
                    : results.length === 0
                      ? "Tidak ditemukan."
                      : `${results.length}${results.length >= 150 ? "+" : ""} hasil`}
                </p>
              )}
              <ul className="search-results">
                {results.map((res, i) => (
                  <li key={`${res.cfi}-${i}`}>
                    <button className="search-hit" onClick={() => jumpToResult(res)}>
                      {res.excerpt}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Pengaturan tampilan */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              className="panel-scrim transparent"
              onClick={closePanels}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="settings-panel"
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              <div className="setting-row">
                <span className="setting-label">Tema</span>
                <div className="theme-choices">
                  {(
                    [
                      ["paper", "Kertas"],
                      ["sepia", "Sepia"],
                      ["moss", "Lumut"],
                    ] as Array<[ThemeName, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={`theme-chip theme-${value} ${settings.theme === value ? "active" : ""}`}
                      onClick={() => set({ theme: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Ukuran huruf</span>
                <div className="stepper">
                  <button
                    onClick={() => set({ fontSize: Math.max(80, settings.fontSize - 10) })}
                    aria-label="Perkecil huruf"
                  >
                    A−
                  </button>
                  <span>{settings.fontSize}%</span>
                  <button
                    onClick={() => set({ fontSize: Math.min(160, settings.fontSize + 10) })}
                    aria-label="Perbesar huruf"
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Jenis huruf</span>
                <div className="segmented">
                  {(
                    [
                      ["book", "Bawaan buku"],
                      ["serif", "Serif"],
                      ["sans", "Sans"],
                    ] as Array<[Settings["fontFamily"], string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={settings.fontFamily === value ? "active" : ""}
                      onClick={() => set({ fontFamily: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Jarak baris</span>
                <div className="stepper">
                  <button
                    onClick={() =>
                      set({ lineHeight: Math.max(1.3, +(settings.lineHeight - 0.1).toFixed(1)) })
                    }
                    aria-label="Rapatkan baris"
                  >
                    −
                  </button>
                  <span>{settings.lineHeight.toFixed(1)}</span>
                  <button
                    onClick={() =>
                      set({ lineHeight: Math.min(2.2, +(settings.lineHeight + 0.1).toFixed(1)) })
                    }
                    aria-label="Renggangkan baris"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Jarak huruf</span>
                <div className="stepper">
                  <button
                    onClick={() =>
                      set({
                        letterSpacing: Math.max(0, +(settings.letterSpacing - 0.01).toFixed(2)),
                      })
                    }
                    aria-label="Rapatkan huruf"
                  >
                    −
                  </button>
                  <span>{settings.letterSpacing.toFixed(2)} em</span>
                  <button
                    onClick={() =>
                      set({
                        letterSpacing: Math.min(0.08, +(settings.letterSpacing + 0.01).toFixed(2)),
                      })
                    }
                    aria-label="Renggangkan huruf"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Margin</span>
                <div className="stepper">
                  <button
                    onClick={() => set({ margin: Math.max(0, settings.margin - 24) })}
                    aria-label="Persempit margin"
                  >
                    −
                  </button>
                  <span>{settings.margin} px</span>
                  <button
                    onClick={() => set({ margin: Math.min(144, settings.margin + 24) })}
                    aria-label="Perlebar margin"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">Mode baca</span>
                <div className="segmented">
                  <button
                    className={settings.flow === "paginated" ? "active" : ""}
                    onClick={() => set({ flow: "paginated" })}
                  >
                    Berhalaman
                  </button>
                  <button
                    className={settings.flow === "scrolled" ? "active" : ""}
                    onClick={() => set({ flow: "scrolled" })}
                  >
                    Gulir
                  </button>
                </div>
              </div>

              {settings.flow === "paginated" && (
                <div className="setting-row">
                  <span className="setting-label">Tata letak</span>
                  <div className="segmented">
                    <button
                      className={!settings.spread ? "active" : ""}
                      onClick={() => set({ spread: false })}
                    >
                      Satu halaman
                    </button>
                    <button
                      className={settings.spread ? "active" : ""}
                      onClick={() => set({ spread: true })}
                    >
                      Dua halaman
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
