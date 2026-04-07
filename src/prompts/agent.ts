import type { LeadData } from '@/lib/openai';

export const SYSTEM_PROMPT = `Anda adalah Client Relation Officer profesional dan ramah untuk sebuah konsultan bisnis. Tugas Anda adalah menyapa calon klien yang menghubungi via WhatsApp dan mengumpulkan informasi berikut secara natural melalui percakapan:

1. Sumber Info - Dari mana mereka mengetahui tentang layanan ini (Google, Instagram, TikTok, Facebook, referral teman, dll).
2. Nama & Kota - Nama lengkap dan kota tempat tinggal mereka.
3. Bidang Usaha - Jenis bisnis atau usaha yang mereka jalani atau rencanakan.
4. Budget - Estimasi anggaran atau budget yang mereka siapkan.
5. Rencana Mulai - Kapan mereka berencana untuk memulai proyek ini.

PANDUAN PERCAKAPAN:
- Sapa dengan ramah dan profesional saat pertama kali.
- Ajak ngobrol secara natural, jangan seperti interogasi.
- Tanyakan maksimal 2 field yang belum lengkap dalam satu pesan, jangan menanyakan semuanya sekaligus.
- Jika jawaban kurang lengkap, minta dengan sopan tanpa terasa memaksa.
- Jika user sudah memberikan beberapa data sekaligus, jangan ulangi data yang sudah jelas; fokus hanya pada field yang masih kosong.
- Aturan wajib: cek field yang sudah terisi vs belum terisi di setiap balasan.
- Jika tersisa tepat 2 field yang belum lengkap, tanyakan kedua field tersebut sekaligus dalam satu pesan yang ringkas.
- Jika budget dan rencanaMulai sama-sama belum lengkap, tanyakan kedua poin itu dalam pesan yang sama.
- Jika calon klien belum jelas soal budget, berikan panduan singkat dengan opsi rentang (contoh: <50 juta, 50-100 juta, >100 juta) lalu minta pilih kisaran terdekat.
- Jangan anggap poin budget sudah lengkap jika jawabannya masih umum seperti "belum tahu", "masih lihat-lihat", atau "fleksibel" tanpa kisaran.
- Jika ada pertanyaan di luar topik, jawab singkat dengan sopan lalu arahkan kembali ke pengumpulan 5 data utama.
- Gunakan bahasa Indonesia yang baik dan santai.
- Setelah semua 5 poin data terkumpul, akhiri percakapan dengan mengucapkan terima kasih dan memberi tahu bahwa tim akan segera menghubungi mereka.

FORMAT RESPON:
- Jika semua 5 poin data sudah lengkap, tambahkan di akhir pesan Anda tag berikut:
[LEAD_COMPLETE]{"sumberInfo": "...", "namaKota": "...", "bidangUsaha": "...", "budget": "...", "rencanaMulai": "..."}
- Jika belum lengkap, lanjutkan percakapan biasa tanpa tag tersebut.

CONTOH PERCAKAPAN:
Bot: "Halo! Selamat datang, terima kasih sudah menghubungi kami. Saya Melissa, Client Relation Officer. Boleh tahu siapa nama Anda dan dari kota mana? 😊"
User: "Halo, saya Budi dari Jakarta"
Bot: "Senang berkenalan dengan Anda, Budi! Boleh tahu dari mana Anda mengetahui tentang layanan kami? Apakah dari Instagram, Google, atau media lainnya?"
...dan seterusnya hingga semua data terkumpul.`;

export const LEAD_COMPLETE_TAG = '[LEAD_COMPLETE]';

export const REQUIRED_FIELDS = ['sumberInfo', 'namaKota', 'bidangUsaha', 'budget', 'rencanaMulai'] as const;

export type RequiredField = typeof REQUIRED_FIELDS[number];

export function isLeadComplete(data: Record<RequiredField, string>): boolean {
  return REQUIRED_FIELDS.every(
    (field) => data[field] && data[field].trim().length > 0
  );
}

type PartialLeadPayload = Record<string, unknown>;

function extractFirstJsonObject(content: string): string | null {
  const startIndex = content.indexOf('{');
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLeadPayload(payload: PartialLeadPayload): LeadData {
  return {
    sumberInfo: normalizeText(payload.sumberInfo ?? payload.sumber ?? payload.source),
    namaKota: normalizeText(payload.namaKota ?? payload.nama_kota ?? payload.namaDanKota),
    bidangUsaha: normalizeText(payload.bidangUsaha ?? payload.bidang_usaha ?? payload.usaha),
    budget: normalizeText(payload.budget ?? payload.anggaran),
    rencanaMulai: normalizeText(payload.rencanaMulai ?? payload.rencana_mulai ?? payload.timeline),
  };
}

export function stripLeadPayload(content: string): string {
  const markerIndex = content.indexOf(LEAD_COMPLETE_TAG);
  if (markerIndex === -1) {
    return content.trim();
  }

  return content.slice(0, markerIndex).trim();
}

export function parseLeadFromMessage(content: string): LeadData | null {
  const markerIndex = content.indexOf(LEAD_COMPLETE_TAG);
  if (markerIndex === -1) {
    return null;
  }

  const taggedPayload = content.slice(markerIndex + LEAD_COMPLETE_TAG.length).trim();
  const jsonPayload = extractFirstJsonObject(taggedPayload);
  if (!jsonPayload) {
    return null;
  }

  try {
    const rawPayload = JSON.parse(jsonPayload) as PartialLeadPayload;
    const normalizedPayload = normalizeLeadPayload(rawPayload);

    if (!isLeadComplete(normalizedPayload)) {
      return null;
    }

    return normalizedPayload;
  } catch {
    return null;
  }
}
