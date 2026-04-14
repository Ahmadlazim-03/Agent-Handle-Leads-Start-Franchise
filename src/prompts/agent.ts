import type { LeadData } from '@/lib/openai';
export const SYSTEM_PROMPT = `Anda adalah Melisa, AI Business Consultant dari StartFranchise.id yang membantu calon investor memahami dan memulai bisnis franchise.

Peran Anda bukan sekadar customer service, tetapi sebagai konsultan franchise yang membantu calon investor menganalisis peluang bisnis, memahami investasi, dan menentukan langkah terbaik sebelum membuka franchise.

Anda harus terasa seperti manusia yang hangat, empatik, dan responsif, bukan robot.

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
- Human empathy: validasi perasaan user (bingung, ragu, antusias) sebelum memberi arahan.

4. ATURAN BALASAN
Setiap balasan harus:
- Menggunakan bahasa Indonesia profesional.
- Ramah dan natural.
- Maksimal 2-3 kalimat utama.
- Tidak terdengar seperti robot.
- Gunakan sapaan Kakak atau Kak.
- Balasan pertama untuk chat baru wajib memperkenalkan diri singkat sebagai Melisa.
- Jika pada chat pertama user langsung meminta proposal, kirim proposal lebih dulu lalu ikuti dengan pertanyaan keperluan user.
- Setelah user membalas pertama kali, prioritaskan arahan pengisian data lead yang belum lengkap dalam format list vertikal.
- Untuk pesan arahan data/checklist, jangan paksa akhiran tanda tanya jika bukan pertanyaan.
- Mulai dengan acknowledgement singkat sesuai konteks user, lalu lanjutkan pertanyaan berikutnya.
- Variasikan susunan kalimat agar tidak terasa template berulang.

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

function looksLikeLeadPayload(payload: PartialLeadPayload): boolean {
  const keys = Object.keys(payload).map((key) => key.toLowerCase());
  return keys.some((key) =>
    [
      'sumberinfo',
      'sumber_info',
      'sumber',
      'biodata',
      'bidangusaha',
      'bidang_usaha',
      'usaha',
      'budget',
      'anggaran',
      'rencanamulai',
      'rencana_mulai',
      'timeline',
      'nama',
      'domisili',
      'asal',
      'kota',
    ].includes(key)
  );
}

function extractLabeledValue(content: string, labelPattern: string): string {
  const pattern = new RegExp(
    `${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\b(?:sumber\\s*info|biodata|bidang\\s*usaha|budget|rencana\\s*mulai)\\b\\s*:|$)`,
    'i'
  );

  const match = content.match(pattern);
  if (!match?.[1]) {
    return '';
  }

  return match[1]
    .replace(/^[-:|;,\s]+/, '')
    .replace(/[-:|;,\s]+$/, '')
    .trim();
}

function parseLeadFromLabeledText(content: string): LeadData | null {
  const normalizedContent = content.replace(/\r/g, ' ').replace(/\n+/g, ' ').trim();
  if (!normalizedContent) {
    return null;
  }

  const rawPayload: PartialLeadPayload = {
    sumberInfo: extractLabeledValue(normalizedContent, 'sumber\\s*info|sumber'),
    biodata: extractLabeledValue(normalizedContent, 'biodata|nama\\s*&\\s*kota|nama\\s+dan\\s+kota'),
    bidangUsaha: extractLabeledValue(normalizedContent, 'bidang\\s*usaha|usaha'),
    budget: extractLabeledValue(normalizedContent, 'budget|anggaran'),
    rencanaMulai: extractLabeledValue(normalizedContent, 'rencana\\s*mulai|timeline'),
  };

  const normalizedPayload = normalizeLeadPayload(rawPayload);
  if (!isLeadComplete(normalizedPayload)) {
    return null;
  }

  return normalizedPayload;
}

export function stripLeadPayload(content: string): string {
  const markerIndex = content.indexOf(LEAD_COMPLETE_TAG);
  if (markerIndex === -1) {
    const jsonPayload = extractFirstJsonObject(content);
    if (!jsonPayload) {
      return content.trim();
    }

    try {
      const parsed = JSON.parse(jsonPayload) as PartialLeadPayload;
      if (!looksLikeLeadPayload(parsed)) {
        return content.trim();
      }

      const jsonStartIndex = content.indexOf(jsonPayload);
      if (jsonStartIndex === -1) {
        return content.trim();
      }

      const beforeJson = content
        .slice(0, jsonStartIndex)
        .replace(/\bjson\b\s*$/i, '')
        .replace(/[\s:|;,-]+$/g, '')
        .trim();

      const afterJsonRaw = content.slice(jsonStartIndex + jsonPayload.length).trim();
      const afterJson = /^\s*(tag|payload|lead_complete|\[\s*lead_complete\s*\])\s*[:\-]?\s*\??\s*$/i.test(
        afterJsonRaw
      )
        ? ''
        : afterJsonRaw;

      return [beforeJson, afterJson].filter(Boolean).join(' ').trim();
    } catch {
      return content.trim();
    }
  }

  return content.slice(0, markerIndex).trim();
}

export function parseLeadFromMessage(content: string): LeadData | null {
  const markerIndex = content.indexOf(LEAD_COMPLETE_TAG);
  const taggedPayload =
    markerIndex === -1
      ? content.trim()
      : content.slice(markerIndex + LEAD_COMPLETE_TAG.length).trim();
  const jsonPayload = extractFirstJsonObject(taggedPayload);
  if (jsonPayload) {
    try {
      const rawPayload = JSON.parse(jsonPayload) as PartialLeadPayload;
      if (looksLikeLeadPayload(rawPayload)) {
        const normalizedPayload = normalizeLeadPayload(rawPayload);

        if (!isLeadComplete(normalizedPayload)) {
          return null;
        }

        return normalizedPayload;
      }
    } catch {
      // Ignore malformed JSON and continue to labeled fallback parser.
    }
  }

  return parseLeadFromLabeledText(content);
}
