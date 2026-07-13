const STOPWORDS: Record<string, string[]> = {
  francais: [
    "le", "la", "les", "un", "une", "des", "et", "est", "dans", "pour",
    "avec", "qui", "que", "ne", "pas", "vous", "nous", "je", "mais", "ou",
    "donc", "car", "sur", "au", "du", "ce", "se", "son", "sa", "ses",
    "plus", "tres", "tout", "tous", "cette", "votre", "notre", "etre", "avoir",
    "merci", "bonjour", "cordialement",
  ],
  english: [
    "the", "and", "is", "of", "to", "in", "for", "with", "that", "this",
    "you", "are", "was", "but", "not", "on", "at", "from", "have", "has",
    "will", "would", "can", "could", "our", "your", "their", "they", "we",
    "be", "been", "it", "its", "as", "if", "or", "an",
  ],
  deutsch: [
    "der", "die", "das", "und", "ist", "mit", "fur", "von", "ein", "eine",
    "nicht", "auch", "wir", "sie", "ich", "ihr", "aber", "wenn", "denn",
    "oder", "doch", "schon", "bei", "im", "des", "den", "dem", "zu", "auf",
    "sind", "war", "haben", "hat",
  ],
  espanol: [
    "el", "la", "los", "las", "un", "una", "y", "es", "en", "de",
    "para", "con", "que", "no", "por", "como", "pero", "este", "esta",
    "ser", "mas", "muy", "su", "sus", "lo", "le", "se", "del", "al",
    "hola", "gracias", "saludos",
  ],
  italiano: [
    "il", "lo", "la", "gli", "le", "un", "una", "e", "di", "in",
    "per", "con", "che", "non", "ma", "come", "anche", "piu", "sono",
    "sei", "del", "della", "al", "alla", "questo", "questa", "ciao", "grazie",
  ],
  portugues: [
    "o", "a", "os", "as", "um", "uma", "e", "de", "em", "para",
    "com", "que", "nao", "por", "como", "mais", "sao", "esta", "do",
    "da", "dos", "das", "no", "na", "ola", "obrigado", "obrigada",
  ],
  nederlands: [
    "de", "het", "een", "en", "is", "van", "in", "op", "met", "voor",
    "dat", "ik", "je", "we", "niet", "ook", "maar", "of", "zijn", "heb",
    "naar", "bij", "om", "hoi", "bedankt", "groeten",
  ],
  turkce: [
    "ve", "bir", "icin", "ile", "ama", "cok", "daha", "ben", "sen", "biz",
    "siz", "var", "yok", "evet", "hayir", "bu", "su", "o", "ne", "her",
    "olarak", "merhaba", "tesekkur", "tesekkurler", "selam",
  ],
  arabic: [
    "في", "من", "على", "إلى", "هذا", "هذه", "ذلك", "التي", "الذي", "أن",
    "أنا", "أنت", "نحن", "هو", "هي", "لا", "نعم", "مع", "عن", "كل",
    "شكرا", "مرحبا",
  ],
};

const DIACRITIC_BOOSTS: Array<{ lang: string; pattern: RegExp; weight: number }> = [
  { lang: "turkce", pattern: /[ığİıŞşÇçÖöÜüĞ]/g, weight: 2 },
  { lang: "espanol", pattern: /[ñ¿¡]/g, weight: 3 },
  { lang: "portugues", pattern: /[ãõ]/g, weight: 2 },
  { lang: "deutsch", pattern: /[ßäÄöÖüÜ]/g, weight: 2 },
  { lang: "francais", pattern: /[àâçéèêëîïôûùüœÀÂÇÉÈÊËÎÏÔÛÙÜŒ]/g, weight: 1 },
];

function stripAccents(s: string): string {
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return s;
  }
}

/**
 * Detect the most likely language of `text` among the supported set.
 * Returns null when the signal is too weak to be confident.
 */
export function detectLanguage(text: string): string | null {
  const raw = (text ?? "").toString();
  if (!raw || raw.trim().length < 8) return null;

  // Arabic detection: presence of Arabic-script characters wins outright.
  const arabicChars = (raw.match(/[\u0600-\u06FF]/g) ?? []).length;
  const totalLetters = (raw.match(/[\p{L}]/gu) ?? []).length || 1;
  if (arabicChars >= 4 || arabicChars / totalLetters > 0.2) {
    return "arabic";
  }

  const scores: Record<string, number> = {
    francais: 0, english: 0, deutsch: 0, espanol: 0,
    italiano: 0, portugues: 0, nederlands: 0, turkce: 0, arabic: 0,
  };

  // Diacritic boosts on the original text.
  for (const { lang, pattern, weight } of DIACRITIC_BOOSTS) {
    const m = raw.match(pattern);
    if (m && m.length > 0) {
      scores[lang] += Math.min(m.length, 5) * weight;
    }
  }

  // Stopword counting on accent-stripped, lowercased, word-tokenised text.
  const tokens = stripAccents(raw.toLowerCase()).match(/[a-z]+/g) ?? [];
  if (tokens.length > 0) {
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [lang, words] of Object.entries(STOPWORDS)) {
      if (lang === "arabic") continue;
      for (const w of words) {
        const c = counts.get(w);
        if (c) scores[lang] += c;
      }
    }
  }

  // Stopword counting in the original (non-stripped) Arabic text.
  for (const w of STOPWORDS.arabic) {
    if (raw.includes(w)) scores.arabic += 1;
  }

  let best: string | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      secondScore = bestScore;
      bestScore = sc;
      best = lang;
    } else if (sc > secondScore) {
      secondScore = sc;
    }
  }

  // Confidence gate: need a meaningful absolute score AND a margin over runner-up.
  if (!best || bestScore < 2) return null;
  if (bestScore - secondScore < 1) return null;
  return best;
}
