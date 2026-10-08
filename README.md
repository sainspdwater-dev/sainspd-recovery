# Sistem Bekalan Air Port Dickson

Laman ini mempunyai dua modul dalam sidebar responsif:

- Sistem Pemantauan Pemulihan Bekalan Air (fungsi sedia ada)
- Demand Bekalan Air Port Dickson (dashboard, carta, direktori dan peta kolam)
- Paparan spreadsheet `KOLAM DETAILS` dan `MASTERLIST` dengan freeze header dan dua kolum pertama
- Lapisan 43 sub-KML kolam mengikut `SUPPLY FROM` / `SECONDARY SUPPLY`
- Snapshot penuh Google Sheet untuk prototaip lokal: 74 rekod `KOLAM DETAILS` dan 548 rekod `MASTERLIST`
- Sidebar responsif yang boleh dibuka atau ditutup pada desktop dan telefon

## Uji di VS Code

1. Buka folder projek ini dalam VS Code.
2. Jalankan task **Run Water Supply Prototype** (`Terminal > Run Task`). Task ini
   menggunakan `node` secara terus dan tidak bergantung pada polisi skrip PowerShell.
   Sebagai alternatif, jalankan salah satu arahan berikut dalam terminal Windows:

   ```powershell
   node scripts/dev-server.mjs
   # atau
   npm.cmd run dev
   ```

3. Buka salah satu URL yang dicetak dalam terminal:

   - Admin: `http://127.0.0.1:4173/index_dashboard.html?preview=1`
   - Guest: `http://127.0.0.1:4173/index_dashboard.html?preview=1&level=guest`

Dalam mod admin lokal, perubahan sel disimpan pada browser menggunakan
`localStorage`. Mod guest tidak mempunyai `contenteditable`, butang tambah baris
atau butang simpan. Jalankan task **Check Water Supply Prototype**, atau
`node scripts/check.mjs`, untuk menyemak sintaks dan manifest KML sebelum sebarang
deployment.

Mod lokal menggunakan snapshot penuh Google Sheet di
`assets/prototype-sheet-data.js`. Untuk menyegerakkan semula kedua-dua tab selepas
data Google Sheet berubah, jalankan:

```powershell
node scripts/sync-sheet-data.mjs
```

Arahan yang sama tersedia melalui `Terminal > Run Task > Sync Full Google Sheet Data`.

Arahan ini mengemas kini kesemua 74 rekod `KOLAM DETAILS` dan 548 rekod
`MASTERLIST` berdasarkan kandungan semasa Google Sheet. Worker masih digunakan
untuk data produksi selepas deployment.

## Sambungan `KOLAM DETAILS`

Frontend memanggil action Worker berikut untuk dashboard:

```json
{"action":"getReservoirData","sheetName":"KOLAM DETAILS","forceRefresh":false}
```

Worker perlu mengembalikan `success`, `headers` dan `data` (array baris). Gunakan
`cloudflare-worker-kolam-snippet.js` sebagai tambahan kepada Worker sedia ada;
jangan gantikan keseluruhan Worker kerana action login dan kemas kini recovery
masih diperlukan. Snippet menggunakan binding sedia ada dan cache lima minit.

Paparan spreadsheet turut menggunakan:

```json
{"action":"getSheetTable","sheetName":"MASTERLIST","forceRefresh":false}
```

Suntingan admin dihantar secara batch melalui action `updateSheetCells`. Action
ini mesti diletakkan di belakang semakan token admin Worker sedia ada. Akaun
servis Google juga perlu mempunyai akses Editor kepada fail Sheet.

```json
{
  "success": true,
  "headers": ["RESERVOIR NAME", "SUPPLY FROM"],
  "data": [["Kolam A", "LRA A"]],
  "lastUpdated": "2026-10-08T12:00:00.000Z"
}
```

Untuk menguji antaramuka secara lokal, hidangkan folder ini melalui pelayan HTTP
(bukan terus melalui `file://`) supaya polisi CORS sama seperti GitHub Pages.
