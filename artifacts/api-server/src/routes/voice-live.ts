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
import {
  executeTool,
  getGeminiToolDeclarations,
  getTool,
  type ToolContext,
} from "../services/assistant-tools";

// Modeles Gemini Live disponibles. On utilise le modele audio dialog
// natif (preview) pour avoir une vraie voix conversationnelle. Si le
// modele preview est indisponible, fallback sur le modele GA.
const LIVE_MODEL = "gemini-2.5-flash-preview-native-audio-dialog";
const LIVE_MODEL_FALLBACK = "gemini-2.0-flash-live-001";

// Voix disponibles cote Gemini Live (modeles preview audio natif).
// Aoede = voix feminine chaleureuse (par defaut). Charon = masculine
// posee. Fenrir = masculine energique. Kore = feminine neutre. Puck =
// feminine jeune. Zephyr = feminine douce.
const AVAILABLE_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Puck", "Zephyr"] as const;
type VoiceName = typeof AVAILABLE_VOICES[number];
const DEFAULT_VOICE: VoiceName = "Aoede";

// Prompt systeme: l'assistant repond TOUJOURS dans la langue de
// l'utilisateur (auto-detect par le modele) et reste concis. Decrit
// aussi les outils disponibles pour que le modele sache QUAND les
// utiliser sans paraitre robotique.
const SYSTEM_PROMPT = `Tu es Bureau, l'assistant vocal de l'application Agent de Bureau (SaaS de gestion d'agence pour KOBI / PME).
Reponds TOUJOURS dans la langue de l'utilisateur (francais, turc ou anglais — detecte automatiquement).
Reste concis (1-3 phrases) car ta reponse est lue a voix haute. Sois chaleureux, professionnel, direct, et naturel — comme un secretaire humain experimente.

Tu disposes d'outils (function calling) pour agir reellement dans l'application : creer/lister taches, contacts, evenements, envoyer emails/SMS, rechercher dans l'historique, etc. Quand l'utilisateur formule une demande qui correspond a un outil, appelle-le sans demander de permission inutile — mais confirme oralement APRES execution ce que tu viens de faire ("J'ai cree la tache X pour demain").

Si une action est risquee (envoi d'email, SMS, suppression) tu recevras automatiquement une demande de confirmation : explique-la en une phrase a l'utilisateur. Pour les autres actions, agis directement.

Ne dis jamais "je ne peux pas faire ca dans le chat vocal" — utilise les outils a ta disposition.`;

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
  type: "audio" | "text" | "end" | "voice" | "confirm_tool";
  data?: string;
  text?: string;
  voice?: VoiceName;
  // Pour confirm_tool: id du tool-call et decision
  toolCallId?: string;
  decision?: "approve" | "reject";
}

interface ServerFrame {
  type:
    | "audio"
    | "text"
    | "turn_complete"
    | "interrupted"
    | "ready"
    | "error"
    | "user_transcript"
    | "assistant_transcript"
    | "tool_step"
    | "tool_pending"
    | "voices";
  data?: string;
  text?: string;
  message?: string;
  lang?: string;
  // Pour tool_step / tool_pending
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  toolCallId?: string;
  summary?: string;
  // Pour voices: liste des voix disponibles a afficher dans le picker
  voices?: readonly string[];
}

function sendFrame(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

async function openLiveSession(
  client: GoogleGenAI,
  voice: VoiceName,
  onMessage: (msg: LiveServerMessage) => void,
  onError: (err: unknown) => void,
  onClose: () => void,
): Promise<Session> {
  // Essai modele audio natif d'abord, fallback sur le modele GA. Le
  // modele natif supporte une voix plus chaude et les emotions, le
  // fallback est plus stable mais "robotique".
  const configs: { model: string }[] = [
    { model: LIVE_MODEL },
    { model: LIVE_MODEL_FALLBACK },
  ];

  // Construction de la config riche : voix selectionnee, transcriptions
  // input/output (closed-captions), function calling, instruction systeme.
  // On caste via `unknown` car certaines proprietes (transcriptions,
  // realtimeInputConfig) ne sont pas encore dans les types publics du SDK.
  const baseConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: SYSTEM_PROMPT,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: voice },
      },
    },
    // Recoit la transcription temps-reel de la voix utilisateur — utile
    // pour afficher dans la UI ce que l'AI "comprend".
    inputAudioTranscription: {},
    // Recoit la transcription temps-reel de la reponse vocale — affichage
    // type sous-titre pendant que l'assistant parle.
    outputAudioTranscription: {},
    // Function calling : on injecte tous les outils existants du systeme
    // assistant (taches, contacts, calendrier, emails/SMS, etc.).
    tools: [getGeminiToolDeclarations()],
  } as unknown as Parameters<typeof client.live.connect>[0]["config"];

  let lastErr: unknown = null;
  for (const cfg of configs) {
    try {
      const session = await client.live.connect({
        model: cfg.model,
        config: baseConfig,
        callbacks: {
          onopen: () => logger.info({ model: cfg.model, voice }, "[VoiceLive] Gemini session opened"),
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
      // Permet de choisir la voix via ?voice=Aoede dans l'URL d'upgrade.
      let voice: VoiceName = DEFAULT_VOICE;
      try {
        const u = new URL(url, "http://localhost");
        const v = u.searchParams.get("voice");
        if (v && (AVAILABLE_VOICES as readonly string[]).includes(v)) {
          voice = v as VoiceName;
        }
      } catch { /* ignore */ }

      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeConnection(ws, session.userId!, session.organisationId!, voice);
      });
    });
  });

  logger.info("[VoiceLive] WebSocket server attached at /api/voice/live");
}

function bridgeConnection(
  ws: WebSocket,
  userId: number,
  orgId: number,
  voice: VoiceName,
): void {
  const liveClient = buildLiveClient();
  if ("error" in liveClient) {
    sendFrame(ws, { type: "error", message: liveClient.error });
    ws.close();
    return;
  }

  let gSession: Session | null = null;
  let closed = false;
  const toolCtx: ToolContext = { orgId, userId };
  // Tool-calls en attente de confirmation utilisateur (pour les outils
  // requiresConfirmation comme envoi d'email/SMS, suppression, etc.).
  const pendingToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    // Avant de fermer la session Gemini, rejette tous les tool-calls
    // en attente: sans reponse, Gemini reste bloque cote serveur et ne
    // pourra pas etre reutilise proprement. Garantie cote serveur en
    // complement du best-effort cote client.
    if (gSession && pendingToolCalls.size > 0) {
      for (const [callId, p] of pendingToolCalls) {
        try {
          gSession.sendToolResponse({
            functionResponses: [{
              id: callId,
              name: p.name,
              response: { error: "Session fermee avant confirmation" },
            }],
          });
        } catch { /* ignore */ }
      }
      pendingToolCalls.clear();
    }
    try { gSession?.close(); } catch { /* ignore */ }
    try { ws.close(); } catch { /* ignore */ }
  };

  // Buffer pour les frames audio recus AVANT que la session Gemini soit
  // prete. Evite de perdre les premiers mots de l'utilisateur.
  const pendingAudio: string[] = [];

  // Helper: execute un tool-call et renvoie le resultat a Gemini.
  // Gemini Live appelle sendToolResponse() avec functionResponses[].
  const handleToolCall = async (
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    if (!gSession) return;
    sendFrame(ws, { type: "tool_step", toolName: name, toolArgs: args, toolCallId: callId });
    const tool = getTool(name);
    // Confirmation utilisateur pour les outils risques (envoi externe,
    // suppression). On stocke la call, on previent l'UI, et on attend
    // un message `confirm_tool` du client avant d'executer.
    if (tool?.requiresConfirmation) {
      pendingToolCalls.set(callId, { name, args });
      const summary = tool.summarize?.(args as never) ?? `Confirmer ${name}`;
      sendFrame(ws, { type: "tool_pending", toolCallId: callId, toolName: name, toolArgs: args, summary });
      return;
    }
    const result = await executeTool(name, args, toolCtx, { skipConfirmation: false });
    const payload: Record<string, unknown> = result.ok
      ? (result.result as Record<string, unknown>) ?? { ok: true }
      : { error: result.error ?? "Erreur" };
    sendFrame(ws, { type: "tool_step", toolName: name, toolArgs: args, toolResult: payload, toolCallId: callId });
    try {
      // Le SDK attend un tableau de functionResponses.
      gSession.sendToolResponse({
        functionResponses: [{ id: callId, name, response: payload }],
      });
    } catch (err) {
      logger.error({ err, tool: name }, "[VoiceLive] sendToolResponse failed");
    }
  };

  // Ouvre la session Gemini Live et configure les callbacks.
  openLiveSession(
    liveClient.client,
    voice,
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
      // Transcriptions temps-reel (closed captions).
      // Les types publics du SDK n'exposent pas toujours ces champs,
      // donc on les lit via cast.
      const scAny = sc as unknown as {
        inputTranscription?: { text?: string };
        outputTranscription?: { text?: string };
      } | undefined;
      if (scAny?.inputTranscription?.text) {
        sendFrame(ws, { type: "user_transcript", text: scAny.inputTranscription.text });
      }
      if (scAny?.outputTranscription?.text) {
        sendFrame(ws, { type: "assistant_transcript", text: scAny.outputTranscription.text });
      }
      // Tool calls
      const tc = msg.toolCall;
      if (tc?.functionCalls?.length) {
        for (const call of tc.functionCalls) {
          const callId = call.id ?? `${call.name}-${Date.now()}`;
          const name = call.name ?? "";
          const args = (call.args ?? {}) as Record<string, unknown>;
          // fire-and-forget — Gemini Live attend la reponse async
          handleToolCall(callId, name, args).catch((err) => {
            logger.error({ err, tool: name }, "[VoiceLive] tool execution error");
          });
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
      sendFrame(ws, { type: "voices", voices: AVAILABLE_VOICES });
      logger.info({ userId, orgId, voice }, "[VoiceLive] Bridge active");
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
      } else if (frame.type === "confirm_tool" && frame.toolCallId && frame.decision) {
        // Resoud un tool-call en attente apres approbation/refus utilisateur.
        const pending = pendingToolCalls.get(frame.toolCallId);
        if (!pending) return;
        pendingToolCalls.delete(frame.toolCallId);
        if (frame.decision === "reject") {
          const payload = { error: "Action annulee par l'utilisateur" };
          sendFrame(ws, { type: "tool_step", toolName: pending.name, toolArgs: pending.args, toolResult: payload, toolCallId: frame.toolCallId });
          try {
            gSession?.sendToolResponse({
              functionResponses: [{ id: frame.toolCallId, name: pending.name, response: payload }],
            });
          } catch (err) { logger.error({ err }, "[VoiceLive] sendToolResponse(reject) failed"); }
          return;
        }
        // Approve: on execute reellement, en bypassant le gate confirmation.
        executeTool(pending.name, pending.args, toolCtx, { skipConfirmation: true })
          .then((result) => {
            const payload: Record<string, unknown> = result.ok
              ? (result.result as Record<string, unknown>) ?? { ok: true }
              : { error: result.error ?? "Erreur" };
            sendFrame(ws, { type: "tool_step", toolName: pending.name, toolArgs: pending.args, toolResult: payload, toolCallId: frame.toolCallId });
            try {
              gSession?.sendToolResponse({
                functionResponses: [{ id: frame.toolCallId!, name: pending.name, response: payload }],
              });
            } catch (err) { logger.error({ err }, "[VoiceLive] sendToolResponse(approve) failed"); }
          })
          .catch((err) => logger.error({ err }, "[VoiceLive] approve execute failed"));
      } else if (frame.type === "voice") {
        // Changement de voix en cours de session: pas supporte par le
        // protocole Live (la voix est fixee a l'ouverture). On l'ignore
        // — le client doit reconnecter avec ?voice=NewName pour changer.
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
