/**
 * Cloudflare Email Worker — capte les e-mails entrants sur support@ / contact@
 * agentdebureau.fr et les transmet a l'API Ajant Bureau pour triage IA
 * (classification + brouillon de reponse depose en file d'approbation).
 *
 * Aucune dependance npm (pas de build/bundler requis) — ce fichier peut etre
 * colle tel quel dans l'editeur "Quick edit" du tableau de bord Cloudflare.
 *
 * Configuration (Worker → Settings → Variables and Secrets):
 *   API_URL                      texte simple — ex: https://agent-de-bureau-api-qwnwibwdnq-od.a.run.app/api/support-inbox/incoming
 *   SUPPORT_INBOX_WEBHOOK_SECRET secret chiffre — doit correspondre exactement
 *                                a la valeur SUPPORT_INBOX_WEBHOOK_SECRET cote Cloud Run
 *   BACKUP_FORWARD_TO            texte simple, optionnel — adresse VERIFIEE
 *                                (Email Routing → Destination addresses) qui
 *                                recoit une copie de secours de chaque e-mail,
 *                                pour ne jamais perdre un message si l'API est
 *                                indisponible. Laisser vide pour desactiver.
 *
 * Voir deploy/cloudflare-email-worker/README.md pour les etapes d'installation.
 */
export default {
  async email(message, env, ctx) {
    // Copie de secours vers une vraie boite mail humaine — TOUJOURS tentee
    // en premier, independamment du succes de l'appel API. Garantit qu'aucun
    // e-mail n'est jamais perdu si le pipeline IA est en panne.
    if (env.BACKUP_FORWARD_TO) {
      ctx.waitUntil(
        message.forward(env.BACKUP_FORWARD_TO).catch(() => {
          /* fail-soft: l'adresse n'est peut-etre pas encore verifiee */
        }),
      );
    }

    try {
      const parsed = await parseEmail(message);
      await notifyApi(env, parsed);
    } catch (err) {
      // On ne rejette JAMAIS le message pour une erreur de notre pipeline —
      // la copie de secours ci-dessus est le vrai filet de securite.
      console.error("support-inbox worker error:", err);
    }
  },
};

async function notifyApi(env, parsed) {
  if (!env.API_URL || !env.SUPPORT_INBOX_WEBHOOK_SECRET) {
    console.error("API_URL ou SUPPORT_INBOX_WEBHOOK_SECRET non configures.");
    return;
  }
  const res = await fetch(env.API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-support-inbox-secret": env.SUPPORT_INBOX_WEBHOOK_SECRET,
    },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    console.error("support-inbox API a repondu", res.status, await res.text().catch(() => ""));
  }
}

async function parseEmail(message) {
  const from = message.from;
  const to = message.to;
  const subject = message.headers.get("subject") || "(sans sujet)";
  const messageId = message.headers.get("message-id") || `${from}-${Date.now()}`;
  const fromHeader = message.headers.get("from") || "";
  const fromName = extractDisplayName(fromHeader);

  const raw = await streamToText(message.raw, message.rawSize);
  const text = extractPlainText(raw);

  return { from, fromName, to, subject, text, messageId };
}

function extractDisplayName(fromHeader) {
  // "Jean Dupont <jean@exemple.fr>" -> "Jean Dupont"
  const m = fromHeader.match(/^\s*"?([^"<]*)"?\s*<[^>]+>\s*$/);
  const name = m ? m[1].trim() : "";
  return name || null;
}

async function streamToText(stream, size) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/**
 * Extraction "best-effort" du texte lisible d'un e-mail brut (RFC 822/2045),
 * sans dependance externe. Gere le texte simple, le multipart/* (cherche la
 * premiere partie text/plain, sinon text/html convertie en texte), et les
 * encodages quoted-printable / base64 les plus courants. Objectif: assez bon
 * pour qu'un modele de langage comprenne la demande, pas un parseur MIME complet.
 */
function extractPlainText(raw) {
  const splitIdx = raw.search(/\r?\n\r?\n/);
  if (splitIdx === -1) return raw.slice(0, 20000);

  const headerText = raw.slice(0, splitIdx);
  const body = raw.slice(splitIdx).replace(/^\r?\n\r?\n/, "");
  const headers = parseHeaderBlock(headerText);
  const contentType = (headers["content-type"] || "text/plain").toLowerCase();

  if (contentType.includes("multipart/")) {
    const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
    if (!boundaryMatch) return decodeBody(body, headers).slice(0, 20000);
    const boundary = boundaryMatch[1];
    const parts = body.split(`--${boundary}`).slice(1, -1);

    let plainPart = null;
    let htmlPart = null;
    for (const part of parts) {
      const pSplit = part.search(/\r?\n\r?\n/);
      if (pSplit === -1) continue;
      const pHeaders = parseHeaderBlock(part.slice(0, pSplit));
      const pBody = part.slice(pSplit).replace(/^\r?\n\r?\n/, "");
      const pType = (pHeaders["content-type"] || "").toLowerCase();
      if (pType.includes("text/plain") && !plainPart) plainPart = decodeBody(pBody, pHeaders);
      else if (pType.includes("text/html") && !htmlPart) htmlPart = decodeBody(pBody, pHeaders);
    }
    if (plainPart) return plainPart.trim().slice(0, 20000);
    if (htmlPart) return htmlToText(htmlPart).slice(0, 20000);
    return "(corps multipart non reconnu)";
  }

  if (contentType.includes("text/html")) {
    return htmlToText(decodeBody(body, headers)).slice(0, 20000);
  }
  return decodeBody(body, headers).trim().slice(0, 20000);
}

function parseHeaderBlock(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      out[currentKey] += " " + line.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      currentKey = m[1].trim().toLowerCase();
      out[currentKey] = m[2];
    }
  }
  return out;
}

function decodeBody(body, headers) {
  const encoding = (headers["content-transfer-encoding"] || "").toLowerCase().trim();
  if (encoding === "base64") {
    try {
      const binary = atob(body.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return body;
    }
  }
  if (encoding === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
