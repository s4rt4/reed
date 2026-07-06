; Hook NSIS Reed — dijalankan installer setelah semua file terpasang
!macro NSIS_HOOK_POSTINSTALL
  ; Ikon dokumen khusus untuk file .epub (menggantikan ikon exe bawaan
  ; yang didaftarkan APP_ASSOCIATE)
  WriteRegStr SHCTX "Software\Classes\Reed.epub\DefaultIcon" "" "$INSTDIR\icons\epub.ico"
  ; Minta Explorer menyegarkan cache ikon (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
