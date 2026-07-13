import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

// Construction paresseuse (au premier usage reel, pas a l'IMPORT du module) —
// alignee sur `getOpenAI()` dans ../client.ts. Avant, ce module jetait de
// facon synchrone A L'IMPORT si AI_INTEGRATIONS_OPENAI_* (vars specifiques au
// proxy IA Replit) etaient absentes, ce qui faisait crasher tout le processus
// au demarrage — meme en dehors de Replit avec OPENAI_API_KEY correctement
// configure (cf. deploy/.env.example, docker-compose.yml), puisque cette
// variable directe n'etait jamais consideree ici.
let _openai: OpenAI | null = null;

function getOpenAiClient(): OpenAI {
  if (!_openai) {
    const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const proxyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const directKey = process.env.OPENAI_API_KEY;
    const usingProxy = Boolean(proxyBase && proxyKey);
    const apiKey = usingProxy ? proxyKey! : directKey || proxyKey;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key missing. Set OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY when using the Replit AI proxy).",
      );
    }
    _openai = new OpenAI({
      apiKey,
      ...(usingProxy ? { baseURL: proxyBase } : {}),
    });
  }
  return _openai;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getOpenAiClient() as any)[prop];
  },
});

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
