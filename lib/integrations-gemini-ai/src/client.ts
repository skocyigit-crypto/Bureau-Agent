import { GoogleGenAI } from "@google/genai";

const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const directKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!proxyKey && !directKey) {
  throw new Error(
    "Gemini API key missing. Set GEMINI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY when using the Replit AI proxy).",
  );
}

const usingProxy = Boolean(proxyBase && proxyKey);

export const ai = new GoogleGenAI(
  usingProxy
    ? {
        apiKey: proxyKey!,
        httpOptions: {
          apiVersion: "",
          baseUrl: proxyBase!,
        },
      }
    : {
        apiKey: (directKey || proxyKey)!,
      },
);
