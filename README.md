# Sistem Bekalan Air Port Dickson

Laman ini mempunyai dua modul dalam sidebar responsif:

- Sistem Pemantauan Pemulihan Bekalan Air (fungsi sedia ada)
- Demand Bekalan Air Port Dickson (dashboard, carta, direktori dan peta kolam)

## Sambungan `KOLAM DETAILS`

Frontend memanggil action Worker berikut:

```json
{"action":"getReservoirData","sheetName":"KOLAM DETAILS","forceRefresh":false}
```

Worker perlu mengembalikan `success`, `headers` dan `data` (array baris). Gunakan
`cloudflare-worker-kolam-snippet.js` sebagai tambahan kepada Worker sedia ada;
jangan gantikan keseluruhan Worker kerana action login dan kemas kini recovery
masih diperlukan. Snippet menggunakan binding sedia ada dan cache lima minit.

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

