import { BookRecord, LibrarySort, Marks, Settings, defaultSettings } from "./types";

const BOOKS_KEY = "reed:books";
const SETTINGS_KEY = "reed:settings";
const SORT_KEY = "reed:sort";

/** Hash pendek dan stabil dari path file, dipakai sebagai id buku. */
export function bookId(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function loadBooks(): BookRecord[] {
  try {
    const raw = localStorage.getItem(BOOKS_KEY);
    if (!raw) return [];
    // Isi field baru dengan default agar data lama tetap valid
    return (JSON.parse(raw) as BookRecord[]).map((b) => ({
      ...b,
      readingSeconds: b.readingSeconds ?? 0,
    }));
  } catch {
    return [];
  }
}

export function saveBooks(books: BookRecord[]) {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadSort(): LibrarySort {
  const raw = localStorage.getItem(SORT_KEY);
  return raw === "title" || raw === "author" || raw === "progress" ? raw : "recent";
}

export function saveSort(sort: LibrarySort) {
  localStorage.setItem(SORT_KEY, sort);
}

/* ---- Penanda & sorotan per buku ---- */

const marksKey = (id: string) => `reed:marks:${id}`;

export function loadMarks(bookId: string): Marks {
  try {
    const raw = localStorage.getItem(marksKey(bookId));
    if (raw) {
      const parsed = JSON.parse(raw) as Marks;
      return { bookmarks: parsed.bookmarks ?? [], highlights: parsed.highlights ?? [] };
    }
  } catch {
    /* data rusak — mulai kosong */
  }
  return { bookmarks: [], highlights: [] };
}

export function saveMarks(bookId: string, marks: Marks) {
  localStorage.setItem(marksKey(bookId), JSON.stringify(marks));
}

export function removeMarks(bookId: string) {
  localStorage.removeItem(marksKey(bookId));
}

/* ---- Cache peta lokasi epub.js ---- */

const locKey = (id: string) => `reed:loc:${id}`;

export function loadCachedLocations(id: string): string | null {
  return localStorage.getItem(locKey(id));
}

export function saveCachedLocations(id: string, json: string) {
  // Jaga kuota localStorage: lewati buku dengan peta lokasi yang sangat besar
  if (json.length < 400_000) {
    try {
      localStorage.setItem(locKey(id), json);
    } catch {
      /* kuota penuh — persentase tetap dihitung ulang saat buka */
    }
  }
}

export function removeCachedLocations(id: string) {
  localStorage.removeItem(locKey(id));
}
