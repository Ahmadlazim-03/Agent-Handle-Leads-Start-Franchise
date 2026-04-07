Testing PRD: WhatsApp AI Lead Gen Agent

1. Ringkasan & Tujuan Pengujian

Fase pengujian ini bertujuan untuk memvalidasi bahwa sistem dapat bertindak sebagai gatekeeper yang akurat, berinteraksi secara natural untuk mengekstraksi 5 poin data utama, dan mengirimkan data tersebut ke Google Sheets serta Telegram tanpa kegagalan sistem.

Fokus Utama Pengujian:

Akurasi filter nomor baru vs. nomor lama.

Kemampuan AI dalam menangani berbagai variasi respons pengguna (lengkap, tidak lengkap, keluar konteks).

Keberhasilan pengiriman data (Payload JSON) ke endpoint eksternal (Sheets & Telegram).

Stabilitas State Management dan batas limitasi (delay).

2. Persiapan Lingkungan Uji (Test Environment)

Sebelum pengujian dimulai, pastikan komponen berikut telah disiapkan:

WAHA Test Instance: Menggunakan nomor WhatsApp khusus testing (bukan nomor produksi).

Test Devices: Minimal 3 nomor handphone berbeda untuk mensimulasikan pengguna (1 nomor yang sudah ada di histori chat, 2 nomor benar-benar baru).

Google Sheets Testing: Spreadsheet terpisah dari production dengan kolom yang sudah disiapkan: Timestamp, Sumber, Nama & Kota, Bidang Usaha, Budget, Rencana Mulai, Nomor WA.

Telegram Sandbox: Grup atau channel Telegram khusus testing yang sudah terhubung dengan Bot.

Monitoring Tools: Terminal atau log Next.js dibiarkan terbuka untuk memantau payload Webhook dan respons JSON dari OpenAI API.

3. Skenario Pengujian Utama (Test Cases)

Kategori A: Logika Filter (Gatekeeper)

Fokus: Memastikan sistem tidak mengganggu klien lama dan hanya merespons leads baru.

ID Test

Skenario

Langkah Pengujian

Ekspektasi Hasil (Expected Result)

TC-A1

Interaksi Nomor Lama

Kirim pesan "Halo" dari nomor yang sudah ada di histori chat WAHA.

Sistem tidak merespons sama sekali. Log Next.js menunjukkan status Ignored: Existing Contact.

TC-A2

Interaksi Nomor Baru

Kirim pesan "Halo" dari nomor yang belum pernah menghubungi sama sekali.

Sistem merespons dengan sapaan awal dari agen AI.

Kategori B: Interaksi AI & Ekstraksi Data (Prompt & State)

Fokus: Menguji kelihaian GPT-4o-mini dalam menjaga konteks percakapan dan mengekstrak 5 Data Points.

ID Test

Skenario

Langkah Pengujian

Ekspektasi Hasil (Expected Result)

TC-B1

Happy Path (Lancar)

Jawab setiap pertanyaan AI secara langsung dan lengkap satu per satu sesuai alur.

AI menanyakan pertanyaan berikutnya secara berurutan. Di akhir, AI menutup percakapan dengan sopan dan men-trigger fungsi simpan data.

TC-B2

Over-providing (Borongan)

Berikan 3 info sekaligus di pesan pertama: "Halo saya Budi dari Jakarta, mau buat web untuk bisnis sepatu saya."

AI mengenali dan mencatat 3 poin tersebut. AI hanya menanyakan 2 poin sisanya (contoh: Budget & Rencana mulai).

TC-B3

Under-providing (Tidak Jelas)

Saat ditanya budget, jawab dengan ambigu: "Belum tahu nih, saran aja".

AI merespons dengan empatik, memberikan estimasi/opsi kisaran, dan membimbing user untuk memilih tanpa terdengar memaksa (sesuai system prompt).

TC-B4

Out of Context (Keluar Topik)

Di tengah alur tanya jawab, user bertanya: "Kantor kalian di mana ya?"

AI menjawab pertanyaan tentang kantor secara singkat, lalu dengan luwes mengarahkan kembali ke pertanyaan target yang belum terjawab.

Kategori C: Integrasi End-to-End (Sheets & Telegram)

Fokus: Memastikan Function Calling / Output JSON AI berhasil diproses oleh Backend Next.js.

ID Test

Skenario

Langkah Pengujian

Ekspektasi Hasil (Expected Result)

TC-C1

Write to Google Sheets

Selesaikan 5 pertanyaan hingga AI menutup percakapan. Cek Google Sheets Testing.

Baris (row) baru ditambahkan seketika dengan pemetaan data ke kolom yang tepat sasaran (tidak tertukar).

TC-C2

Push Notification Telegram

Selesaikan 5 pertanyaan. Cek grup Telegram Sandbox.

Pesan masuk dengan format rapi. Tautan wa.me/[Nomor] valid, bisa diklik, dan langsung membuka chat ke nomor penguji.

Kategori D: Kinerja & Keamanan (Performance & Safety)

Fokus: Memastikan rate limiting dan manajemen state konkuren berjalan mulus.

ID Test

Skenario

Langkah Pengujian

Ekspektasi Hasil (Expected Result)

TC-D1

Human-like Delay

Hitung/perhatikan waktu antara pesan dikirim oleh user hingga pesan balasan AI masuk di WA user.

Ada jeda wajar sekitar 2-4 detik. Pesan AI tidak muncul secara instan di milidetik yang sama untuk mencegah deteksi bot spam.

TC-D2

Concurrent Sessions (Simultan)

Kirim pesan dari Nomor Baru A dan Nomor Baru B secara bersamaan di detik yang sama.

Sistem merespons kedua nomor secara independen. State (riwayat/jawaban) Nomor A tidak bocor atau tertukar ke Nomor B.

4. Kriteria Keberhasilan (Definition of Done)

Fase pengujian dianggap selesai dan siap untuk di-deploy ke lingkungan Production apabila:

0% False Positive pada Gatekeeper: Tidak ada satupun pesan otomatis dari AI yang terkirim ke nomor klien lama/eksisting.

100% Data Extraction Accuracy: JSON yang di-generate oleh model GPT-4o-mini ter-parsing dengan benar oleh sistem Next.js tanpa memicu error tipe data (tidak ada undefined atau null di kolom wajib pada Sheets).

Konkurensi Aman: Sistem terbukti mampu menangani setidaknya 3 sesi chat dari nomor baru yang berbeda secara bersamaan tanpa mengalami crash atau memory leak pada manajemen state-nya.

5. Prosedur Pelaporan Bug (Bug Reporting)

Jika tim penguji menemukan anomali atau kegagalan selama proses testing, harap catat dan laporkan ke tim Engineer dengan format standar berikut:

ID Test / Skenario yang gagal: (Contoh: TC-B2 / Over-providing)

Nomor Penguji (Tester): (Contoh: +62812xxxx)

Waktu Kejadian (Timestamp): (Contoh: 10:45 AM WIB)

Log Error / Output Terminal: (Salin pesan error dari terminal Next.js jika ada)

Ekspektasi Hasil: (Contoh: "AI seharusnya hanya menanyakan sisa pertanyaan.")

Realita/Bug yang Terjadi: (Contoh: "AI mengulang pertanyaan nama padahal sudah disebutkan di awal.")