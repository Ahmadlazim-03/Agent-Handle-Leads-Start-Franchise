# WhatsApp AI Lead Gen Agent

Sistem otomatisasi chat berbasis AI untuk menyaring dan mengumpulkan data calon klien (leads) melalui WhatsApp.

## Fitur

- **Filter Leads Baru**: Hanya merespons nomor WhatsApp baru (menghindari duplikasi)
- **No Group/Broadcast Reply**: Otomatis menolak pesan dari grup dan broadcast
- **Conversational AI**: GPT-4o-mini sebagai konsultan franchise dengan gaya percakapan terarah
- **Google Sheets Integration**: Data leads otomatis tersimpan ke spreadsheet
- **Telegram Notification**: Notifikasi real-time ke tim saat lead lengkap
- **Kirim Link Proposal Brand**: Saat user minta proposal brand tertentu, bot kirim link PDF Google Drive secara otomatis
- **Human-like Response**: Delay 2 detik agar respons terlihat natural

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **WhatsApp API**: WAHA (WhatsApp HTTP API)
- **AI Engine**: OpenAI GPT-4o-mini
- **Storage**: Google Sheets API
- **Notification**: Telegram Bot API

## Data Points yang Dikumpulkan

1. **Sumber Info** - Dari mana mereka mengetahui layanan (Google, Instagram, TikTok, dll)
2. **Biodata (Nama & Asal)** - Identitas dasar lead
3. **Bidang Usaha** - Jenis bisnis calon lead
4. **Budget** - Estimasi anggaran
5. **Rencana Mulai** - Timeline eksekusi

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` ke `.env.local` dan isi dengan nilai yang sesuai:

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key dari OpenAI |
| `WAHA_URL` | URL WAHA instance (default: http://localhost:3000) |
| `WAHA_SESSION` | Nama session WAHA (default: default) |
| `WAHA_API_KEY` | API key WAHA (opsional, jika endpoint membutuhkan autentikasi) |
| `WAHA_NEW_LEAD_LABEL_NAME` | Nama label WAHA yang ditempel saat lead complete (default: `Lead Baru`) |
| `WAHA_NEW_LEAD_LABEL_COLOR` | Warna label WAHA (0-19, default: `1`) |
| `BRAND_PROPOSAL_FILES_JSON` | JSON mapping brand ke file proposal PDF Google Drive |
| `BRAND_PROPOSAL_DRIVE_FOLDER_URL` | URL/ID folder Google Drive untuk auto-scan semua file PDF proposal |
| `NEW_LEAD_MAX_USER_MESSAGES` | Batas jumlah pesan user untuk tetap dianggap lead baru (default: 1) |
| `ALLOW_EXISTING_LEADS_FOR_TEST` | Gunakan `false` untuk production; `true` hanya untuk testing |
| `REDIS_URL` | URL koneksi Redis untuk menyimpan/fetch nomor lead |
| `GOOGLE_API_KEY` | API key Google (dipakai juga untuk membaca daftar file PDF dari folder Drive publik) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email service account Google |
| `GOOGLE_PRIVATE_KEY` | Private key dari service account |
| `GOOGLE_SHEET_ID` | ID atau URL spreadsheet Google Sheets |
| `GOOGLE_SHEET_NAME` | Nama tab sheet target (contoh: Informasi Client) |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `TELEGRAM_CHAT_ID` | Chat ID grup/channel Telegram |

### 3. Setup Google Sheets

1. Buat Google Sheet baru dengan header: `Timestamp`, `Sumber Info`, `Biodata`, `Bidang Usaha`, `Budget`, `Rencana Mulai`
2. Buat service account di Google Cloud Console
3. Enable Google Sheets API
4. Download credentials JSON
5. Share spreadsheet dengan email service account

### 4. Setup WAHA

1. Jalankan WAHA instance (Docker atau self-hosted)
2. Scan QR code untuk menghubungkan nomor WhatsApp
3. Jika pakai engine NOWEB, aktifkan store saat create session:
  - `config.noweb.store.enabled=true`
  - `config.noweb.store.fullSync=true`
4. Set webhook URL ke `http://your-domain/api/webhook`

### 4.1 Label Otomatis Setelah Lead Complete

Saat lead sudah lengkap, aplikasi akan:

1. Ambil daftar label dari `GET /api/{session}/labels`
2. Jika label belum ada, buat label via `POST /api/{session}/labels`
3. Tempel label ke chat via `PUT /api/{session}/labels/chats/{chatId}/`

Catatan penting:

- Endpoint labels WAHA aktif di path `/api/{session}/labels` (contoh: `/api/default/labels`)
- Untuk NOWEB, endpoint label butuh store aktif. Jika tidak, WAHA akan balas 400 dengan pesan `Enable NOWEB store`.

### 4.2 Kirim Proposal PDF Brand

Jika user menanyakan proposal brand, sistem akan mendeteksi intent proposal + nama brand lalu mengirim pesan berisi link PDF Google Drive.

Mode katalog proposal yang didukung:

- **Manual mapping** via `BRAND_PROPOSAL_FILES_JSON`.
- **Auto-fetch folder Drive** via `BRAND_PROPOSAL_DRIVE_FOLDER_URL` (sistem scan semua PDF di folder, lalu cocokkan brand dari nama file).

Contoh `BRAND_PROPOSAL_FILES_JSON`:

```bash
BRAND_PROPOSAL_FILES_JSON='{"mixue":"https://drive.google.com/file/d/FILE_ID_MIXUE/view","chatime":{"url":"https://drive.google.com/file/d/FILE_ID_CHATIME/view","aliases":["chat time"],"filename":"chatime-proposal.pdf","caption":"Berikut proposal Chatime ya Kak, setelah dicek lebih cocok paket yang mana"}}'
```

Contoh auto-fetch dari folder Drive:

```bash
BRAND_PROPOSAL_DRIVE_FOLDER_URL=https://drive.google.com/drive/folders/1ATY4ZBZ_TRPwmr8oFVt0o_CDPCEEIxnI?usp=sharing
```

Catatan:

- URL Google Drive format `/file/d/...` akan otomatis dikonversi ke URL download langsung.
- Folder/file proposal harus bisa dibaca publik via link, agar bisa di-list oleh Drive API menggunakan `GOOGLE_API_KEY`.
- Jika brand yang sama ada di `BRAND_PROPOSAL_FILES_JSON` dan folder Drive, mapping JSON akan diprioritaskan.
- Mode kirim link dipakai agar kompatibel dengan WAHA yang belum memiliki fitur `sendFile` (non-Plus).

### 5. Run Development Server

```bash
npm run dev
```

Server berjalan di `http://localhost:3000`

### 5.1 Dashboard Nomor & Kontak WAHA

- Buka dashboard UI di `/dashboard`
- Endpoint data dashboard: `GET /api/dashboard/numbers`
- Aksi manage known number:
  - `POST /api/dashboard/numbers` dengan body `{"action":"mark_known","phoneNumber":"62812..."}`
  - `POST /api/dashboard/numbers` dengan body `{"action":"unmark_known","phoneNumber":"62812..."}`
- Aksi override status lifecycle nomor:
  - `POST /api/dashboard/numbers` body `{"action":"set_status","phoneNumber":"62812...","status":"pernah_chat|proses_bot|selesai_berlabel"}`
  - `POST /api/dashboard/numbers` body `{"action":"clear_status","phoneNumber":"62812..."}`
- Aksi bulk untuk mode production testing:
  - `POST /api/dashboard/numbers` body `{"action":"clear_all_numbers"}` untuk hapus incoming/known/processing/override status + reset conversation state
  - `POST /api/dashboard/numbers` body `{"action":"refetch_contacts"}` untuk fetch ulang WAHA contacts dan seed ulang incoming numbers

Dashboard menampilkan:

1. Tabel lifecycle nomor (Pernah Chat, Proses Bot, Selesai + Berlabel)
2. Semua list nomor yang pernah chat (gabungan Redis incoming/known + WAHA chats + session bot)
3. Status label dan status known per nomor
4. Filter, search, ubah status, dan action bulk reset/refetch langsung dari UI

Contoh loop test production cepat:

1. Klik **Hapus Semua Nomor** di dashboard.
2. Klik **Fetch Ulang Get All Contact** untuk seed ulang nomor dari WAHA.
3. Ubah status manual nomor ke `pernah_chat` bila ingin memaksa nomor tertentu bisa diuji ulang oleh bot.

### 6. Build for Production

```bash
npm run build
npm start
```

## Struktur Folder

```
/src
  /app
    /api
      /webhook
        route.ts      # Webhook handler dari WAHA
  /lib
    openai.ts         # Konfigurasi GPT-4o-mini
    waha.ts           # Fungsi WAHA API (send, history, contact)
    proposals.ts      # Mapping proposal brand dan resolver intent proposal
    sheets.ts         # Integrasi Google Sheets
    telegram.ts       # Push notifikasi Telegram
    store.ts          # In-memory conversation state
  /prompts
    agent.ts          # System prompt & logic AI
```

## Alur Kerja

```
Incoming WhatsApp Message
         ↓
   Webhook (WAHA)
         ↓
   Check: Nomor baru?
    ┌────┴────┐
   No        Yes
    ↓         ↓
 Ignore   AI Conversation
             ↓
   Collect 5 Data Points
             ↓
   Save to Google Sheets + Telegram Notification
```

## Rate Limiting & Security

- Delay 2 detik antar respons AI (terlihat natural)
- Conversation state expired setelah 24 jam
- Hanya nomor baru yang diproses (gatekeeper)

## Testing

Simulasi webhook dengan curl:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "6281234567890@c.us",
    "body": "Halo, saya tertarik dengan layanan Anda",
    "fromMe": false
  }'
```

## License

MIT
#   A g e n t - H a n d l e - L e a d s - S t a r t - F r a n c h i s e 
 
 # leads-agent-startfranchise
