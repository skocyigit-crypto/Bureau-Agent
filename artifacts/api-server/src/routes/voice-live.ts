// Voice Live: Gemini Live API WebSocket bridge.
//
// Architecture:
//   Browser <--ws--> /api/voice/live <--ws--> Gemini Live API
//
// Le navigateur capture le micro en PCM 16kHz/16-bit mono, l'envoie en
// base64 via JSON frames sur la WS. Le serveur ouvre une session Gemini
// Live (modele audio natif) et fait passer les chunks. Les chunks audio
// de reponse (PCM 24kHz/16-bit mono) sont relayes vers le browser qui
// les joue via AudioContext.
//
// Protocole WS (cote client):
//   client -> server: { type: "audio", data: <base64 pcm16k> }
//                    { type: "text",  text: <string> }   // tapper a la place de parler
//                    { type: "end"   }                    // terminer cette session
//
//   server -> client: { type: "audio", data: <base64 pcm24k> }
//                    { type: "text",  text: <string> }   // transcription / texte modele
//                    { type: "turn_complete" }            // le modele a fini sa reponse
//                    { type: "interrupted" }              // l'utilisateur a coupe la parole
//                    { type: "ready", lang: <string> }    // session prete
//                    { type: "error", message: <string> }
//
// Auth: on reutilise express-session via sessionMiddleware sur la requete
// d'upgrade — meme cookie HttpOnly que les requetes HTTP. Sans session
// valide, l'upgrade est refuse (1008).

import type { Server } from "http";
import type { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, type Session, type LiveServerMessage } from "@google/genai";
import { logger } from "../lib/logger";
import { sessionMiddleware } from "../app";

// Modeles Gemini Live disponibles. On utilise le modele audio dialog
// natif (preview) pour avoir une vraie voix conversationnelle. Si le
// modele preview est indisponible, fallback sur le modele GA.
const LIVE_MODEL = "gemini-2.5-flash-preview-native-audio-dialog";
const LIVE_MODEL_FALLBACK = "gemini-2.0-flash-live-001";

// Prompt systeme: l'assistant repond TOUJOURS dans la langue de
// l'utilisateur (auto-detect par le modele) et reste concis.
const SYSTEM_PROMPT = `Tu es Bureau, l'assistant vocal de l'application Agent de Bureau (SaaS de gestion d'agence).
Reponds TOUJOURS dans la langue de l'utilisateur (francais, turc ou anglais — detecte automatiquement).
Reste concis (1-3 phrases) car ta reponse est lue a voix haute. Sois chaleureux, professionnel, et direct.
Si on te demande une action concrete (creer une tache, appeler quelqu'un, etc.), explique a l'utilisateur que tu peux le guider mais que l'execution se fait dans l'interface dediee.`;

// Construit le client GoogleGenAI. La Live API necessite une cle directe
// (le proxy AI Replit ne supporte pas le streaming WebSocket bi-directionnel).
function buildLiveClient(): { client: GoogleGenAI; usingProxy: boolean } | { error: string } {
  const directKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (directKey) {
    return { client: new GoogleGenAI({ apiKey: directKey }), usingProxy: false };
  }

  // Tentative via le proxy Replit. Probable echec — le proxy n'expose
  // generalement pas l'endpoint Live WebSocket. On essaie quand-meme
  // pour ne pas bloquer l'experience si jamais c'est supporte.
  const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (proxyKey && proxyBase) {
    return {
      client: new GoogleGenAI({
        apiKey: proxyKey,
        httpOptions: { apiVersion: "", baseUrl: proxyBase },
      }),
      usingProxy: true,
    };
  }

  return { error: "GEMINI_API_KEY manquant. Ajoutez une cle API Gemini directe pour utiliser le mode Live." };
}

interface ClientFrame {
  type: "audio" | "text" | "end";
  data?: string;
  text?: string;
}

interface ServerFrame {
  type: "audio" | "text" | "turn_complete" | "interrupted" | "ready" | "error";
  data?: string;
  text?: string;
  message?: string;
  lang?: string;
}

function sendFrame(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

async function openLiveSession(
  client: GoogleGenAI,
  onMessage: (msg: LiveServerMessage) => void,
  onError: (err: unknown) => void,
  onClose: () => void,
): Promise<Session> {
  // Essai modele audio natif d'abord, fallback sur le modele GA.
  const configs: { model: string }[] = [
    { model: LIVE_MODEL },
    { model: LIVE_MODEL_FALLBACK },
  ];

  let lastErr: unknown = null;
  for (const cfg of configs) {
    try {
      const session = await client.live.connect({
        model: cfg.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_PROMPT,
        },
        callbacks: {
          onopen: () => logger.info({ model: cfg.model }, "[VoiceLive] Gemini session opened"),
          onmessage: onMessage,
          onerror: (e: unknown) => {
            logger.error({ err: e, model: cfg.model }, "[VoiceLive] Gemini session error");
            onError(e);
          },
          onclose: () => {
            logger.info({ model: cfg.model }, "[VoiceLive] Gemini session closed");
            onClose();
          },
        },
      });
      return session;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, model: cfg.model }, "[VoiceLive] Gemini connect failed, trying fallback");
    }
  }
  throw lastErr ?? new Error("Impossible d'ouvrir une session Gemini Live");
}

/**
 * Attache un WebSocketServer au serveur HTTP existant, ecoute les
 * upgrades sur /api/voice/live, et bridge chaque connexion vers une
 * session Gemini Live.
 *
 * Doit etre appele APRES la creation du http.Server (donc dans index.ts
 * apres `app.listen`).
 */
export function attachVoiceLiveWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Allowlist d'origines pour CSRF protection sur l'upgrade WS. La
  // verification du cookie de session n'est PAS suffisante seule
  // (cross-origin WS peut etre initie par un site malveillant).
  const allowedOrigins = new Set<string>();
  const replitDomains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  for (const d of replitDomains) {
    const trimmed = d.trim();
    if (trimmed) {
      allowedOrigins.add(`https://${trimmed}`);
      allowedOrigins.add(`http://${trimmed}`);
    }
  }
  // En dev, autoriser localhost via le proxy.
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost");
    allowedOrigins.add("http://localhost:80");
  }
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDevDomain) {
    allowedOrigins.add(`https://${replitDevDomain}`);
  }

  // L'upgrade HTTP arrive ici. On valide origin + session avant d'accepter
  // la connexion WS.
  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    // On n'intercepte QUE notre endpoint. Les autres upgrades (HMR Vite,
    // etc.) sont ignores ici — d'autres handlers peuvent les capter.
    if (!url.startsWith("/api/voice/live")) return;

    // 1. Verification Origin (anti-CSRF).
    const origin = req.headers.origin;
    if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
      logger.warn({ url, origin }, "[VoiceLive] Upgrade rejected — origin not allowed");
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // 2. Re-utilise le middleware express-session pour parser le cookie et
    // hydrater req.session a partir du PgStore. On simule un res minimal
    // — la middleware n'ecrit rien tant qu'on n'envoie pas de header.
    const fakeReq = req as unknown as Request;
    const fakeRes = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      end: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      setHeader: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      getHeader: () => undefined,
    } as unknown as Response;

    sessionMiddleware(fakeReq, fakeRes, (err?: unknown) => {
      if (err) {
        logger.error({ err, url }, "[VoiceLive] Session middleware error on upgrade");
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }
      const session = fakeReq.session as { userId?: number; organisationId?: number } | undefined;
      if (!session?.userId || !session?.organisationId) {
        logger.warn({ url }, "[VoiceLive] Upgrade rejected — no session");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeConnection(ws, session.userId!, session.organisationId!);
      });
    });
  });

  logger.info("[VoiceLive] WebSocket server attached at /api/voice/live");
}

function bridgeConnection(ws: WebSocket, userId: number, orgId: number): void {
  const liveClient = buildLiveClient();
  if ("error" in liveClient) {
    sendFrame(ws, { type: "error", message: liveClient.error });
    ws.close();
    return;
  }

  let gSession: Session | null = null;
  let closed = false;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    try { gSession?.close(); } catch { /* ignore */ }
    try { ws.close(); } catch { /* ignore */ }
  };

  // Buffer pour les frames audio recus AVANT que la session Gemini soit
  // prete. Evite de perdre les premiers mots de l'utilisateur.
  const pendingAudio: string[] = [];

  // Ouvre la session Gemini Live et configure les callbacks.
  openLiveSession(
    liveClient.client,
    (msg: LiveServerMessage) => {
      // Audio chunks: serverContent.modelTurn.parts[].inlineData.data (base64 PCM 24kHz)
      const sc = msg.serverContent;
      if (sc?.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
            sendFrame(ws, { type: "audio", data: part.inlineData.data });
          }
          if (part.text) {
            sendFrame(ws, { type: "text", text: part.text });
          }
        }
      }
      if (sc?.interrupted) {
        sendFrame(ws, { type: "interrupted" });
      }
      if (sc?.turnComplete) {
        sendFrame(ws, { type: "turn_complete" });
      }
    },
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendFrame(ws, { type: "error", message });
      cleanup();
    },
    () => cleanup(),
  )
    .then((session) => {
      // Race: si le client a deja ferme avant que la session ouvre,
      // on ferme immediatement la session Gemini pour eviter un leak.
      if (closed) {
        try { session.close(); } catch { /* ignore */ }
        return;
      }
      gSession = session;
      // Flush des frames audio recus pendant la connexion.
      for (const data of pendingAudio) {
        try {
          session.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
        } catch (err) {
          logger.warn({ err }, "[VoiceLive] Failed to flush pending audio");
        }
      }
      pendingAudio.length = 0;
      sendFrame(ws, { type: "ready", lang: "auto" });
      logger.info({ userId, orgId }, "[VoiceLive] Bridge active");
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, userId, orgId }, "[VoiceLive] Failed to open Gemini session");
      sendFrame(ws, { type: "error", message: `Gemini Live indisponible: ${message}` });
      cleanup();
    });

  // Limite du buffer pre-ready pour eviter qu'un client lent ne fasse
  // gonfler la memoire avant que la session ouvre (~10s d'audio max).
  const MAX_PENDING_CHUNKS = 250;

  // Messages du client vers Gemini.
  ws.on("message", (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      sendFrame(ws, { type: "error", message: "Invalid JSON frame" });
      return;
    }
    try {
      if (frame.type === "audio" && frame.data) {
        if (gSession) {
          gSession.sendRealtimeInput({
            audio: { data: frame.data, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (pendingAudio.length < MAX_PENDING_CHUNKS) {
          pendingAudio.push(frame.data);
        }
      } else if (frame.type === "text" && frame.text) {
        if (!gSession) return;
        gSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: frame.text }] }],
          turnComplete: true,
        });
      } else if (frame.type === "end") {
        cleanup();
      }
    } catch (err) {
      logger.error({ err }, "[VoiceLive] Error forwarding to Gemini");
      sendFrame(ws, { type: "error", message: "Erreur d'envoi vers Gemini" });
    }
  });

  ws.on("close", () => cleanup());
  ws.on("error", (err) => {
    logger.error({ err }, "[VoiceLive] WS error");
    cleanup();
  });
}
