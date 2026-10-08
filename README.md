# Sistem Bekalan Air Port Dickson

Laman ini mempunyai dua modul dalam sidebar responsif:

- Sistem Pemantauan Pemulihan Bekalan Air (fungsi sedia ada)
- Demand Bekalan Air Port Dickson (dashboard, carta, direktori dan peta kolam)
- Paparan spreadsheet `KOLAM DETAILS` dan `MASTERLIST` dengan freeze header dan dua kolum pertama
- Lapisan 43 sub-KML kolam mengikut `SUPPLY FROM` / `SECONDARY SUPPLY`

## Uji di VS Code

1. Buka folder projek ini dalam VS Code.
2. Jalankan task **Run Water Supply Prototype** (`Terminal > Run Task`) atau jalankan `npm run dev`.
3. Buka salah satu URL yang dicetak dalam terminal:

   - Admin: `http://127.0.0.1:4173/index_dashboard.html?preview=1`
   - Guest: `http://127.0.0.1:4173/index_dashboard.html?preview=1&level=guest`

Dalam mod admin lokal, perubahan sel disimpan pada browser menggunakan
`localStorage`. Mod guest tidak mempunyai `contenteditable`, butang tambah baris
atau butang simpan. Jalankan `npm run check` untuk menyemak sintaks dan manifest
KML sebelum sebarang deployment.

Jika Worker produksi belum mempunyai action baharu, mod lokal menggunakan tujuh
rekod contoh KOLAM DETAILS daripada paparan rujukan untuk menguji dashboard,
peta, penapis dan edit. MASTERLIST pula menggunakan data recovery semasa sebagai
fallback sehingga endpoint MASTERLIST tersedia.

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
