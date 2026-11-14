Optional: SheetJS
=================
Wortboss reads .xlsx files with its own small built-in reader, so this folder may stay empty.

If you prefer SheetJS as the import engine, put ONE file here:

    vendor/xlsx.full.min.js

Download it once from https://cdn.sheetjs.com/ (file "xlsx.full.min.js" of the current version, e.g.
https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js) and save it into this folder.
The app detects it automatically at the next import, and the service worker caches it for offline use.
The import report shows which engine was used ("SheetJS …" or "built-in reader").
