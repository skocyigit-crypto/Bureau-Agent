import { logger } from "../lib/logger";

export interface MathSubComponent {
  id: string;
  expression: string;
  type: MathType;
  result: number | string;
  steps: string[];
  unit?: string;
  confidence: number;
}

export interface MathAnalysis {
  original: string;
  detected: boolean;
  subComponents: MathSubComponent[];
  finalResult?: number | string;
  summary: string;
  category: MathCategory;
}

export type MathType =
  | "arithmetic"
  | "percentage"
  | "fraction"
  | "power"
  | "root"
  | "logarithm"
  | "trigonometry"
  | "equation"
  | "conversion"
  | "financial"
  | "statistics"
  | "geometry"
  | "date_calc"
  | "ratio"
  | "comparison";

export type MathCategory =
  | "basic"
  | "financial"
  | "scientific"
  | "statistics"
  | "geometry"
  | "conversion"
  | "business"
  | "mixed";

const MATH_PATTERNS: { pattern: RegExp; type: MathType }[] = [
  { pattern: /(\d+[\.,]?\d*)\s*%\s*(de|of|sur|from)?\s*(\d+[\.,]?\d*)/gi, type: "percentage" },
  { pattern: /(\d+[\.,]?\d*)\s*%/gi, type: "percentage" },
  { pattern: /(\d+[\.,]?\d*)\s*[+\-*/×÷]\s*(\d+[\.,]?\d*)/g, type: "arithmetic" },
  { pattern: /(\d+[\.,]?\d*)\s*\^\s*(\d+[\.,]?\d*)/g, type: "power" },
  { pattern: /(?:sqrt|racine|√)\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi, type: "root" },
  { pattern: /(?:log|ln)\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi, type: "logarithm" },
  { pattern: /(?:sin|cos|tan|asin|acos|atan)\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi, type: "trigonometry" },
  { pattern: /(\d+[\.,]?\d*)\s*\/\s*(\d+[\.,]?\d*)/g, type: "fraction" },
  { pattern: /(\d+[\.,]?\d*)\s*(?:EUR|€|euro|euros|TL|₺|USD|\$|£|GBP)\s*/gi, type: "financial" },
  { pattern: /(?:TVA|tva|HT|TTC|ht|ttc)\s*:?\s*(\d+[\.,]?\d*)/gi, type: "financial" },
  { pattern: /(?:moyenne|average|avg|moy)\s*(?:de|of)?\s*[\(\[]?([\d,.\s;]+)[\)\]]?/gi, type: "statistics" },
  { pattern: /(?:somme|sum|total)\s*(?:de|of)?\s*[\(\[]?([\d,.\s;]+)[\)\]]?/gi, type: "statistics" },
  { pattern: /(\d+[\.,]?\d*)\s*(?:km|m|cm|mm|mi|ft|in|kg|g|lb|oz|l|ml|gal)\b/gi, type: "conversion" },
  { pattern: /(\d+[\.,]?\d*)\s*:\s*(\d+[\.,]?\d*)/g, type: "ratio" },
  { pattern: /(\d+[\.,]?\d*)\s*(?:>|<|>=|<=|≥|≤)\s*(\d+[\.,]?\d*)/g, type: "comparison" },
  { pattern: /(?:aire|area|surface|perimetre|perimeter|volume|rayon|radius|diametre|diameter)\s*(?:=|:)?\s*(\d+[\.,]?\d*)/gi, type: "geometry" },
  { pattern: /(?:pi|π)\s*[*×]?\s*(\d+[\.,]?\d*)?/gi, type: "geometry" },
  { pattern: /(\d+[\.,]?\d*)\s*(?:jours|days|mois|months|ans|years|heures|hours|minutes|min|semaines|weeks)/gi, type: "date_calc" },
  { pattern: /(\d+[\.,]?\d*)\s*(?:=|x)\s*\?/gi, type: "equation" },
];

function normalizeNumber(s: string): number {
  return parseFloat(s.replace(",", "."));
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("fr-FR");
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function processPercentage(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];

  const fullPattern = /(\d+[\.,]?\d*)\s*%\s*(?:de|of|sur|from)\s+(\d+[\.,]?\d*)/gi;
  let match;
  while ((match = fullPattern.exec(text)) !== null) {
    const pct = normalizeNumber(match[1]);
    const base = normalizeNumber(match[2]);
    const result = (pct / 100) * base;
    results.push({
      id: `pct_${results.length}`,
      expression: match[0],
      type: "percentage",
      result,
      steps: [
        `${pct}% de ${formatNumber(base)}`,
        `= ${pct} / 100 × ${formatNumber(base)}`,
        `= ${formatNumber(pct / 100)} × ${formatNumber(base)}`,
        `= ${formatNumber(result)}`,
      ],
      confidence: 0.95,
    });
  }

  const simplePattern = /(\d+[\.,]?\d*)\s*%/gi;
  while ((match = simplePattern.exec(text)) !== null) {
    const alreadyCovered = results.some(r => {
      const idx = text.indexOf(r.expression);
      return match!.index >= idx && match!.index < idx + r.expression.length;
    });
    if (alreadyCovered) continue;

    const pct = normalizeNumber(match[1]);
    results.push({
      id: `pct_simple_${results.length}`,
      expression: match[0],
      type: "percentage",
      result: pct / 100,
      steps: [`${pct}%`, `= ${pct} / 100`, `= ${formatNumber(pct / 100)}`],
      confidence: 0.8,
    });
  }

  return results;
}

function processArithmetic(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(\d+[\.,]?\d*)\s*([+\-*/×÷])\s*(\d+[\.,]?\d*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const a = normalizeNumber(match[1]);
    const op = match[2].replace("×", "*").replace("÷", "/");
    const b = normalizeNumber(match[3]);

    const opNames: Record<string, string> = { "+": "Addition", "-": "Soustraction", "*": "Multiplication", "/": "Division" };
    let result: number;
    switch (op) {
      case "+": result = a + b; break;
      case "-": result = a - b; break;
      case "*": result = a * b; break;
      case "/": result = b !== 0 ? a / b : NaN; break;
      default: continue;
    }

    results.push({
      id: `arith_${results.length}`,
      expression: match[0],
      type: "arithmetic",
      result,
      steps: [
        `${opNames[op] || "Operation"}: ${formatNumber(a)} ${match[2]} ${formatNumber(b)}`,
        `= ${formatNumber(result)}`,
      ],
      confidence: 0.99,
    });
  }

  return results;
}

function processPower(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(\d+[\.,]?\d*)\s*\^\s*(\d+[\.,]?\d*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const base = normalizeNumber(match[1]);
    const exp = normalizeNumber(match[2]);
    const result = Math.pow(base, exp);
    results.push({
      id: `pow_${results.length}`,
      expression: match[0],
      type: "power",
      result,
      steps: [
        `Puissance: ${formatNumber(base)} ^ ${formatNumber(exp)}`,
        `= ${formatNumber(base)} eleve a la puissance ${formatNumber(exp)}`,
        `= ${formatNumber(result)}`,
      ],
      confidence: 0.95,
    });
  }
  return results;
}

function processRoot(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(?:sqrt|racine|√)\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const n = normalizeNumber(match[1]);
    const result = Math.sqrt(n);
    results.push({
      id: `root_${results.length}`,
      expression: match[0],
      type: "root",
      result,
      steps: [
        `Racine carree de ${formatNumber(n)}`,
        `= √${formatNumber(n)}`,
        `= ${formatNumber(result)}`,
      ],
      confidence: 0.95,
    });
  }
  return results;
}

function processLogarithm(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const lnPattern = /ln\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi;
  let match;

  while ((match = lnPattern.exec(text)) !== null) {
    const n = normalizeNumber(match[1]);
    const result = Math.log(n);
    results.push({
      id: `ln_${results.length}`,
      expression: match[0],
      type: "logarithm",
      result,
      steps: [`Logarithme naturel de ${formatNumber(n)}`, `ln(${formatNumber(n)})`, `= ${formatNumber(result)}`],
      confidence: 0.95,
    });
  }

  const logPattern = /log\s*\(?\s*(\d+[\.,]?\d*)\s*\)?/gi;
  while ((match = logPattern.exec(text)) !== null) {
    const n = normalizeNumber(match[1]);
    const result = Math.log10(n);
    results.push({
      id: `log_${results.length}`,
      expression: match[0],
      type: "logarithm",
      result,
      steps: [`Logarithme base 10 de ${formatNumber(n)}`, `log₁₀(${formatNumber(n)})`, `= ${formatNumber(result)}`],
      confidence: 0.95,
    });
  }
  return results;
}

function processTrigonometry(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const funcs = ["sin", "cos", "tan", "asin", "acos", "atan"];

  for (const fn of funcs) {
    const pattern = new RegExp(`${fn}\\s*\\(?\\s*(\\d+[\\.,]?\\d*)\\s*\\)?`, "gi");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const n = normalizeNumber(match[1]);
      const rad = (n * Math.PI) / 180;
      let result: number;
      const names: Record<string, string> = {
        sin: "Sinus", cos: "Cosinus", tan: "Tangente",
        asin: "Arc sinus", acos: "Arc cosinus", atan: "Arc tangente"
      };

      switch (fn.toLowerCase()) {
        case "sin": result = Math.sin(rad); break;
        case "cos": result = Math.cos(rad); break;
        case "tan": result = Math.tan(rad); break;
        case "asin": result = (Math.asin(n) * 180) / Math.PI; break;
        case "acos": result = (Math.acos(n) * 180) / Math.PI; break;
        case "atan": result = (Math.atan(n) * 180) / Math.PI; break;
        default: continue;
      }

      results.push({
        id: `trig_${fn}_${results.length}`,
        expression: match[0],
        type: "trigonometry",
        result,
        steps: [
          `${names[fn.toLowerCase()] || fn}(${formatNumber(n)}°)`,
          fn.startsWith("a") ? `= ${formatNumber(result)}°` : `Conversion en radians: ${formatNumber(rad)} rad`,
          `= ${formatNumber(result)}`,
        ],
        confidence: 0.9,
      });
    }
  }
  return results;
}

function processStatistics(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];

  const avgPattern = /(?:moyenne|average|avg|moy)\s*(?:de|of)?\s*[\(\[]?([\d,.\s;]+)[\)\]]?/gi;
  let match;
  while ((match = avgPattern.exec(text)) !== null) {
    const numbers = match[1].split(/[;\s,]+/).filter(s => s.trim()).map(normalizeNumber).filter(n => !isNaN(n));
    if (numbers.length === 0) continue;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const avg = sum / numbers.length;
    results.push({
      id: `avg_${results.length}`,
      expression: match[0],
      type: "statistics",
      result: avg,
      steps: [
        `Moyenne de [${numbers.map(formatNumber).join(", ")}]`,
        `Somme: ${formatNumber(sum)}`,
        `Nombre d'elements: ${numbers.length}`,
        `Moyenne: ${formatNumber(sum)} / ${numbers.length} = ${formatNumber(avg)}`,
      ],
      confidence: 0.9,
    });
  }

  const sumPattern = /(?:somme|sum|total)\s*(?:de|of)?\s*[\(\[]?([\d,.\s;]+)[\)\]]?/gi;
  while ((match = sumPattern.exec(text)) !== null) {
    const numbers = match[1].split(/[;\s,]+/).filter(s => s.trim()).map(normalizeNumber).filter(n => !isNaN(n));
    if (numbers.length === 0) continue;
    const sum = numbers.reduce((a, b) => a + b, 0);
    results.push({
      id: `sum_${results.length}`,
      expression: match[0],
      type: "statistics",
      result: sum,
      steps: [
        `Somme de [${numbers.map(formatNumber).join(", ")}]`,
        `= ${numbers.map(formatNumber).join(" + ")}`,
        `= ${formatNumber(sum)}`,
      ],
      confidence: 0.9,
    });
  }

  return results;
}

function processFinancial(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];

  const tvaHTPattern = /(\d+[\.,]?\d*)\s*(?:€|EUR|euros?)\s*(?:HT|ht)/gi;
  let match;
  while ((match = tvaHTPattern.exec(text)) !== null) {
    const ht = normalizeNumber(match[1]);
    const tva = ht * 0.20;
    const ttc = ht + tva;
    results.push({
      id: `fin_tva_${results.length}`,
      expression: match[0],
      type: "financial",
      result: ttc,
      steps: [
        `Montant HT: ${formatNumber(ht)} €`,
        `TVA 20%: ${formatNumber(ht)} × 0,20 = ${formatNumber(tva)} €`,
        `Montant TTC: ${formatNumber(ht)} + ${formatNumber(tva)} = ${formatNumber(ttc)} €`,
      ],
      unit: "€",
      confidence: 0.9,
    });
  }

  const tvaTTCPattern = /(\d+[\.,]?\d*)\s*(?:€|EUR|euros?)\s*(?:TTC|ttc)/gi;
  while ((match = tvaTTCPattern.exec(text)) !== null) {
    const ttc = normalizeNumber(match[1]);
    const ht = ttc / 1.20;
    const tva = ttc - ht;
    results.push({
      id: `fin_ttc_${results.length}`,
      expression: match[0],
      type: "financial",
      result: ht,
      steps: [
        `Montant TTC: ${formatNumber(ttc)} €`,
        `Montant HT: ${formatNumber(ttc)} / 1,20 = ${formatNumber(ht)} €`,
        `TVA 20%: ${formatNumber(ttc)} - ${formatNumber(ht)} = ${formatNumber(tva)} €`,
      ],
      unit: "€",
      confidence: 0.9,
    });
  }

  const margePattern = /(?:marge|margin|benefice|profit)\s*:?\s*(\d+[\.,]?\d*)\s*(?:€|EUR)?\s*(?:sur|de|on)\s*(\d+[\.,]?\d*)/gi;
  while ((match = margePattern.exec(text)) !== null) {
    const profit = normalizeNumber(match[1]);
    const revenue = normalizeNumber(match[2]);
    const margePct = (profit / revenue) * 100;
    results.push({
      id: `fin_marge_${results.length}`,
      expression: match[0],
      type: "financial",
      result: margePct,
      steps: [
        `Benefice: ${formatNumber(profit)} €`,
        `Chiffre d'affaires: ${formatNumber(revenue)} €`,
        `Taux de marge: ${formatNumber(profit)} / ${formatNumber(revenue)} × 100`,
        `= ${formatNumber(margePct)}%`,
      ],
      unit: "%",
      confidence: 0.85,
    });
  }

  return results;
}

function processConversion(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const conversions: Record<string, { to: string; factor: number; label: string }> = {
    km: { to: "m", factor: 1000, label: "metres" },
    m: { to: "cm", factor: 100, label: "centimetres" },
    cm: { to: "mm", factor: 10, label: "millimetres" },
    kg: { to: "g", factor: 1000, label: "grammes" },
    g: { to: "mg", factor: 1000, label: "milligrammes" },
    l: { to: "ml", factor: 1000, label: "millilitres" },
    mi: { to: "km", factor: 1.60934, label: "kilometres" },
    ft: { to: "m", factor: 0.3048, label: "metres" },
    lb: { to: "kg", factor: 0.453592, label: "kilogrammes" },
    oz: { to: "g", factor: 28.3495, label: "grammes" },
    gal: { to: "l", factor: 3.78541, label: "litres" },
  };

  const pattern = /(\d+[\.,]?\d*)\s*(km|m|cm|mm|mi|ft|in|kg|g|lb|oz|l|ml|gal)\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = normalizeNumber(match[1]);
    const unit = match[2].toLowerCase();
    const conv = conversions[unit];
    if (!conv) continue;

    const result = value * conv.factor;
    results.push({
      id: `conv_${results.length}`,
      expression: match[0],
      type: "conversion",
      result,
      steps: [
        `${formatNumber(value)} ${unit}`,
        `1 ${unit} = ${formatNumber(conv.factor)} ${conv.to}`,
        `${formatNumber(value)} × ${formatNumber(conv.factor)} = ${formatNumber(result)} ${conv.to}`,
      ],
      unit: conv.to,
      confidence: 0.9,
    });
  }
  return results;
}

function processGeometry(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];

  const circlePattern = /(?:aire|area|surface)\s*(?:du\s*)?(?:cercle|circle)\s*(?:de\s*)?(?:rayon|radius|r)\s*(?:=|:)?\s*(\d+[\.,]?\d*)/gi;
  let match;
  while ((match = circlePattern.exec(text)) !== null) {
    const r = normalizeNumber(match[1]);
    const area = Math.PI * r * r;
    results.push({
      id: `geo_circle_${results.length}`,
      expression: match[0],
      type: "geometry",
      result: area,
      steps: [
        `Aire du cercle de rayon ${formatNumber(r)}`,
        `A = π × r²`,
        `A = π × ${formatNumber(r)}²`,
        `A = ${formatNumber(Math.PI)} × ${formatNumber(r * r)}`,
        `A = ${formatNumber(area)}`,
      ],
      confidence: 0.9,
    });
  }

  const rectPattern = /(?:aire|area|surface)\s*(?:du\s*)?(?:rectangle|rect)\s*(\d+[\.,]?\d*)\s*[x×*]\s*(\d+[\.,]?\d*)/gi;
  while ((match = rectPattern.exec(text)) !== null) {
    const w = normalizeNumber(match[1]);
    const h = normalizeNumber(match[2]);
    const area = w * h;
    results.push({
      id: `geo_rect_${results.length}`,
      expression: match[0],
      type: "geometry",
      result: area,
      steps: [
        `Aire du rectangle ${formatNumber(w)} × ${formatNumber(h)}`,
        `A = largeur × hauteur`,
        `A = ${formatNumber(w)} × ${formatNumber(h)}`,
        `A = ${formatNumber(area)}`,
      ],
      confidence: 0.9,
    });
  }

  return results;
}

function processRatio(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(\d+[\.,]?\d*)\s*:\s*(\d+[\.,]?\d*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const a = normalizeNumber(match[1]);
    const b = normalizeNumber(match[2]);
    if (a === 0 && b === 0) continue;
    const gcd = getGCD(a, b);
    const simplA = a / gcd;
    const simplB = b / gcd;
    const pctA = (a / (a + b)) * 100;
    const pctB = (b / (a + b)) * 100;

    results.push({
      id: `ratio_${results.length}`,
      expression: match[0],
      type: "ratio",
      result: `${formatNumber(simplA)}:${formatNumber(simplB)}`,
      steps: [
        `Ratio: ${formatNumber(a)} : ${formatNumber(b)}`,
        `Forme simplifiee: ${formatNumber(simplA)} : ${formatNumber(simplB)}`,
        `Proportion: ${formatNumber(pctA)}% / ${formatNumber(pctB)}%`,
      ],
      confidence: 0.85,
    });
  }
  return results;
}

function processComparison(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(\d+[\.,]?\d*)\s*(>|<|>=|<=|≥|≤)\s*(\d+[\.,]?\d*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const a = normalizeNumber(match[1]);
    const op = match[2];
    const b = normalizeNumber(match[3]);

    let result: boolean;
    let opName: string;
    switch (op) {
      case ">": result = a > b; opName = "superieur a"; break;
      case "<": result = a < b; opName = "inferieur a"; break;
      case ">=": case "≥": result = a >= b; opName = "superieur ou egal a"; break;
      case "<=": case "≤": result = a <= b; opName = "inferieur ou egal a"; break;
      default: continue;
    }

    results.push({
      id: `cmp_${results.length}`,
      expression: match[0],
      type: "comparison",
      result: result ? "Vrai" : "Faux",
      steps: [
        `Comparaison: ${formatNumber(a)} ${op} ${formatNumber(b)}`,
        `${formatNumber(a)} est ${opName} ${formatNumber(b)} ?`,
        `Resultat: ${result ? "Vrai" : "Faux"}`,
      ],
      confidence: 0.95,
    });
  }
  return results;
}

function processFraction(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const pattern = /(\d+[\.,]?\d*)\s*\/\s*(\d+[\.,]?\d*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const num = normalizeNumber(match[1]);
    const den = normalizeNumber(match[2]);
    if (den === 0) continue;

    const result = num / den;
    const gcd = getGCD(Math.round(num), Math.round(den));
    const simplNum = Math.round(num) / gcd;
    const simplDen = Math.round(den) / gcd;

    results.push({
      id: `frac_${results.length}`,
      expression: match[0],
      type: "fraction",
      result,
      steps: [
        `Fraction: ${formatNumber(num)} / ${formatNumber(den)}`,
        ...(gcd > 1 ? [`Forme simplifiee: ${formatNumber(simplNum)} / ${formatNumber(simplDen)}`] : []),
        `= ${formatNumber(result)}`,
      ],
      confidence: 0.9,
    });
  }
  return results;
}

function processDateCalc(text: string): MathSubComponent[] {
  const results: MathSubComponent[] = [];
  const unitMap: Record<string, { ms: number; label: string }> = {
    jours: { ms: 86400000, label: "jour(s)" },
    days: { ms: 86400000, label: "jour(s)" },
    heures: { ms: 3600000, label: "heure(s)" },
    hours: { ms: 3600000, label: "heure(s)" },
    minutes: { ms: 60000, label: "minute(s)" },
    min: { ms: 60000, label: "minute(s)" },
    semaines: { ms: 604800000, label: "semaine(s)" },
    weeks: { ms: 604800000, label: "semaine(s)" },
    mois: { ms: 2592000000, label: "mois" },
    months: { ms: 2592000000, label: "mois" },
    ans: { ms: 31536000000, label: "an(s)" },
    years: { ms: 31536000000, label: "an(s)" },
  };

  const pattern = /(\d+[\.,]?\d*)\s*(jours|days|mois|months|ans|years|heures|hours|minutes|min|semaines|weeks)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const value = normalizeNumber(match[1]);
    const unit = match[2].toLowerCase();
    const info = unitMap[unit];
    if (!info) continue;

    const totalMs = value * info.ms;
    const totalDays = totalMs / 86400000;
    const totalHours = totalMs / 3600000;

    const steps = [`${formatNumber(value)} ${info.label}`];
    if (unit !== "jours" && unit !== "days") {
      steps.push(`= ${formatNumber(totalDays)} jour(s)`);
    }
    if (unit !== "heures" && unit !== "hours") {
      steps.push(`= ${formatNumber(totalHours)} heure(s)`);
    }

    const futureDate = new Date(Date.now() + totalMs);
    steps.push(`Date cible: ${futureDate.toLocaleDateString("fr-FR")}`);

    results.push({
      id: `date_${results.length}`,
      expression: match[0],
      type: "date_calc",
      result: `${formatNumber(totalDays)} jours`,
      steps,
      confidence: 0.85,
    });
  }
  return results;
}

function getGCD(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

function determineCategory(subComponents: MathSubComponent[]): MathCategory {
  const types = new Set(subComponents.map(s => s.type));
  if (types.size === 0) return "basic";
  if (types.size === 1) {
    const t = [...types][0];
    if (t === "financial") return "financial";
    if (t === "statistics") return "statistics";
    if (t === "geometry") return "geometry";
    if (t === "conversion") return "conversion";
    if (t === "trigonometry" || t === "logarithm") return "scientific";
    return "basic";
  }
  if (types.has("financial")) return "business";
  return "mixed";
}

export function detectMathExpressions(text: string): boolean {
  return MATH_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function analyzeMath(text: string): MathAnalysis {
  const subComponents: MathSubComponent[] = [];

  subComponents.push(...processPercentage(text));
  subComponents.push(...processArithmetic(text));
  subComponents.push(...processPower(text));
  subComponents.push(...processRoot(text));
  subComponents.push(...processLogarithm(text));
  subComponents.push(...processTrigonometry(text));
  subComponents.push(...processStatistics(text));
  subComponents.push(...processFinancial(text));
  subComponents.push(...processConversion(text));
  subComponents.push(...processGeometry(text));
  subComponents.push(...processRatio(text));
  subComponents.push(...processComparison(text));
  subComponents.push(...processFraction(text));
  subComponents.push(...processDateCalc(text));

  const uniqueComponents = deduplicateComponents(subComponents);
  const category = determineCategory(uniqueComponents);

  let finalResult: number | string | undefined;
  if (uniqueComponents.length === 1) {
    finalResult = uniqueComponents[0].result;
  } else if (uniqueComponents.length > 1) {
    const numericResults = uniqueComponents.map(c => typeof c.result === "number" ? c.result : NaN).filter(n => !isNaN(n));
    if (numericResults.length > 0) {
      finalResult = numericResults[numericResults.length - 1];
    }
  }

  const summary = generateSummary(uniqueComponents, category);

  return {
    original: text,
    detected: uniqueComponents.length > 0,
    subComponents: uniqueComponents,
    finalResult,
    summary,
    category,
  };
}

function deduplicateComponents(components: MathSubComponent[]): MathSubComponent[] {
  const seen = new Set<string>();
  return components.filter(c => {
    const key = `${c.type}:${c.expression.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateSummary(components: MathSubComponent[], category: MathCategory): string {
  if (components.length === 0) return "Aucune expression mathematique detectee.";

  const categoryNames: Record<MathCategory, string> = {
    basic: "Calcul de base",
    financial: "Calcul financier",
    scientific: "Calcul scientifique",
    statistics: "Calcul statistique",
    geometry: "Calcul geometrique",
    conversion: "Conversion d'unites",
    business: "Calcul commercial",
    mixed: "Calcul mixte",
  };

  const typeCount = components.length;
  const types = [...new Set(components.map(c => c.type))];

  return `${categoryNames[category]} — ${typeCount} sous-composant${typeCount > 1 ? "s" : ""} detecte${typeCount > 1 ? "s" : ""} (${types.join(", ")}).`;
}

export async function analyzeWithAI(text: string, basicAnalysis: MathAnalysis): Promise<MathAnalysis> {
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es un moteur mathematique avance. Analyse le texte suivant et identifie TOUTES les expressions mathematiques, meme implicites.

Texte: "${text}"

Analyse de base deja effectuee:
${JSON.stringify(basicAnalysis.subComponents.map(c => ({ expression: c.expression, type: c.type, result: c.result })), null, 2)}

Si tu detectes des expressions supplementaires non couvertes, ou des erreurs dans l'analyse de base, reponds en JSON:
{
  "additionalComponents": [
    {
      "expression": "string",
      "type": "string (arithmetic|percentage|financial|statistics|equation|geometry|conversion|comparison)",
      "result": "number ou string",
      "steps": ["string"],
      "explanation": "string"
    }
  ],
  "corrections": [
    {
      "originalExpression": "string",
      "correctedResult": "number",
      "reason": "string"
    }
  ],
  "enhancedSummary": "string (resume enrichi en francais)"
}

Si aucune correction ou ajout n'est necessaire, retourne des tableaux vides.`
        }],
      }],
      config: {
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");

    const enhanced = { ...basicAnalysis };

    if (parsed.additionalComponents?.length > 0) {
      for (const ac of parsed.additionalComponents) {
        enhanced.subComponents.push({
          id: `ai_${enhanced.subComponents.length}`,
          expression: ac.expression,
          type: ac.type as MathType,
          result: ac.result,
          steps: ac.steps || [ac.explanation || "Detecte par IA"],
          confidence: 0.8,
        });
      }
    }

    if (parsed.corrections?.length > 0) {
      for (const corr of parsed.corrections) {
        const target = enhanced.subComponents.find(c => c.expression === corr.originalExpression);
        if (target) {
          target.result = corr.correctedResult;
          target.steps.push(`Correction IA: ${corr.reason}`);
        }
      }
    }

    if (parsed.enhancedSummary) {
      enhanced.summary = parsed.enhancedSummary;
    }

    enhanced.category = determineCategory(enhanced.subComponents);
    return enhanced;
  } catch (error) {
    logger.error({ err: error }, "AI math enhancement error:");
    return basicAnalysis;
  }
}
