import { invoke } from "@tauri-apps/api/core";
import ePub, { Book } from "epubjs";
import { BookRecord } from "./types";
import { bookId } from "./storage";

/** Baca file EPUB dari disk lewat backend Rust, kembalikan sebagai ArrayBuffer. */
export async function readEpubBytes(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_epub", { path });
}

export function openEpub(data: ArrayBuffer): Book {
  return ePub(data);
}

/** Perkecil sampul jadi thumbnail JPEG (data URL) agar muat di localStorage. */
async function shrinkCover(blobUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("cover load failed"));
      img.src = blobUrl;
    });
    const targetH = 400;
    const scale = Math.min(1, targetH / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

/** Impor file EPUB: baca metadata + sampul, hasilkan BookRecord untuk rak. */
export async function importEpub(path: string): Promise<BookRecord> {
  const data = await readEpubBytes(path);
  const book = openEpub(data);
  try {
    await book.ready;
    const meta = await book.loaded.metadata;
    let cover: string | null = null;
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) cover = await shrinkCover(coverUrl);
    } catch {
      cover = null;
    }
    const fileName = path.replace(/\\/g, "/").split("/").pop() ?? path;
    return {
      id: bookId(path),
      path,
      title: meta.title?.trim() || fileName.replace(/\.epub$/i, ""),
      author: meta.creator?.trim() || "Penulis tidak diketahui",
      cover,
      cfi: null,
      percent: 0,
      readingSeconds: 0,
      addedAt: Date.now(),
      lastOpened: Date.now(),
    };
  } finally {
    book.destroy();
  }
}
