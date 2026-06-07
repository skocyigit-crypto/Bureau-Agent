import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// "Anlık cevap" / boîtes de réponse instantanée (comme Google) : calculatrice,
// conversion d'unités et conversion de devises. Tout est DÉTERMINISTE et local
// (aucun appel IA, aucun quota) sauf les taux de change, récupérés sur un
// service public GRATUIT et SANS CLÉ (frankfurter.app, taux de référence BCE).
// Toute requête non reconnue renvoie `null` -> aucune carte affichée.
// ---------------------------------------------------------------------------

export type InstantAnswerKind = "calculator" | "unit" | "currency" | "weather" | "datetime";

export interface InstantAnswer {
  kind: InstantAnswerKind;
  /** Expression normalisée affichée en petit au-dessus du résultat. */
  expression: string;
  /** Résultat principal mis en avant. */
  result: string;
  /** Ligne secondaire optionnelle (taux, date, équivalence…). */
  detail?: string;
}

// --- Helpers numériques --------------------------------------------------

/**
 * Parse un nombre en tolérant les formats FR/EN : "1 500,75", "1,500.75",
 * "3,5", "3.5". Heuristique : si "," ET "." présents -> le dernier est le
 * séparateur décimal ; sinon "," seul est décimal s'il précède 1-3 décimales.
 */
function parseLooseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Le séparateur décimal est celui le plus à droite.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // "1,5" -> décimal ; "1,500" (3 chiffres) -> ambigu, on traite en décimal
    // seulement si <= 2 décimales, sinon séparateur de milliers.
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      s = `${parts[0]}.${parts[1]}`;
    } else {
      s = s.replace(/,/g, "");
    }
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convertit un littéral numérique brut (FR/EN) en sa forme canonique à point
 * décimal ("1,234" -> "1234", "3,5" -> "3.5"), en réutilisant exactement la
 * même sémantique que `parseLooseNumber` pour rester cohérent entre la
 * calculatrice, les unités et les devises. Renvoie `null` si non numérique.
 */
function canonicalNumberLiteral(raw: string): string | null {
  const n = parseLooseNumber(raw);
  if (n === null) return null;
  return String(n);
}

/** Formate un nombre avec séparateurs FR, en limitant les décimales. */
function formatNumber(n: number, maxFractionDigits = 6): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = Math.abs(n) >= 1e15 ? n.toExponential(6) : n;
  if (typeof fixed === "string") return fixed;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(fixed);
}

// --- Calculatrice (évaluateur sûr, sans eval) ----------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "fn"; v: string };

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenizeMath(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) return null;
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      const word = s.slice(i, j).toLowerCase();
      if (word in FUNCTIONS) {
        tokens.push({ t: "fn", v: word });
      } else if (word in CONSTANTS) {
        tokens.push({ t: "num", v: CONSTANTS[word] });
      } else if (word === "x") {
        tokens.push({ t: "op", v: "*" });
      } else {
        return null;
      }
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "×") {
      tokens.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if (c === "÷") {
      tokens.push({ t: "op", v: "/" });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };

/** Évalue une expression arithmétique via shunting-yard (pas de eval). */
function evalMath(input: string): number | null {
  const tokens = tokenizeMath(input);
  if (!tokens || tokens.length === 0) return null;

  // Gère le moins/plus unaire en insérant un 0 implicite.
  const normalized: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (
      (tok.t === "op" && (tok.v === "-" || tok.v === "+")) &&
      (k === 0 ||
        tokens[k - 1].t === "lp" ||
        (tokens[k - 1].t === "op"))
    ) {
      normalized.push({ t: "num", v: 0 });
    }
    normalized.push(tok);
  }

  const output: Token[] = [];
  const stack: Token[] = [];
  for (const tok of normalized) {
    if (tok.t === "num") {
      output.push(tok);
    } else if (tok.t === "fn") {
      stack.push(tok);
    } else if (tok.t === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (
          top.t === "fn" ||
          (top.t === "op" &&
            (PRECEDENCE[top.v] > PRECEDENCE[tok.v] ||
              (PRECEDENCE[top.v] === PRECEDENCE[tok.v] && tok.v !== "^")))
        ) {
          output.push(stack.pop()!);
        } else break;
      }
      stack.push(tok);
    } else if (tok.t === "lp") {
      stack.push(tok);
    } else if (tok.t === "rp") {
      let found = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.t === "lp") {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) return null;
      if (stack.length && stack[stack.length - 1].t === "fn") {
        output.push(stack.pop()!);
      }
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp" || top.t === "rp") return null;
    output.push(top);
  }

  const vals: number[] = [];
  for (const tok of output) {
    if (tok.t === "num") {
      vals.push(tok.v);
    } else if (tok.t === "fn") {
      const a = vals.pop();
      if (a === undefined) return null;
      vals.push(FUNCTIONS[tok.v](a));
    } else if (tok.t === "op") {
      const b = vals.pop();
      const a = vals.pop();
      if (a === undefined || b === undefined) return null;
      switch (tok.v) {
        case "+":
          vals.push(a + b);
          break;
        case "-":
          vals.push(a - b);
          break;
        case "*":
          vals.push(a * b);
          break;
        case "/":
          if (b === 0) return null;
          vals.push(a / b);
          break;
        case "^":
          vals.push(Math.pow(a, b));
          break;
        default:
          return null;
      }
    }
  }
  if (vals.length !== 1) return null;
  return Number.isFinite(vals[0]) ? vals[0] : null;
}

/**
 * Détecte et résout les requêtes "calculatrice", y compris les pourcentages
 * utiles à la facturation : "100 + 20%" (TTC), "100 - 10%" (remise),
 * "20% de 150" / "20% of 150".
 */
function tryCalculator(query: string): InstantAnswer | null {
  const raw = query.trim();
  if (raw.length > 120) return null;

  // Pourcentage : "A% de/of/sur B" -> A/100 * B
  const pctOf = raw.match(/^([\d.,\s]+)\s*%\s*(?:de|of|sur|du|des)\s+([\d.,\s]+)$/i);
  if (pctOf) {
    const a = parseLooseNumber(pctOf[1]);
    const b = parseLooseNumber(pctOf[2]);
    if (a !== null && b !== null) {
      const r = (a / 100) * b;
      return {
        kind: "calculator",
        expression: `${formatNumber(a)} % de ${formatNumber(b)}`,
        result: formatNumber(r),
      };
    }
  }

  // Ajout / retrait de pourcentage : "B + A%" (TTC) / "B - A%" (remise)
  const pctAddSub = raw.match(/^([\d.,\s]+)\s*([+\-])\s*([\d.,\s]+)\s*%$/);
  if (pctAddSub) {
    const b = parseLooseNumber(pctAddSub[1]);
    const a = parseLooseNumber(pctAddSub[3]);
    if (a !== null && b !== null) {
      const r = pctAddSub[2] === "+" ? b * (1 + a / 100) : b * (1 - a / 100);
      return {
        kind: "calculator",
        expression: `${formatNumber(b)} ${pctAddSub[2]} ${formatNumber(a)} %`,
        result: formatNumber(r),
        detail:
          pctAddSub[2] === "+"
            ? `dont ${formatNumber((b * a) / 100)} de plus`
            : `soit ${formatNumber((b * a) / 100)} de moins`,
      };
    }
  }

  // Expression arithmétique générale. On exige au moins un opérateur entre
  // chiffres pour éviter les faux positifs (dates, numéros…).
  const looksMath = /[-+*/^×÷]/.test(raw) || /\b(sqrt|abs|round|floor|ceil|ln|log|sin|cos|tan|pi)\b/i.test(raw);
  const safeChars = /^[\d\s.,+\-*/^()×÷xa-zA-Z]+$/.test(raw);
  const hasDigit = /\d/.test(raw);
  if (looksMath && safeChars && hasDigit) {
    // Normalise CHAQUE littéral numérique avec la même sémantique que
    // `parseLooseNumber` ("1,234" -> "1234" milliers, "3,5" -> "3.5" décimal),
    // pour que la calculatrice interprète les nombres comme les unités/devises.
    let normalizationOk = true;
    const normalized = raw.replace(/\d[\d.,]*\d|\d/g, (m) => {
      const canon = canonicalNumberLiteral(m);
      if (canon === null) {
        normalizationOk = false;
        return m;
      }
      return canon;
    });
    if (!normalizationOk) return null;
    const r = evalMath(normalized);
    if (r !== null) {
      const pretty = normalized
        .replace(/\*/g, " × ")
        .replace(/\//g, " ÷ ")
        .replace(/\+/g, " + ")
        .replace(/(?<=\d)\s*-\s*(?=\d)/g, " − ")
        .replace(/\s+/g, " ")
        .trim();
      return { kind: "calculator", expression: pretty, result: formatNumber(r) };
    }
  }

  return null;
}

// --- Conversion d'unités -------------------------------------------------

interface UnitDef {
  category: string;
  // Facteur vers l'unité de base de la catégorie.
  factor: number;
  label: string;
}

// Table d'unités avec alias FR/EN/TR. Base : mètre, gramme, litre, m², seconde.
const UNITS: Record<string, UnitDef> = {
  // Longueur (base : mètre)
  mm: { category: "length", factor: 0.001, label: "mm" },
  cm: { category: "length", factor: 0.01, label: "cm" },
  m: { category: "length", factor: 1, label: "m" },
  metre: { category: "length", factor: 1, label: "m" },
  metres: { category: "length", factor: 1, label: "m" },
  km: { category: "length", factor: 1000, label: "km" },
  in: { category: "length", factor: 0.0254, label: "in" },
  inch: { category: "length", factor: 0.0254, label: "in" },
  pouce: { category: "length", factor: 0.0254, label: "pouce" },
  ft: { category: "length", factor: 0.3048, label: "ft" },
  feet: { category: "length", factor: 0.3048, label: "ft" },
  pied: { category: "length", factor: 0.3048, label: "pied" },
  yd: { category: "length", factor: 0.9144, label: "yd" },
  yard: { category: "length", factor: 0.9144, label: "yd" },
  mi: { category: "length", factor: 1609.344, label: "mi" },
  mile: { category: "length", factor: 1609.344, label: "mile" },
  miles: { category: "length", factor: 1609.344, label: "miles" },
  // Masse (base : gramme)
  mg: { category: "mass", factor: 0.001, label: "mg" },
  g: { category: "mass", factor: 1, label: "g" },
  gramme: { category: "mass", factor: 1, label: "g" },
  kg: { category: "mass", factor: 1000, label: "kg" },
  t: { category: "mass", factor: 1_000_000, label: "t" },
  tonne: { category: "mass", factor: 1_000_000, label: "t" },
  lb: { category: "mass", factor: 453.59237, label: "lb" },
  lbs: { category: "mass", factor: 453.59237, label: "lb" },
  livre: { category: "mass", factor: 453.59237, label: "livre" },
  oz: { category: "mass", factor: 28.349523125, label: "oz" },
  once: { category: "mass", factor: 28.349523125, label: "once" },
  // Volume (base : litre)
  ml: { category: "volume", factor: 0.001, label: "ml" },
  cl: { category: "volume", factor: 0.01, label: "cl" },
  l: { category: "volume", factor: 1, label: "l" },
  litre: { category: "volume", factor: 1, label: "l" },
  litres: { category: "volume", factor: 1, label: "l" },
  gal: { category: "volume", factor: 3.785411784, label: "gal" },
  gallon: { category: "volume", factor: 3.785411784, label: "gal" },
  // Surface (base : m²)
  m2: { category: "area", factor: 1, label: "m²" },
  km2: { category: "area", factor: 1_000_000, label: "km²" },
  ha: { category: "area", factor: 10_000, label: "ha" },
  hectare: { category: "area", factor: 10_000, label: "ha" },
  acre: { category: "area", factor: 4046.8564224, label: "acre" },
  // Temps (base : seconde)
  s: { category: "time", factor: 1, label: "s" },
  seconde: { category: "time", factor: 1, label: "s" },
  min: { category: "time", factor: 60, label: "min" },
  minute: { category: "time", factor: 60, label: "min" },
  h: { category: "time", factor: 3600, label: "h" },
  heure: { category: "time", factor: 3600, label: "h" },
  jour: { category: "time", factor: 86400, label: "jour" },
  day: { category: "time", factor: 86400, label: "jour" },
  // Données (base : octet)
  o: { category: "data", factor: 1, label: "o" },
  ko: { category: "data", factor: 1000, label: "Ko" },
  mo: { category: "data", factor: 1e6, label: "Mo" },
  go: { category: "data", factor: 1e9, label: "Go" },
  to: { category: "data", factor: 1e12, label: "To" },
  kb: { category: "data", factor: 1000, label: "KB" },
  mb: { category: "data", factor: 1e6, label: "MB" },
  gb: { category: "data", factor: 1e9, label: "GB" },
  tb: { category: "data", factor: 1e12, label: "TB" },
};

// Températures : conversions affines, traitées à part.
const TEMP_ALIASES: Record<string, "c" | "f" | "k"> = {
  c: "c",
  "°c": "c",
  celsius: "c",
  f: "f",
  "°f": "f",
  fahrenheit: "f",
  k: "k",
  kelvin: "k",
};

function normalizeUnitToken(raw: string): string {
  // Normalise les exposants Unicode (m² -> m2, m³ -> m3) pour matcher la table.
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3");
}

function convertTemperature(value: number, from: "c" | "f" | "k", to: "c" | "f" | "k"): number {
  // Vers Celsius
  let c: number;
  if (from === "c") c = value;
  else if (from === "f") c = (value - 32) * (5 / 9);
  else c = value - 273.15;
  // De Celsius vers cible
  if (to === "c") return c;
  if (to === "f") return c * (9 / 5) + 32;
  return c + 273.15;
}

const CONVERT_KEYWORDS = "(?:en|to|in|vers|->|=>)";

function tryUnitConversion(query: string): InstantAnswer | null {
  const m = query
    .trim()
    .match(
      new RegExp(
        `^(?:convertir|convert|combien (?:font|fait|de)\\s+)?\\s*([\\d.,\\s]+)\\s*([a-zA-Z0-9°²³µ]+)\\s+${CONVERT_KEYWORDS}\\s+([a-zA-Z0-9°²³µ]+)\\s*\\??$`,
        "i",
      ),
    );
  if (!m) return null;
  const value = parseLooseNumber(m[1]);
  if (value === null) return null;
  const fromTok = normalizeUnitToken(m[2]);
  const toTok = normalizeUnitToken(m[3]);

  // Températures
  const tFrom = TEMP_ALIASES[fromTok];
  const tTo = TEMP_ALIASES[toTok];
  if (tFrom && tTo) {
    const r = convertTemperature(value, tFrom, tTo);
    const fl = fromTok.startsWith("°") ? fromTok.toUpperCase() : `°${tFrom.toUpperCase()}`;
    const tl = toTok.startsWith("°") ? toTok.toUpperCase() : `°${tTo.toUpperCase()}`;
    return {
      kind: "unit",
      expression: `${formatNumber(value)} ${fl}`,
      result: `${formatNumber(r, 2)} ${tl}`,
    };
  }

  const from = UNITS[fromTok];
  const to = UNITS[toTok];
  if (!from || !to || from.category !== to.category) return null;
  const r = (value * from.factor) / to.factor;
  return {
    kind: "unit",
    expression: `${formatNumber(value)} ${from.label}`,
    result: `${formatNumber(r)} ${to.label}`,
  };
}

// --- Conversion de devises (frankfurter.app, BCE, gratuit, sans clé) ------

const CURRENCY_CODES = new Set([
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD",
  "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
]);

const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  "$": "USD",
  "£": "GBP",
  "₺": "TRY",
  "¥": "JPY",
  "₣": "CHF",
};

function normalizeCurrencyToken(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (CURRENCY_CODES.has(t)) return t;
  const sym = CURRENCY_SYMBOLS[raw.trim()];
  return sym ?? null;
}

const RATE_TTL_MS = 60 * 60_000; // 1 h
const rateCache = new Map<string, { value: { rate: number; date: string }; exp: number }>();
const FRANKFURTER_TIMEOUT_MS = 4000;

async function fetchRate(from: string, to: string): Promise<{ rate: number; date: string } | null> {
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  const key = `${from}:${to}`;
  const now = Date.now();
  const hit = rateCache.get(key);
  if (hit && hit.exp > now) return hit.value;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FRANKFURTER_TIMEOUT_MS);
    // URL canonique directe (api.frankfurter.app 301 -> api.frankfurter.dev/v1).
    const url = `https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`;
    // Anti-SSRF : hôte fixe + on REFUSE tout redirect (pas de rebond vers une
    // cible interne). from/to sont déjà validés contre une allowlist ISO.
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { rates?: Record<string, number>; date?: string };
    const rate = json.rates?.[to];
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
    const value = { rate, date: json.date ?? new Date().toISOString().slice(0, 10) };
    rateCache.set(key, { value, exp: now + RATE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

async function tryCurrencyConversion(query: string): Promise<InstantAnswer | null> {
  const raw = query.trim();
  // "100 USD en EUR", "100€ en USD", "$100 to TRY", "convertir 50 eur en try"
  const m = raw.match(
    new RegExp(
      `^(?:convertir|convert)?\\s*([€$£₺¥₣]?)\\s*([\\d.,\\s]+)\\s*([€$£₺¥₣]?[A-Za-z]{0,3})\\s+${CONVERT_KEYWORDS}\\s+([€$£₺¥₣]?[A-Za-z]{0,3})\\s*\\??$`,
      "i",
    ),
  );
  if (!m) return null;
  const amount = parseLooseNumber(m[2]);
  if (amount === null) return null;
  const fromRaw = (m[1] || m[3]).trim();
  const toRaw = m[4].trim();
  const from = normalizeCurrencyToken(fromRaw);
  const to = normalizeCurrencyToken(toRaw);
  if (!from || !to) return null;

  const data = await fetchRate(from, to);
  if (!data) return null;
  const converted = amount * data.rate;
  return {
    kind: "currency",
    expression: `${formatNumber(amount, 2)} ${from}`,
    result: `${formatNumber(converted, 2)} ${to}`,
    detail: `1 ${from} = ${formatNumber(data.rate, 4)} ${to} · taux BCE du ${data.date}`,
  };
}

// --- Géocodage (open-meteo, gratuit, sans clé) ---------------------------

const OPEN_METEO_TIMEOUT_MS = 4000;
const GEO_MAX_ENTRIES = 500;
const WEATHER_MAX_ENTRIES = 500;

/**
 * Écrit dans un cache Map borné : éviction FIFO de la plus ancienne entrée
 * au-delà de `max`. Évite la croissance mémoire illimitée sur des clés
 * influencées par l'utilisateur (noms de villes, coordonnées).
 */
function boundedCacheSet<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

interface GeoPlace {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

const GEO_TTL_MS = 24 * 60 * 60_000;
const GEO_NULL_TTL_MS = 10 * 60_000;
const geoCache = new Map<string, { value: GeoPlace | null; exp: number }>();

/**
 * Géocode un nom de ville -> coordonnées + fuseau horaire via l'API open-meteo
 * (gratuite, sans clé). Hôte FIXE + `redirect: "error"` (anti-SSRF). Met en
 * cache les résultats (y compris les échecs, TTL court) pour éviter de marteler.
 */
async function geocodeCity(name: string): Promise<GeoPlace | null> {
  const key = name.trim().toLowerCase();
  if (key.length < 2) return null;
  const now = Date.now();
  const hit = geoCache.get(key);
  if (hit && hit.exp > now) return hit.value;
  let place: GeoPlace | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OPEN_METEO_TIMEOUT_MS);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=fr&format=json`;
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    clearTimeout(timer);
    if (resp.ok) {
      const json = (await resp.json()) as {
        results?: Array<{
          name?: string;
          country?: string;
          admin1?: string;
          latitude?: number;
          longitude?: number;
          timezone?: string;
        }>;
      };
      const r = json.results?.[0];
      if (r && typeof r.latitude === "number" && typeof r.longitude === "number") {
        const parts = [
          r.name,
          r.admin1 && r.admin1 !== r.name ? r.admin1 : null,
          r.country,
        ].filter((x): x is string => Boolean(x));
        place = {
          label: parts.join(", "),
          latitude: r.latitude,
          longitude: r.longitude,
          timezone: r.timezone || "auto",
        };
      }
    }
  } catch {
    place = null;
  }
  boundedCacheSet(geoCache, key, { value: place, exp: now + (place ? GEO_TTL_MS : GEO_NULL_TTL_MS) }, GEO_MAX_ENTRIES);
  return place;
}

// --- Météo (open-meteo, gratuit, sans clé) -------------------------------

interface WeatherNow {
  tempC: number;
  code: number;
  humidity: number | null;
  wind: number | null;
  max: number | null;
  min: number | null;
}

const WEATHER_TTL_MS = 20 * 60_000;
const weatherCache = new Map<string, { value: WeatherNow | null; exp: number }>();

// Codes WMO -> description FR + emoji (open-meteo `weather_code`).
const WEATHER_CODES: Record<number, { fr: string; emoji: string }> = {
  0: { fr: "Ciel dégagé", emoji: "☀️" },
  1: { fr: "Plutôt dégagé", emoji: "🌤️" },
  2: { fr: "Partiellement nuageux", emoji: "⛅" },
  3: { fr: "Couvert", emoji: "☁️" },
  45: { fr: "Brouillard", emoji: "🌫️" },
  48: { fr: "Brouillard givrant", emoji: "🌫️" },
  51: { fr: "Bruine légère", emoji: "🌦️" },
  53: { fr: "Bruine", emoji: "🌦️" },
  55: { fr: "Bruine dense", emoji: "🌦️" },
  56: { fr: "Bruine verglaçante", emoji: "🌧️" },
  57: { fr: "Bruine verglaçante dense", emoji: "🌧️" },
  61: { fr: "Pluie faible", emoji: "🌧️" },
  63: { fr: "Pluie", emoji: "🌧️" },
  65: { fr: "Pluie forte", emoji: "🌧️" },
  66: { fr: "Pluie verglaçante", emoji: "🌧️" },
  67: { fr: "Pluie verglaçante forte", emoji: "🌧️" },
  71: { fr: "Neige faible", emoji: "🌨️" },
  73: { fr: "Neige", emoji: "❄️" },
  75: { fr: "Neige forte", emoji: "❄️" },
  77: { fr: "Grains de neige", emoji: "🌨️" },
  80: { fr: "Averses faibles", emoji: "🌦️" },
  81: { fr: "Averses", emoji: "🌦️" },
  82: { fr: "Averses violentes", emoji: "⛈️" },
  85: { fr: "Averses de neige", emoji: "🌨️" },
  86: { fr: "Averses de neige fortes", emoji: "🌨️" },
  95: { fr: "Orage", emoji: "⛈️" },
  96: { fr: "Orage avec grêle", emoji: "⛈️" },
  99: { fr: "Orage avec forte grêle", emoji: "⛈️" },
};

async function fetchWeather(lat: number, lon: number): Promise<WeatherNow | null> {
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const now = Date.now();
  const hit = weatherCache.get(key);
  if (hit && hit.exp > now) return hit.value;
  let weather: WeatherNow | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OPEN_METEO_TIMEOUT_MS);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    clearTimeout(timer);
    if (resp.ok) {
      const json = (await resp.json()) as {
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          weather_code?: number;
          wind_speed_10m?: number;
        };
        daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
      };
      const cur = json.current;
      if (cur && typeof cur.temperature_2m === "number" && typeof cur.weather_code === "number") {
        weather = {
          tempC: cur.temperature_2m,
          code: cur.weather_code,
          humidity: typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null,
          wind: typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : null,
          max: json.daily?.temperature_2m_max?.[0] ?? null,
          min: json.daily?.temperature_2m_min?.[0] ?? null,
        };
      }
    }
  } catch {
    weather = null;
  }
  boundedCacheSet(weatherCache, key, { value: weather, exp: now + WEATHER_TTL_MS }, WEATHER_MAX_ENTRIES);
  return weather;
}

/**
 * Extrait la localité d'une requête météo (FR/EN/TR), ou `null` si la requête
 * n'est pas une demande météo (ou si aucune ville n'est précisée).
 */
function extractWeatherLocation(raw: string): string | null {
  const s = raw.trim();
  let loc: string | null = null;
  // Un séparateur explicite (préposition, espace ou « : ») est OBLIGATOIRE entre
  // le mot-clé et la ville. Empêche « weathering », « meteora » de déclencher
  // un appel réseau : sans séparateur, aucune correspondance.
  const lead = s.match(
    /^(?:météo|meteo|prévisions?|previsions?|quel\s+temps(?:\s+fait[- ]il)?|weather|hava\s+durumu)(?:\s+(?:à|au|aux|de|d'|du|en|dans|pour|in)\s+|[\s:]+)(.+)$/i,
  );
  if (lead) {
    loc = lead[1];
  } else {
    const trail = s.match(/^(.+?)\s+(?:hava\s+durumu|weather|météo|meteo)$/i);
    if (trail) loc = trail[1];
  }
  if (loc === null) return null;
  loc = loc
    .replace(/\b(aujourd'?hui|maintenant|cette\s+semaine|demain|today|now|şu\s+an|bugün)\b/gi, "")
    .replace(/[?.!,]/g, "")
    .trim();
  if (loc.length < 2 || loc.length > 60) return null;
  return loc;
}

async function tryWeather(query: string): Promise<InstantAnswer | null> {
  const loc = extractWeatherLocation(query);
  if (!loc) return null;
  const place = await geocodeCity(loc);
  if (!place) return null;
  const w = await fetchWeather(place.latitude, place.longitude);
  if (!w) return null;
  const desc = WEATHER_CODES[w.code] ?? { fr: "Conditions actuelles", emoji: "🌡️" };
  const detailParts: string[] = [];
  if (w.max !== null && w.min !== null) {
    detailParts.push(`Max ${Math.round(w.max)}° · Min ${Math.round(w.min)}°`);
  }
  if (w.humidity !== null) detailParts.push(`Humidité ${Math.round(w.humidity)} %`);
  if (w.wind !== null) detailParts.push(`Vent ${Math.round(w.wind)} km/h`);
  return {
    kind: "weather",
    expression: `Météo · ${place.label}`,
    result: `${desc.emoji} ${Math.round(w.tempC)} °C · ${desc.fr}`,
    detail: detailParts.length ? detailParts.join(" · ") : undefined,
  };
}

// --- Date & heure (local, ou fuseau d'une ville via le géocodeur) --------

function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatInTz(tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: tz }).format(new Date());
}

async function tryDateTime(query: string): Promise<InstantAnswer | null> {
  const raw = query.trim().replace(/[?.!]+$/g, "").trim();
  let kind: "time" | "date" | null = null;
  let cityPart = "";
  // Une ville n'est acceptée que si elle est introduite par une préposition
  // explicite (« à Tokyo », « in Tokyo »). Sinon la requête doit correspondre
  // EXACTEMENT au motif date/heure : « aujourd'hui paris » (sans préposition)
  // ne déclenche donc PAS de carte et laisse la recherche web répondre.
  const timeM = raw.match(
    /^(?:quelle?\s+heure(?:\s+est[- ]il)?|heure\s+actuelle|what\s+time\s+is\s+it|time\s+now|saat\s+kaç)(?:\s+(?:à|au|aux|in)\s+(.+))?$/i,
  );
  const dateM = raw.match(
    /^(?:quel(?:le)?\s+jour\s+(?:sommes[- ]nous|est[- ]on|on\s+est)|on\s+est\s+quel\s+jour|quelle?\s+date|date\s+du\s+jour|date\s+d'?aujourd'?hui|aujourd'?hui|what'?s?\s+(?:the\s+)?date|today'?s?\s+date|hangi\s+gün|bugün(?:\s+ne)?)(?:\s+(?:à|au|aux|in)\s+(.+))?$/i,
  );
  if (timeM) {
    kind = "time";
    cityPart = (timeM[1] || "").trim();
  } else if (dateM) {
    kind = "date";
    cityPart = (dateM[1] || "").trim();
  } else {
    return null;
  }

  let tz = "Europe/Paris";
  let label = "France";
  if (cityPart.length >= 2 && cityPart.length <= 60) {
    const place = await geocodeCity(cityPart);
    if (!place) return null; // ville inconnue -> on laisse la recherche web répondre
    label = place.label;
    if (place.timezone && place.timezone !== "auto") tz = place.timezone;
  }

  try {
    const time = formatInTz(tz, { hour: "2-digit", minute: "2-digit" });
    const date = capitalizeFirst(
      formatInTz(tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    );
    if (kind === "time") {
      return { kind: "datetime", expression: `Heure · ${label}`, result: time, detail: date };
    }
    return { kind: "datetime", expression: `Date · ${label}`, result: date, detail: `Il est ${time}` };
  } catch {
    return null;
  }
}

// --- Point d'entrée ------------------------------------------------------

/**
 * Tente de résoudre une "réponse instantanée" pour la requête. Renvoie `null`
 * si rien ne correspond (le cas le plus fréquent). Ne lève jamais : toute
 * erreur réseau (devises) retombe sur `null`.
 */
export async function resolveInstantAnswer(rawQuery: string): Promise<InstantAnswer | null> {
  const query = rawQuery.trim();
  if (query.length < 2 || query.length > 140) return null;
  try {
    // Date/heure et météo d'abord (déclenchées par des mots-clés explicites),
    // puis devises (motif spécifique), puis unités, puis calcul.
    const dt = await tryDateTime(query);
    if (dt) return dt;
    const weather = await tryWeather(query);
    if (weather) return weather;
    const currency = await tryCurrencyConversion(query);
    if (currency) return currency;
    const unit = tryUnitConversion(query);
    if (unit) return unit;
    const calc = tryCalculator(query);
    if (calc) return calc;
  } catch (err) {
    logger.warn({ err }, "[instant-answer] resolution failed");
  }
  return null;
}
