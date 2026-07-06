export interface BookRecord {
  id: string;
  path: string;
  title: string;
  author: string;
  /** Thumbnail sampul sebagai data URL (JPEG kecil), null jika buku tanpa sampul */
  cover: string | null;
  /** Posisi baca terakhir (EPUB CFI) */
  cfi: string | null;
  /** Progres baca 0..1 */
  percent: number;
  /** Akumulasi waktu baca dalam detik */
  readingSeconds: number;
  addedAt: number;
  lastOpened: number;
}

export type ThemeName = "paper" | "sepia" | "moss";

export interface Settings {
  theme: ThemeName;
  /** Persen ukuran huruf, 80–160 */
  fontSize: number;
  fontFamily: "book" | "serif" | "sans";
  lineHeight: number;
  /** Jarak antar huruf dalam em, 0–0.08 */
  letterSpacing: number;
  /** Margin horizontal tambahan area baca dalam px */
  margin: number;
  /** true = dua halaman berdampingan bila jendela cukup lebar */
  spread: boolean;
  /** Berhalaman atau gulir per bab */
  flow: "paginated" | "scrolled";
  /** Folder yang dipindai otomatis untuk EPUB baru */
  watchFolder: string | null;
}

export const defaultSettings: Settings = {
  theme: "paper",
  fontSize: 100,
  fontFamily: "book",
  lineHeight: 1.6,
  letterSpacing: 0,
  margin: 0,
  spread: true,
  flow: "paginated",
  watchFolder: null,
};

export interface Bookmark {
  id: string;
  cfi: string;
  label: string;
  createdAt: number;
}

export interface Highlight {
  id: string;
  cfiRange: string;
  text: string;
  /** Kunci warna dari HIGHLIGHT_COLORS */
  color: HighlightColorKey;
  note: string;
  createdAt: number;
}

export interface Marks {
  bookmarks: Bookmark[];
  highlights: Highlight[];
}

export const HIGHLIGHT_COLORS = {
  sun: "#f2d64b",
  leaf: "#a9c46c",
  sky: "#86c3d7",
  rose: "#e59a9a",
} as const;

export type HighlightColorKey = keyof typeof HIGHLIGHT_COLORS;

export type LibrarySort = "recent" | "title" | "author" | "progress";
