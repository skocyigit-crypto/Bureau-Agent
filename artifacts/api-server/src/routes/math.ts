import { Router } from "express";
import { detectMathExpressions, analyzeMath, analyzeWithAI } from "../services/math-engine";
import { logger } from "../lib/logger";

const router = Router();

router.post("/math/detect", async (req, res): Promise<void> => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "Le parametre 'text' est requis." });
      return;
    }
    const detected = detectMathExpressions(text);
    res.json({ detected, text });
  } catch (error: any) {
    logger.error({ err: error }, "Math detect error:");
    res.status(500).json({ error: "Erreur de detection mathematique." });
  }
});

router.post("/math/analyze", async (req, res): Promise<void> => {
  try {
    const { text, useAI = false } = req.body;
    if (!text) {
      res.status(400).json({ error: "Le parametre 'text' est requis." });
      return;
    }

    let analysis = analyzeMath(text);

    if (useAI && analysis.subComponents.length > 0) {
      analysis = await analyzeWithAI(text, analysis);
    }

    res.json(analysis);
  } catch (error: any) {
    logger.error({ err: error }, "Math analyze error:");
    res.status(500).json({ error: "Erreur d'analyse mathematique." });
  }
});

router.post("/math/evaluate", async (req, res): Promise<void> => {
  try {
    const { expressions } = req.body;
    if (!expressions || !Array.isArray(expressions)) {
      res.status(400).json({ error: "Le parametre 'expressions' (tableau) est requis." });
      return;
    }

    const results = expressions.map((expr: string) => {
      const analysis = analyzeMath(expr);
      return {
        expression: expr,
        ...analysis,
      };
    });

    res.json({ results });
  } catch (error: any) {
    logger.error({ err: error }, "Math evaluate error:");
    res.status(500).json({ error: "Erreur d'evaluation mathematique." });
  }
});

router.get("/math/capabilities", (_req, res) => {
  res.json({
    types: [
      { id: "arithmetic", name: "Arithmetique", description: "Addition, soustraction, multiplication, division", examples: ["5 + 3", "12 * 4", "100 / 7"] },
      { id: "percentage", name: "Pourcentage", description: "Calculs de pourcentage", examples: ["20% de 500", "15%", "TVA 20%"] },
      { id: "power", name: "Puissance", description: "Exponentiation", examples: ["2^10", "5^3"] },
      { id: "root", name: "Racine", description: "Racine carree", examples: ["sqrt(144)", "racine(25)", "√16"] },
      { id: "logarithm", name: "Logarithme", description: "Log base 10, logarithme naturel", examples: ["log(100)", "ln(2.718)"] },
      { id: "trigonometry", name: "Trigonometrie", description: "Sin, cos, tan (en degres)", examples: ["sin(30)", "cos(45)", "tan(60)"] },
      { id: "statistics", name: "Statistiques", description: "Moyenne, somme", examples: ["moyenne de 10 20 30", "somme de 5 10 15 20"] },
      { id: "financial", name: "Financier", description: "TVA, marge, HT/TTC", examples: ["1000€ HT", "1200€ TTC", "marge: 200 sur 1000"] },
      { id: "conversion", name: "Conversion", description: "Unites de mesure", examples: ["5 km", "10 kg", "3.5 mi"] },
      { id: "geometry", name: "Geometrie", description: "Aire, perimetre", examples: ["aire cercle rayon 5", "aire rectangle 10x20"] },
      { id: "ratio", name: "Ratio", description: "Proportions", examples: ["3:4", "16:9"] },
      { id: "comparison", name: "Comparaison", description: "Comparaisons numeriques", examples: ["5 > 3", "10 <= 20"] },
    ],
    features: [
      "Detection automatique des expressions mathematiques dans le texte",
      "Decomposition en sous-composants",
      "Resolution etape par etape",
      "Analyse enrichie par IA (Gemini)",
      "Support multi-types dans une meme requete",
      "Calculs financiers francais (TVA, HT/TTC)",
      "Conversions d'unites",
      "Trigonometrie en degres",
    ],
  });
});

export default router;
