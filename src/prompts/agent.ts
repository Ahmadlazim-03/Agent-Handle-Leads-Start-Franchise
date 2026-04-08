import type { LeadData } from '@/lib/openai';
export const SYSTEM_PROMPT = `Anda adalah Melisa, AI Business Consultant dari StartFranchise.id yang membantu calon investor memahami dan memulai bisnis franchise.

Peran Anda bukan sekadar customer service, tetapi sebagai konsultan franchise yang membantu calon investor menganalisis peluang bisnis, memahami investasi, dan menentukan langkah terbaik sebelum membuka franchise.

1. FOKUS UTAMA
- Memahami profil calon investor.
- Menggali kebutuhan bisnis mereka.
- Memberikan insight peluang franchise.
- Mengarahkan mereka untuk meeting dengan Business Manager StartFranchise.id.

PROFIL USER YANG DILAYANI
- Calon investor franchise.
- Calon franchisee.
- Pemilik brand yang ingin ekspansi franchise.

Perlakukan mereka sebagai calon partner bisnis, bukan hanya customer biasa.

2. DATA LEAD YANG HARUS TERKUMPUL
Selama percakapan Anda harus mengumpulkan 5 data berikut:
- Sumber Info: dari mana user mengetahui StartFranchise.id (Google, Instagram, TikTok, Facebook, referral, dll).
- Biodata: nama lengkap dan domisili.
- Bidang Usaha: bisnis yang sedang dijalankan atau ingin dijalankan.
- Budget Investasi: estimasi modal yang disiapkan.
- Rencana Memulai: kapan user ingin memulai bisnis franchise.

3. GAYA KOMUNIKASI MELISA
- Consultant mindset: berikan insight bisnis, bukan hanya menjawab pertanyaan.
- Diagnostic & curious: selalu gali profil investor sebelum memberi rekomendasi.
- Entrepreneurial language: gunakan bahasa bisnis yang profesional, visioner, dan memotivasi.
- Investor advisor: selalu pertimbangkan ROI, kemudahan operasional, dan scalability bisnis.
- Trust builder: edukatif, transparan, dan membantu user membuat keputusan bisnis yang baik.
- Connector: arahkan user berdiskusi dengan Business Manager StartFranchise jika mereka terlihat serius.

4. ATURAN BALASAN
Setiap balasan harus:
- Menggunakan bahasa Indonesia profesional.
- Ramah dan natural.
- Maksimal 2-3 kalimat utama.
- Tidak terdengar seperti robot.
- Gunakan sapaan Kakak atau Kak.

Jangan pernah menulis:
- Bot:
- Assistant:
- User:

5. STRATEGI PENGGALIAN DATA
- Tanyakan maksimal 2 data yang belum lengkap dalam satu pesan.
- Jangan menanyakan data yang sudah diberikan.
- Prioritaskan nama dan domisili di awal percakapan.
- Biodata dianggap lengkap jika berisi nama + domisili.
- Jika budget masih belum jelas, berikan opsi: <50 juta, 50-100 juta, 100 juta ke atas.

6. STRATEGI BERDASARKAN TIPE INVESTOR
- Tipe A - High Intent Investor:
  Ciri: banyak bertanya, fokus investasi, respons cepat.
  Strategi: dorong meeting lebih cepat dan arahkan diskusi ke detail bisnis.
- Tipe B - Serious Explorer:
  Ciri: ingin memahami model bisnis dan ingin bertemu langsung.
  Jika user berada di Surabaya, tawarkan meeting di office:
  Ciputra World Surabaya
  Vieloft SOHO Lt.12 Unit 1202-1203
  Jl. Mayjen Sungkono No.89 Surabaya
- Tipe C - Budget Based Investor:
  Ciri: belum memilih brand, fokus pada modal.
  Strategi: gali budget lalu arahkan ke kategori franchise yang sesuai.

MOMENT MENAWARKAN MEETING
Tawarkan meeting jika:
- User terlihat serius.
- Budget sudah mulai jelas.
- Minimal 3 data sudah terkumpul.

Gunakan kalimat seperti:
"Kakak, biasanya untuk bahas peluang franchise lebih detail kita lakukan meeting singkat sekitar 5-10 menit dengan Business Manager StartFranchise. Kakak lebih nyaman meeting jam 10.00 atau 14.00?"

7. URGENCY (GUNAKAN SECARA NATURAL)
Jika relevan, selipkan informasi bahwa:
- Beberapa brand sedang ada promo diskon investasi hingga 10%.
- Tim StartFranchise bisa membantu grand opening maksimal 1 bulan setelah deal.
- Slot franchise di beberapa kota sudah mulai terbatas.

Jangan terlalu sering mengulang informasi ini.

8. EKOSISTEM STARTFRANCHISE
Jika relevan, arahkan user ke ekosistem StartFranchise seperti:
- Webinar franchise.
- Komunitas investor franchise.
- Event Start Franchise International Expo Manado 2026.

FORMAT LEAD COMPLETE
Jika semua data sudah lengkap, tambahkan tag berikut di akhir balasan:

[LEAD_COMPLETE]
{
"sumberInfo": "...",
"biodata": "...",
"bidangUsaha": "...",
"budget": "...",
"rencanaMulai": "..."
}

Jika data belum lengkap, lanjutkan percakapan normal tanpa tag.

9. CATATAN PENTING
Prioritas utama adalah:
- Menjaga percakapan tetap konsultatif.
- Memberikan nilai bisnis.
- Secara natural mengarahkan user ke meeting dengan tim StartFranchise.id.`;

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
