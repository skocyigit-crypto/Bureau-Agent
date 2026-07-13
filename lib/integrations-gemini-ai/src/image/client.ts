import { GoogleGenAI, Modality } from "@google/genai";

// Construction paresseuse (au premier usage reel, pas a l'IMPORT du module) —
// alignee sur `getGeminiAi()` dans ../client.ts. Avant, ce module jetait de
// facon synchrone A L'IMPORT si AI_INTEGRATIONS_GEMINI_* (vars specifiques au
// proxy IA Replit) etaient absentes, ce qui faisait crasher tout le processus
// au demarrage — meme en dehors de Replit avec GEMINI_API_KEY correctement
// configure (cf. deploy/.env.example, docker-compose.yml), puisque cette
// variable directe n'etait jamais consideree ici.
let _ai: GoogleGenAI | null = null;

function getGeminiImageClient(): GoogleGenAI {
  if (!_ai) {
    const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const directKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const usingProxy = Boolean(proxyBase && proxyKey);
    if (!proxyKey && !directKey) {
      throw new Error(
        "Gemini API key missing. Set GEMINI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY when using the Replit AI proxy).",
      );
    }
    _ai = new GoogleGenAI(
      usingProxy
        ? {
            apiKey: proxyKey!,
            httpOptions: { apiVersion: "", baseUrl: proxyBase! },
          }
        : {
            apiKey: (directKey || proxyKey)!,
          },
    );
  }
  return _ai;
}

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getGeminiImageClient() as any)[prop];
  },
});

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
