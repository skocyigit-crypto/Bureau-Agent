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
import { GoogleGenAI, Modality, MediaResolution, type Session, type LiveServerMessage } from "@google/genai";
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

// Construit le client GoogleGenAI. La Live API necessite une cle API
// Gemini directe (obtenue sur https://aistudio.google.com/apikey).
// Le proxy AI Replit (modelfarm) ne supporte PAS l'endpoint WebSocket
// BidiGenerateContent — il renvoie 405 Method Not Allowed. On a teste
// ce fallback en prod, il echoue systematiquement, donc on l'a retire
// pour eviter de masquer la vraie cause derriere une erreur reseau.
function buildLiveClient(): { client: GoogleGenAI } | { error: string } {
  const directKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (directKey) {
    return { client: new GoogleGenAI({ apiKey: directKey }) };
  }

  return {
    error:
      "GEMINI_API_KEY manquant. L'assistant vocal Live a besoin d'une cle Gemini directe " +
      "(le proxy AI Replit ne supporte pas le streaming audio). " +
      "Obtenez une cle gratuite sur https://aistudio.google.com/apikey puis ajoutez-la dans les Secrets.",
  };
}

interface ClientFrame {
  type: "audio" | "text" | "end" | "voice" | "confirm_tool" | "video" | "screen";
  data?: string;
  // Pour video/screen: mimeType de l'image (defaut image/jpeg).
  mimeType?: string;
  text?: string;
  voice?: VoiceName;
  // Pour confirm_tool: id du tool-call et decision
  toolCallId?: string;
  decision?: "approve" | "reject";
}

interface GroundingSource {
  uri?: string;
  title?: string;
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
    | "tool_cancelled"
    | "voices"
    | "grounding"
    | "go_away"
    | "resumption_update"
    | "usage"
    | "code";
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
  // Pour grounding: sources web utilisees par Google Search.
  sources?: GroundingSource[];
  // Pour go_away: ms restantes avant deconnexion serveur.
  timeLeftMs?: number;
  // Pour resumption_update: handle a renvoyer en query param pour reprendre la session.
  handle?: string;
  resumable?: boolean;
  // Pour usage: jetons consommes (affichable cote UI a titre indicatif).
  totalTokens?: number;
  // Pour code: code execute par le modele (outil codeExecution) +
  // sortie/erreur. Affichable dans le panneau d'outils.
  language?: string;
  code?: string;
  output?: string;
  outcome?: string;
  // Pour tool_cancelled: IDs des tool-calls que le modele a abandonne
  // (apres interruption / changement d'avis). Cote UI on les retire de
  // la file pendingQueue + on marque les tools "running" comme annules.
  cancelledIds?: string[];
}

function sendFrame(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

async function openLiveSession(
  client: GoogleGenAI,
  voice: VoiceName,
  resumeHandle: string | undefined,
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
    // Resolution des images video envoyees par le client (webcam /
    // partage d'ecran). MEDIUM = bon compromis qualite / tokens.
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    // Transcription temps-reel des audios entrant/sortant pour
    // l'affichage type sous-titre. NOTE: on n'envoie PAS `languageCodes`
    // — la propriete existe dans les types SDK mais le backend Gemini
    // (AI Studio / MLdev, par opposition a Vertex) la rejette
    // explicitement ("languageCodes parameter is not supported"). La
    // detection de langue est automatique cote modele et fonctionne
    // tres bien pour FR + TR (les deux langues du proprietaire).
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // VAD automatique cote serveur (Gemini detecte debut/fin de parole).
    // - startOfSpeechSensitivity HIGH : on detecte la parole plus tot,
    //   essentiel pour ne PAS rater le debut d'une phrase courte
    //   ("oui", "non", "annule"). Reglage precedent (LOW) provoquait
    //   un effet "il ne m'entend pas".
    // - endOfSpeechSensitivity LOW + silenceDurationMs=900 : on tolere
    //   des pauses naturelles (l'utilisateur reflechit / dicte une
    //   adresse / un numero) sans couper la phrase en deux.
    // - prefixPaddingMs=200 : capture quelques ms avant le start pour
    //   ne pas tronquer la premiere syllabe.
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 200,
        silenceDurationMs: 900,
      },
    },
    // Dialogue "affectif": le modele detecte l'emotion de l'utilisateur
    // et adapte sa reponse (plus empathique si frustration, etc.).
    enableAffectiveDialog: true,
    // Audio proactif: DESACTIVE. Le proprietaire a explicitement
    // demande que l'assistant n'agisse JAMAIS sans qu'on lui parle
    // ("Sesli komutu otomatik uygulama"). Avec proactiveAudio=true,
    // le modele pouvait initier des tours spontanement sur du bruit
    // ambiant ou des fragments mal interpretes — percu comme "il fait
    // des choses tout seul". L'assistant ne parle desormais qu'en
    // reponse a une activation explicite detectee par le VAD.
    proactivity: { proactiveAudio: false },
    // Compression de la fenetre de contexte au-dela d'un certain seuil
    // pour les conversations longues — evite la troncature brutale.
    contextWindowCompression: {
      triggerTokens: "25000",
      slidingWindow: {},
    },
    // Reprise de session (handle persiste cote client en localStorage)
    // pour survivre aux deconnexions reseau breves sans perdre l'etat.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    // Outils disponibles. NOTE: Live API ne permet PAS de combiner
    // googleSearch + functionDeclarations dans le meme tool entry, mais
    // ils peuvent coexister comme entries separees.
    tools: [
      { functionDeclarations: getGeminiToolDeclarations().functionDeclarations },
      { googleSearch: {} },
      { codeExecution: {} },
    ],
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
// SECU: handles de reprise de session lies a (userId, orgId). Sans ce
// binding, un handle vole permettrait de reprendre une conversation
// tierce (le handle seul prouve seulement qu'on l'a vu, pas qu'on est
// son proprietaire). Map en memoire = OK pour single-process; en
// multi-instance il faudra Redis. Expiration 1h pour eviter croissance
// non-bornee.
const RESUME_TTL_MS = 60 * 60 * 1000;
const resumeBindings = new Map<string, { userId: number; orgId: number; expiresAt: number }>();
function bindResumeHandle(handle: string, userId: number, orgId: number): void {
  resumeBindings.set(handle, { userId, orgId, expiresAt: Date.now() + RESUME_TTL_MS });
  // GC opportuniste a chaque insertion: parcours leger O(n) mais n
  // borne par le nb de sessions actives recentes.
  if (resumeBindings.size > 50) {
    const now = Date.now();
    for (const [k, v] of resumeBindings) if (v.expiresAt < now) resumeBindings.delete(k);
  }
}

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
      // Permet de choisir la voix via ?voice=Aoede dans l'URL d'upgrade
      // et de reprendre une session via ?resume=<handle>.
      let voice: VoiceName = DEFAULT_VOICE;
      let resumeHandle: string | undefined;
      try {
        const u = new URL(url, "http://localhost");
        const v = u.searchParams.get("voice");
        if (v && (AVAILABLE_VOICES as readonly string[]).includes(v)) {
          voice = v as VoiceName;
        }
        const h = u.searchParams.get("resume");
        if (h && h.length > 0 && h.length < 512) {
          // SECU: un handle de reprise ne peut etre utilise QUE par le
          // (userId, orgId) qui l'a recu. Sans ce binding, n'importe
          // quel utilisateur authentifie qui devine/intercepte un
          // handle pourrait reprendre une conversation tierce.
          const bound = resumeBindings.get(h);
          if (bound && bound.userId === session.userId && bound.orgId === session.organisationId && bound.expiresAt > Date.now()) {
            resumeHandle = h;
          } else {
            logger.warn({ userId: session.userId }, "[VoiceLive] resume handle rejected (no/expired/mismatched binding)");
            // On ouvre quand meme une session neuve (pas d'echec dur
            // pour ne pas casser l'UX si le handle a expire cote serveur).
          }
        }
      } catch { /* ignore */ }

      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeConnection(ws, session.userId!, session.organisationId!, voice, resumeHandle);
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
  resumeHandle?: string,
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
    // Garde-fou: si la session est en cours de fermeture, on ne doit
    // executer AUCUN effet de bord (envoi email, suppression, etc.)
    // l'utilisateur ne verra jamais le resultat et ne pourra pas
    // confirmer/annuler.
    if (!gSession || closed) return;
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
    resumeHandle,
    (msg: LiveServerMessage) => {
      // Garde global: si on est en train de fermer, on ignore tout
      // message Gemini residual (audio en vol, tool_call tardif).
      if (closed) return;
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
          // Outil codeExecution: code genere ET resultat d'execution
          // (deux parts separees, dans le meme ou un turn ulterieur).
          const partAny = part as unknown as {
            executableCode?: { language?: string; code?: string };
            codeExecutionResult?: { outcome?: string; output?: string };
          };
          if (partAny.executableCode?.code) {
            sendFrame(ws, {
              type: "code",
              language: partAny.executableCode.language,
              code: partAny.executableCode.code,
            });
          }
          if (partAny.codeExecutionResult) {
            sendFrame(ws, {
              type: "code",
              outcome: partAny.codeExecutionResult.outcome,
              output: partAny.codeExecutionResult.output,
            });
          }
        }
      }
      // Annulation de tool-call (modele change d'avis apres interruption).
      const tcc = msg.toolCallCancellation as unknown as { ids?: string[] } | undefined;
      if (tcc?.ids?.length) {
        // Cote serveur: retire ces ids de pendingToolCalls pour eviter
        // de bloquer le cleanup avec des reponses obsoletes.
        for (const id of tcc.ids) pendingToolCalls.delete(id);
        sendFrame(ws, { type: "tool_cancelled", cancelledIds: tcc.ids });
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
      // Grounding (Google Search): sources web utilisees par le modele.
      const gm = sc?.groundingMetadata as unknown as {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
      } | undefined;
      if (gm?.groundingChunks?.length) {
        const sources: GroundingSource[] = [];
        for (const chunk of gm.groundingChunks) {
          if (chunk.web?.uri) sources.push({ uri: chunk.web.uri, title: chunk.web.title });
        }
        if (sources.length > 0) sendFrame(ws, { type: "grounding", sources });
      }
      // Avertissement de fermeture imminente du serveur (limite de duree
      // de session Gemini Live — environ 10 min audio natif / 15 min GA).
      const goAway = msg.goAway as unknown as { timeLeft?: string } | undefined;
      if (goAway) {
        // timeLeft est une Duration genre "30s" ou "1.5s". On le passe
        // brut au client qui peut prevenir l'utilisateur.
        let ms: number | undefined;
        const tl = goAway.timeLeft;
        if (typeof tl === "string") {
          const m = tl.match(/^([\d.]+)s$/);
          if (m) ms = Math.round(parseFloat(m[1]) * 1000);
        }
        sendFrame(ws, { type: "go_away", timeLeftMs: ms });
      }
      // Mise a jour du handle de reprise de session: a renvoyer en query
      // param ?resume=... au prochain ws.connect() pour ne pas perdre le
      // contexte (apres deconnexion reseau ou goAway).
      const sru = msg.sessionResumptionUpdate as unknown as {
        newHandle?: string;
        resumable?: boolean;
      } | undefined;
      if (sru?.newHandle) {
        // SECU: enregistre le binding handle -> (userId, orgId) AVANT
        // de l'envoyer au client. Au prochain ?resume=..., on validera.
        if (sru.resumable !== false) bindResumeHandle(sru.newHandle, userId, orgId);
        sendFrame(ws, {
          type: "resumption_update",
          handle: sru.newHandle,
          resumable: sru.resumable !== false,
        });
      }
      // Usage tokens (affichable cote UI a titre informatif).
      const um = msg.usageMetadata as unknown as { totalTokenCount?: number } | undefined;
      if (typeof um?.totalTokenCount === "number") {
        sendFrame(ws, { type: "usage", totalTokens: um.totalTokenCount });
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
      } else if ((frame.type === "video" || frame.type === "screen") && frame.data) {
        // Webcam ou partage d'ecran: une image JPEG par seconde environ.
        // Le client decoupe deja le data: prefix avant d'envoyer.
        if (!gSession) return;
        const mimeType = frame.mimeType ?? "image/jpeg";
        try {
          gSession.sendRealtimeInput({ video: { data: frame.data, mimeType } });
        } catch (err) {
          logger.warn({ err, kind: frame.type }, "[VoiceLive] sendRealtimeInput video failed");
        }
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
