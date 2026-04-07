PRD: WhatsApp AI Lead Gen Agent (Next.js & WAHA)
1. Ringkasan Proyek
Membangun sistem otomatisasi chat berbasis AI untuk menyaring dan mengumpulkan data calon klien (leads) yang menghubungi via WhatsApp secara organik (nomor baru). Sistem akan memvalidasi status nomor melalui infrastruktur WAHA (WhatsApp HTTP API) dan memproses percakapan menggunakan OpenAI GPT-4o-mini.

2. Tujuan Utama
Mengotomatisasi kualifikasi leads 24/7 tanpa intervensi manual di tahap awal.

Memastikan hanya nomor baru yang diproses oleh AI (menghindari duplikasi atau gangguan pada klien lama).

Menyimpan data terstruktur langsung ke Google Sheets dan memberikan notifikasi real-time ke tim via Telegram.

3. Alur Logika & Arsitektur
Sistem akan berjalan menggunakan framework Next.js sebagai pusat kendali (Backend & Webhook Handler).

User Journey & Logic Flow:
Incoming Message: Pesan masuk ke nomor WhatsApp yang terhubung ke WAHA.

Webhook Trigger: WAHA mengirimkan payload ke endpoint Next.js.

Database Check (WAHA API):

Sistem mengecek histori chat/kontak nomor tersebut via API WAHA.

Jika nomor lama: Sistem berhenti (Abaikan).

Jika nomor baru: Lanjut ke proses AI.

AI Interaction (GPT-4o-mini): AI menyapa dan mulai menanyakan informasi yang diperlukan secara natural.

Data Extraction: Setelah 5 poin data terpenuhi, AI melakukan function calling atau mengirim format JSON.

Final Action: Data dikirim ke Google Sheets dan notifikasi push ke Telegram Bot.

4. Spesifikasi Teknis
A. Tech Stack
Framework: Next.js (App Router).

WhatsApp API: WAHA (WhatsApp HTTP API).

AI Engine: OpenAI API (Model: gpt-4o-mini).

Database/Storage: Google Sheets API.

Notification: Telegram Bot API.

B. Kebutuhan Data (Data Points)
Bot wajib mengumpulkan informasi berikut sebelum dinyatakan selesai:

Sumber Info: (Contoh: Google, Instagram, TikTok, dll).

Nama & Kota: Identitas dasar.

Bidang Usaha: Jenis bisnis calon lead.

Budget: Estimasi anggaran.

Rencana Mulai: Timeline eksekusi.

5. Fitur & Fungsionalitas
1. Filter Leads Baru (Gatekeeper)
Bot harus melakukan pengecekan chat_id atau histori pesan melalui endpoint WAHA.

Hanya merespons jika pesan masuk adalah pesan pertama dari nomor tersebut.

2. Conversational AI (GPT-4o-mini)
Prompt Engineering: AI harus berperan sebagai Client Relation Officer yang ramah namun profesional.

Persistence: Jika user memberikan jawaban tidak lengkap, AI harus meminta kembali dengan cara yang sopan.

3. Integrasi Google Sheets
Menggunakan google-spreadsheet library di Next.js.

Setiap kali lead lengkap, tambahkan baris baru (row) secara otomatis.

4. Telegram Notification
Format notifikasi:

New Lead Alert! 🔥

Nama/Kota: [Data]

Usaha: [Data]

Sumber: [Data]

Budget: [Data]

Rencana: [Data]

WA Link: wa.me/[Nomor]

6. Struktur Folder (Next.js)
Untuk memudahkan pengembangan, berikut adalah rekomendasi struktur foldernya:

Plaintext
/src
  /app
    /api
      /webhook
        route.ts      <-- Menerima payload dari WAHA
  /lib
    openai.ts         <-- Konfigurasi GPT-4o-mini
    waha.ts           <-- Fungsi Fetch/Send Message WAHA
    sheets.ts         <-- Integrasi Google Sheets
    telegram.ts       <-- Fungsi Push Notif
  /prompts
    agent.ts          <-- System Role & Logic AI
7. Roadmap Pengembangan
Fase 1: Setup Next.js dan koneksi Webhook ke WAHA.

Fase 2: Implementasi Logika Filter (Hanya nomor baru).

Fase 3: Integrasi OpenAI dengan System Prompt khusus untuk 5 poin data.

Fase 4: Integrasi Google Sheets API & Telegram Bot.

Fase 5: Testing (Uji coba simulasi chat dari nomor baru dan nomor lama).

8. Catatan Keamanan & Batasan
Rate Limiting: Berikan delay antar respons AI (2-3 detik) agar terlihat lebih manusiawi dan menghindari banned.

State Management: Gunakan database ringan (seperti Redis atau database internal WAHA) untuk menyimpan status percakapan agar AI tahu sudah sampai pertanyaan mana.