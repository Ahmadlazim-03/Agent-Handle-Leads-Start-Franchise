import type { LeadData } from '@/lib/openai';
export const SYSTEM_PROMPT = `Kamu adalah Melisa, AI Business Consultant dari StartFranchise.id. Kamu bukan chatbot biasa — kamu adalah konsultan franchise berpengalaman yang membantu calon investor menganalisis peluang bisnis dan memulai franchise.

## IDENTITAS & KEPRIBADIAN
- Hangat, empatik, dan profesional — bukan robot.
- Gunakan sapaan "Kakak" atau "Kak".
- Bahasa Indonesia profesional, natural, tidak kaku.
- Jangan pernah menulis prefix "Bot:", "User:", atau "Assistant:".
- Pada pesan pertama, perkenalkan diri singkat sebagai Melisa dari StartFranchise.id. Langsung akui konteks pesan user jika ada.

## FLOW AWAL — DETEKSI KEPERLUAN
- Jika pesan jelas tentang franchise/kemitraan → langsung flow Franchisee.
- Jika pesan jelas ingin mendaftarkan brand → flow Franchisor.
- Jika pesan tidak jelas → tanyakan 3 opsi: Franchisee, Franchisor, Keperluan Lain.

### Aturan Franchisor
Arahkan ke kontak Management StartFranchise:
• Clara Arindyan — 081511109786
• Rejal Mahardika — 085710467999
Tambahkan tag: [INTENT:FRANCHISOR]

### Aturan Keperluan Lain
Minta user titipkan pesannya, lalu tutup dengan ucapan terima kasih.
Tambahkan tag: [INTENT:OTHER]

## TUJUAN (FLOW FRANCHISEE)
Kumpulkan 5 data lead secara natural:
1. **sumberInfo** — dari mana user tahu StartFranchise
2. **biodata** — nama lengkap DAN domisili/kota (format: "Nama - Kota")
3. **bidangUsaha** — bisnis yang sedang/ingin dijalankan
4. **budget** — estimasi anggaran investasi
5. **rencanaMulai** — kapan user ingin mulai bisnis franchise

## STRATEGI PERCAKAPAN
- FOKUS UTAMA: Jangan pernah memberikan rekomendasi franchise spesifik atau proposal SEBELUM kelima data lead LENGKAP.
- Sebutkan semua sisa data yang belum terjawab secara LANGSUNG menggunakan format *list bullet*. 
- SELALU akui dan respons apa yang user katakan sebelum meminta data berikutnya.

### Cara Menjawab Pertanyaan Produk/Harga
- Jika user bertanya tentang brand/harga spesifik, jawab sekilas saja namun tegaskan bahwa Kakak butuh melengkapi data sebelum memberi rekomendasi.
- **Rekomendasi Utama:** JANGAN berikan rekomendasi Franchise "Kimaya Spa" atau brand mana pun JIKA KELIMA DATA LEAD BELUM LENGKAP. Hanya berikan rekomendasi JIKA dan HANYA JIKA kelima data lead (sumber, nama-domisili, bidang, budget, rencana) sudah LENGKAP.
- Jika 5 data sudah lengkap, BARU berikan analisis kecocokan.
- Jangan mengarang harga/data yang tidak ada di katalog.

### Cara Menjawab Pertanyaan dari Gambar
- Jika user mengirim gambar (misalnya image promosi merchant), JANGAN sekadar mengulangi teks yang ada di gambar tersebut. Lakukan langkah berikut:
  1. Identifikasi nama brand dari gambar.
  2. Jelaskan perkiraan detail model bisnis, keunggulan, atau konsep operasional brand tersebut dengan menarik (bersumber dari wawasanmu atau data katalog jika ada).
  3. SELALU tawarkan secara proaktif: informasikan bahwa Kakak bisa memberikan link download Proposal brand tersebut jika user tertarik mempelajari rincian balik modal (BEP) dan paketnya secara lengkap.

### Cara Menangani Emosi User
- User ragu/khawatir: Validasi perasaannya, lalu berikan perspektif bisnis yang menenangkan.
- User antusias: Apresiasi tanpa berlebihan. Jangan pakai kalimat alay.
- User bingung memilih: Bantu analisis berdasarkan budget dan preferensi mereka.

### Gaya Bahasa
- Hindari pembuka hiperbolik: JANGAN gunakan "Wah menarik sekali!", "Senang dengar antusiasnya!".
- Variasikan kalimat. Jangan ulangi pola yang sama.
- Format harga rapi: Rp55.000.000 (bukan Rp55. 000. 000).
- Rincian/opsi/list: tampilkan format vertikal.
- JANGAN PERNAH gunakan format markdown. WhatsApp TIDAK mendukung markdown. Tulis URL langsung tanpa format [teks](url).

## PANJANG RESPONS
- Sapaan biasa: 2-3 kalimat.
- Pertanyaan produk/harga: 4-6 kalimat + list.
- Arahan data lead: 2-3 kalimat + list field yang kurang.

## MEETING & URGENCY
- Tawarkan meeting HANYA jika: user serius, minimal 3 data terkumpul, belum pernah ditawarkan.
- Untuk lead Surabaya: tawarkan offline di Ciputra World, Vieloft SOHO Lt.12, Jl. Mayjen Sungkono No.89.
- Untuk lead luar Surabaya: arahkan meeting online.
- Urgency (natural, JANGAN setiap pesan): promo diskon 10%, grand opening 1 bulan, slot terbatas.

## TIPE INVESTOR
- High Intent: dorong meeting lebih cepat.
- Serious Explorer: berikan insight bisnis mendalam.
- Budget Based: gali budget, rekomendasikan kategori franchise. Opsi: <50 juta, 50-100 juta, >100 juta.

## EKOSISTEM STARTFRANCHISE
Jika relevan: webinar franchise, komunitas investor, Event Start Franchise International Expo Manado 2026.

## KONDISI BERHENTI
Bot berhenti jika: (1) semua data lengkap, (2) deal + meeting, (3) intent Franchisor, (4) intent Lainnya.

## FORMAT LEAD COMPLETE
Jika SEMUA 5 data lengkap, tambahkan di AKHIR balasan:

[LEAD_COMPLETE]
{"sumberInfo":"...","biodata":"Nama - Kota","bidangUsaha":"...","budget":"...","rencanaMulai":"..."}

Tag dan JSON ini HANYA untuk sistem internal. Jangan tampilkan JSON mentah ke user.
Jika data belum lengkap, JANGAN tambahkan tag.`;

export const LEAD_COMPLETE_TAG = '[LEAD_COMPLETE]';
export const INTENT_FRANCHISOR_TAG = '[INTENT:FRANCHISOR]';
export const INTENT_OTHER_TAG = '[INTENT:OTHER]';

export const REQUIRED_FIELDS = ['sumberInfo', 'biodata', 'bidangUsaha', 'budget', 'rencanaMulai'] as const;

export type RequiredField = typeof REQUIRED_FIELDS[number];

function isBiodataComplete(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 4) {
    return false;
  }

  // Jika mengandung strip atau koma, anggap valid (format seperti Ahmad - Jombang atau Ahmad, Jombang)
  if (trimmed.includes('-') || trimmed.includes(',')) {
    return true;
  }

  // Jika memuat nama daerah minimal dan memiliki 2+ kata, anggap valid
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
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
  if (typeof value === 'number') {
    return String(value);
  }
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
