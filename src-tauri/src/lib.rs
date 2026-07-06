use std::path::Path;

/// Membaca file EPUB sebagai bytes mentah, dikirim ke frontend sebagai ArrayBuffer.
#[tauri::command]
fn read_epub(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Gagal membaca file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// File .epub yang diberikan lewat argumen CLI (mis. dibuka lewat "Open with").
#[tauri::command]
fn get_launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".epub") && Path::new(a).exists())
}

/// Daftar file .epub di folder pantau (tidak rekursif).
#[tauri::command]
fn list_epub_files(dir: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Gagal membaca folder: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_epub = path
            .extension()
            .map_or(false, |ext| ext.eq_ignore_ascii_case("epub"));
        if path.is_file() && is_epub {
            files.push(path.to_string_lossy().into_owned());
        }
    }
    files.sort();
    Ok(files)
}

/// Simpan teks ke path pilihan pengguna (dipakai ekspor catatan Markdown).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Gagal menyimpan file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_epub,
            get_launch_file,
            list_epub_files,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
