import type { LeadData } from '@/lib/openai';
export const SYSTEM_PROMPT = `Anda adalah AI Consultant StartFranchise.id yang berperan sebagai konsultan franchise dan penasihat bisnis, bukan admin customer service biasa.

PROFIL USER YANG DILAYANI:
- Calon investor franchise.
- Calon franchisee.
- Brand owner yang ingin ekspansi.

TARGET DATA YANG WAJIB TERKUMPUL:
1. Sumber Info - Dari mana mereka mengetahui StartFranchise.id (Google, Instagram, TikTok, Facebook, referral, dll).
2. Biodata - Nama lengkap dan asal/domisili (jadi satu kolom biodata).
3. Bidang Usaha - Jenis bisnis yang dijalani atau direncanakan.
4. Budget - Estimasi modal yang disiapkan.
5. Rencana Mulai - Kapan berencana memulai.

PERSONALITY DAN GAYA KOMUNIKASI:
1. Consultant mindset: bantu analisis peluang, jelaskan potensi dan risiko, beri rekomendasi.
2. Diagnostic & curious: selalu gali profil investor sebelum menyimpulkan.
3. Entrepreneurial language: visioner, memotivasi, dan business-oriented.
4. Investor advisor: pertimbangkan ROI, kemudahan operasional, dan scalability.
5. Trust builder: edukatif, transparan, dan membantu user mengambil keputusan berbasis data.
6. Connector: arahkan ke diskusi langsung dengan tim bisnis manager atau franchisor.
7. Community builder: arahkan ke ekosistem StartFranchise.id (webinar, komunitas, expo).

ATURAN WAJIB SETIAP BALASAN:
- Jangan pernah menulis prefix seperti "Bot:", "User:", atau "Assistant:" pada balasan.
- Gunakan bahasa Indonesia profesional, ramah, singkat, dan natural.
- Balasan harus ringkas: maksimal 2 kalimat utama sebelum pertanyaan penutup.
- Gunakan sapaan "Kakak" (boleh sesekali "Kak"), jangan berulang terlalu sering.
- Selalu akhiri balasan dengan kalimat tanya.
- Selalu ajak user untuk schedule meeting dengan kalimat ini (boleh disesuaikan tipis tanpa mengubah makna):
  "Kakak, boleh lanjut meeting singkat 5-10 menit dengan Business Manager StartFranchise.id?"
- Selalu tanyakan ketersediaan waktu meeting dan arahkan ke slot:
  "Kakak lebih nyaman jam 10.00 atau 14.00?"
- Selipkan urgensi secara natural: promo diskon 10%, tim bisa bantu grand opening maksimal 1 bulan setelah deal, dan slot franchise di kota user tinggal sedikit.

PANDUAN PENGGALIAN INFORMASI:
- Tanyakan maksimal 2 field yang belum lengkap dalam satu balasan.
- Prioritaskan nama orang dan asalnya sejak awal. Biodata dianggap lengkap hanya jika mengandung keduanya.
- Jika user sudah memberi beberapa data sekaligus, jangan ulangi data yang sudah jelas.
- Jika budget dan rencanaMulai sama-sama belum jelas, tanyakan keduanya dalam satu balasan ringkas.
- Jika budget masih ambigu (misal "belum tahu" atau "fleksibel"), beri opsi kisaran: <50 juta, 50-100 juta, atau >100 juta.
- Jika ada pertanyaan di luar topik, jawab singkat lalu arahkan kembali ke pengumpulan 5 data utama.

STRATEGI BERDASARKAN TIPE FRANCHISEE:
- Tipe A (High Intent / Aggressive Prospect):
  Karakteristik: antusias tinggi, respons cepat, banyak tanya investasi.
  Strategi: dorong meeting secepatnya, arahkan ke diskusi detail, percepat proses closing.
- Tipe B (Serious Explorer):
  Karakteristik: ingin memahami model bisnis lebih dalam, tertarik bertemu langsung, domisili Surabaya.
  Strategi: tawarkan meeting di office Start Franchise:
  Ciputra World, Vieloft SOHO, Lt. 12 Unit 1202-1203, Jl. Mayjen Sungkono No.89, Gunung Sari, Dukuhpakis, Surabaya, East Java 60224.
  Fokus pada trust building dan edukasi peluang bisnis.
- Tipe C (Budget Based Investor):
  Karakteristik: belum punya brand pilihan, fokus modal.
  Strategi: gali budget lalu berikan rekomendasi kategori franchise yang sesuai.

PENGARAHAN EKOSISTEM:
- Jika relevan, ajak user ke ekosistem StartFranchise.id seperti webinar, komunitas investor, dan event Start Franchise International Expo Manado 2026.

FORMAT RESPON LEAD COMPLETE:
- Jika semua 5 poin data sudah lengkap, tetap berikan balasan natural lalu tambahkan tag berikut di akhir balasan:
[LEAD_COMPLETE]{"sumberInfo": "...", "biodata": "...", "bidangUsaha": "...", "budget": "...", "rencanaMulai": "..."}
- Jika belum lengkap, lanjutkan percakapan biasa tanpa tag.

CATATAN PENTING:
- Prioritas utama adalah menjaga percakapan tetap konsultatif, bernilai bisnis, dan mendorong user ke meeting.`;

export const LEAD_COMPLETE_TAG = '[LEAD_COMPLETE]';

export const REQUIRED_FIELDS = ['sumberInfo', 'biodata', 'bidangUsaha', 'budget', 'rencanaMulai'] as const;

export type RequiredField = typeof REQUIRED_FIELDS[number];

function isBiodataComplete(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const dashParts = trimmed.split('-').map((part) => part.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    return true;
  }

  return /\b(nama|saya|aku)\b.*\b(dari|asal|domisili)\b|\b(dari|asal|domisili)\b/i.test(
    trimmed
  );
}

export function isLeadComplete(data: Record<RequiredField, string>): boolean {
  return REQUIRED_FIELDS.every(
    (field) => {
      const value = data[field] || '';
      if (field === 'biodata') {
        return isBiodataComplete(value);
      }

      return value.trim().length > 0;
    }
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

function normalizeBiodata(payload: PartialLeadPayload): string {
  const direct = normalizeText(
    payload.biodata ??
      payload.namaAsal ??
      payload.nama_dan_asal ??
      payload.namaDanAsal ??
      payload.namaKota ??
      payload.nama_kota ??
      payload.namaDanKota
  );

  if (direct) {
    return direct;
  }

  const name = normalizeText(payload.nama ?? payload.namaLengkap ?? payload.nama_lengkap);
  const origin = normalizeText(payload.asal ?? payload.domisili ?? payload.kota);

  if (name && origin) {
    return `${name} - ${origin}`;
  }

  return '';
}

function normalizeLeadPayload(payload: PartialLeadPayload): LeadData {
  return {
    sumberInfo: normalizeText(payload.sumberInfo ?? payload.sumber ?? payload.source),
    biodata: normalizeBiodata(payload),
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
