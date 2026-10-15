# Sistem Bekalan Air Port Dickson

Laman ini mempunyai dua modul dalam sidebar responsif:

- Sistem Pemantauan Pemulihan Bekalan Air (fungsi sedia ada)
- Demand Bekalan Air Port Dickson (dashboard, carta, direktori dan peta kolam)
- Paparan spreadsheet `KOLAM DETAILS` dan `MASTERLIST` dengan freeze header dan dua kolum pertama
- Lapisan 43 sub-KML kolam mengikut `SUPPLY FROM` / `SECONDARY SUPPLY`
- Snapshot penuh Google Sheet untuk prototaip lokal: 75 rekod `KOLAM DETAILS` dan 552 rekod `MASTERLIST`
- Sidebar auto-responsif: halakan tetikus ke tepi kiri untuk membukanya pada desktop, atau gunakan butang menu pada telefon
- Kawalan lapisan peta berasingan untuk polygon kolam dan Secondary Supply; polygon kolam aktif secara lalai
- Paparan penuh kolam dibahagikan kepada Maklumat Am (hijau), Kolam Servis (biru) dan Suction Tank (merah)
- Pentadbir boleh menyunting butiran kolam, menyimpan ke Google Sheet dan menggantikan polygon melalui fail `.kml`
- Status seperti `ACTIVE` dan `Active` digabungkan sebagai satu pilihan `Active`
- Medan formula `DEMAND PER DAY (M3)` dikunci daripada suntingan, dan data suction tank menggunakan header `CAPACITY ST (ML)`
- Pentadbir menambah Kolam Balancing atau Kolam Servis melalui popup berpandu. Kod `BR-xxx` / `SR-xxx` dijana automatik, dan Kolam Servis dipautkan kepada Kolam Balancing utama serta kod outlet.
- Setiap jadual mempunyai zoom 50% hingga 175%, nombor turutan, checkbox pilihan baris dan satu butang `PADAM PILIHAN` di bahagian atas. Pemadaman masih memerlukan nama rekod atau frasa pengesahan ditaip semula.
- `KOLAM DETAILS` dan `MASTERLIST` mempunyai ribbon gaya spreadsheet untuk potong/salin/tampal, font, saiz, bold, italic, underline, warna dan penjajaran. Klik kanan pada sel membuka menu konteks berbahasa Inggeris bagi tindakan sel/baris yang lazim, dan scrollbar menegak kekal kelihatan di sebelah kanan jadual.
- Kolum `DUPLICATE` serta kolum formula MASTERLIST L, M dan N dikunci daripada suntingan web.
- Kedua-dua jadual mempunyai scrollbar mendatar di atas dan bawah yang diselaraskan untuk akses cepat ke kolum kiri atau kanan.

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

Arahan ini mengemas kini kesemua 75 rekod `KOLAM DETAILS` dan 552 rekod
`MASTERLIST` berdasarkan kandungan semasa Google Sheet. Worker masih menjadi
sumber utama untuk data produksi selepas deployment. Jika Worker belum mempunyai
action yang diperlukan atau sambungan live gagal, laman GitHub Pages akan
memaparkan snapshot terakhir ini secara automatik dengan label `snapshot` supaya
dashboard tidak bertukar kepada nilai sifar.

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

Suntingan nilai dan format admin dihantar secara batch melalui action `updateSheetCells`. Action
ini mesti diletakkan di belakang semakan token admin Worker sedia ada. Akaun
servis Google juga perlu mempunyai akses Editor kepada fail Sheet.

Penambahan baris baharu menyalin format, dropdown, dan formula daripada baris
rujukan Google Sheet sebelum nilai dimasukkan. Action `deleteSheetRows` menyemak
semula setiap nama pada Google Sheet sebelum membuang baris terpilih dari bawah
ke atas; `deleteSheetRow` kekal sebagai laluan keserasian satu baris. Kedua-dua action mesti
diletakkan di belakang semakan token admin.

Gambar dalam popup tambah kolam menggunakan action `uploadReservoirImage`.
Untuk produksi, cipta folder Google Drive khusus, kongsi folder itu sebagai
Editor kepada akaun servis `GOOGLE_CLIENT_EMAIL`, kemudian tambah ID folder
sebagai binding Worker `DRIVE_FOLDER_ID`. Skop OAuth Worker perlu merangkumi
Google Sheets dan Google Drive seperti dalam `cloudflare-worker-kolam-snippet.js`.
Preview lokal hanya menyimpan pratonton gambar dalam browser; ia tidak memuat
naik fail ke Drive sehingga Worker produksi dikonfigurasi.

Muat naik polygon kolam menggunakan action `saveReservoirKml`, manakala
`getReservoirKmlOverrides` memuatkan semula KML yang telah diganti. Kedua-duanya
menggunakan binding KV `GAS_CACHE` sedia ada. Action simpan KML mesti diletakkan
di belakang semakan token admin yang sama. Dalam preview lokal, perubahan data
dan KML disimpan dalam `localStorage` supaya fungsi boleh diuji sebelum deployment.

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

## Deploy Worker Google Sheet

Worker produksi mengekalkan action login dan recovery asal, kemudian
`scripts/build-integrated-worker.mjs` menyuntik action Demand Bekalan Air yang
terdapat dalam `cloudflare-worker-kolam-snippet.js`. Konfigurasi
`wrangler.worker.toml` mengekalkan KV, jadual 20 minit dan observability.

```powershell
node scripts/build-integrated-worker.mjs --base <worker-asal.js> --output <worker-integrated.js>
npx wrangler deploy <worker-integrated.js> --config wrangler.worker.toml --keep-vars
```

Gunakan `--keep-vars` supaya `GOOGLE_CLIENT_EMAIL`, `SHEET_ID` dan rahsia
`GOOGLE_PRIVATE_KEY` pada Worker tidak dipadam. Selepas deployment, uji sekurang-kurangnya
`getReservoirData`, `getSheetTable`, suntingan `updateSheetCells`, penambahan satu
baris sementara dan pemadaman semula baris tersebut.
