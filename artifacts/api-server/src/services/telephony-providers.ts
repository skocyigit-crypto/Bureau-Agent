import { encryptSensitiveData, decryptSensitiveData, isEncrypted } from "../lib/crypto";

export interface TelephonyProviderConfig {
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
  applicationId?: string;
  fromNumber?: string;
  webhookUrl?: string;
  region?: string;
  [key: string]: string | undefined;
}

export interface MakeCallParams {
  to: string;
  from?: string;
  callbackUrl?: string;
  record?: boolean;
  statusCallback?: string;
}

export interface SendSmsParams {
  to: string;
  from?: string;
  body: string;
  statusCallback?: string;
}

export interface CallResult {
  success: boolean;
  callSid?: string;
  status?: string;
  error?: string;
}

export interface SmsResult {
  success: boolean;
  messageSid?: string;
  status?: string;
  error?: string;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  website: string;
  capabilities: string[];
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

const SUPPORTED_PROVIDERS: Record<string, ProviderInfo> = {
  twilio: {
    name: "twilio",
    displayName: "Twilio",
    website: "https://www.twilio.com",
    capabilities: ["voice", "sms", "mms", "whatsapp", "video", "recording", "ivr", "transcription"],
    configFields: [
      { key: "accountSid", label: "Account SID", required: true, secret: false },
      { key: "authToken", label: "Auth Token", required: true, secret: true },
      { key: "fromNumber", label: "Numero expediteur (+33...)", required: true, secret: false },
    ],
    pricing: { description: "Appels: ~0.013EUR/min, SMS: ~0.07EUR/msg, Numeros: ~1EUR/mois" },
  },
  vonage: {
    name: "vonage",
    displayName: "Vonage (Nexmo)",
    website: "https://www.vonage.com",
    capabilities: ["voice", "sms", "mms", "whatsapp", "video", "recording", "ivr", "verify"],
    configFields: [
      { key: "apiKey", label: "API Key", required: true, secret: false },
      { key: "apiSecret", label: "API Secret", required: true, secret: true },
      { key: "applicationId", label: "Application ID", required: false, secret: false },
      { key: "fromNumber", label: "Numero expediteur", required: true, secret: false },
      { key: "webhookSecret", label: "Secret webhook (optionnel, a definir cote Vonage)", required: false, secret: true },
    ],
    pricing: { description: "Appels: ~0.01EUR/min, SMS: ~0.06EUR/msg, Numeros: ~0.80EUR/mois" },
  },
  telnyx: {
    name: "telnyx",
    displayName: "Telnyx",
    website: "https://www.telnyx.com",
    capabilities: ["voice", "sms", "mms", "fax", "recording", "ivr", "transcription"],
    configFields: [
      { key: "apiKey", label: "API Key (v2)", required: true, secret: true },
      { key: "fromNumber", label: "Numero expediteur", required: true, secret: false },
      { key: "applicationId", label: "Connection ID", required: false, secret: false },
      { key: "webhookSecret", label: "Secret webhook (optionnel, a definir cote Telnyx)", required: false, secret: true },
    ],
    pricing: { description: "Appels: ~0.008EUR/min, SMS: ~0.04EUR/msg, Numeros: ~1EUR/mois" },
  },
  plivo: {
    name: "plivo",
    displayName: "Plivo",
    website: "https://www.plivo.com",
    capabilities: ["voice", "sms", "mms", "recording", "ivr"],
    configFields: [
      { key: "authId", label: "Auth ID", required: true, secret: false },
      { key: "authToken", label: "Auth Token", required: true, secret: true },
      { key: "fromNumber", label: "Numero expediteur", required: true, secret: false },
      { key: "webhookSecret", label: "Secret webhook (optionnel, a definir cote Plivo)", required: false, secret: true },
    ],
    pricing: { description: "Appels: ~0.01EUR/min, SMS: ~0.05EUR/msg, Numeros: ~0.80EUR/mois" },
  },
  sinch: {
    name: "sinch",
    displayName: "Sinch",
    website: "https://www.sinch.com",
    capabilities: ["voice", "sms", "mms", "whatsapp", "rcs", "verify"],
    configFields: [
      { key: "apiKey", label: "API Key", required: true, secret: false },
      { key: "apiSecret", label: "API Secret", required: true, secret: true },
      { key: "applicationId", label: "App ID", required: true, secret: false },
      { key: "fromNumber", label: "Numero expediteur", required: true, secret: false },
      { key: "webhookSecret", label: "Secret webhook (optionnel, a definir cote Sinch)", required: false, secret: true },
    ],
    pricing: { description: "Appels: ~0.01EUR/min, SMS: ~0.05EUR/msg" },
  },
  bandwidth: {
    name: "bandwidth",
    displayName: "Bandwidth",
    website: "https://www.bandwidth.com",
    capabilities: ["voice", "sms", "mms", "recording", "transcription", "emergency"],
    configFields: [
      { key: "accountId", label: "Account ID", required: true, secret: false },
      { key: "apiToken", label: "API Token", required: true, secret: true },
      { key: "apiSecret", label: "API Secret", required: true, secret: true },
      { key: "applicationId", label: "Application ID", required: true, secret: false },
      { key: "fromNumber", label: "Numero expediteur", required: true, secret: false },
      { key: "webhookSecret", label: "Secret webhook (optionnel, a definir cote Bandwidth)", required: false, secret: true },
    ],
    pricing: { description: "Appels: ~0.01EUR/min, SMS: ~0.004EUR/msg" },
  },
};

export function getSupportedProviders(): ProviderInfo[] {
  return Object.values(SUPPORTED_PROVIDERS);
}

export function getProviderInfo(name: string): ProviderInfo | null {
  return SUPPORTED_PROVIDERS[name] || null;
}

// ---------------------------------------------------------------------------
// Chiffrement au repos des champs secrets (authToken, apiSecret, apiToken...).
// AVANT: telephony_providers.config etait stocke en clair — contrairement a
// api_keys/webhook_endpoints/google_oauth_tokens qui utilisent tous
// enc:v1: (lib/crypto.ts). Desormais un client BYOK (Twilio, Vonage...) qui
// entre son propre secret voit CE secret chiffre au repos. Seuls les champs
// marques `secret: true` dans configFields sont chiffres — accountSid,
// fromNumber etc. restent en clair (pas des secrets, utiles a lire/filtrer
// sans dechiffrement).
// ---------------------------------------------------------------------------

export function encryptProviderConfig(provider: string, config: Record<string, any>): Record<string, any> {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return config;
  const out = { ...config };
  for (const field of info.configFields) {
    if (!field.secret) continue;
    const val = out[field.key];
    if (typeof val === "string" && val && !isEncrypted(val)) {
      out[field.key] = encryptSensitiveData(val);
    }
  }
  return out;
}

/**
 * Dechiffre les champs secrets pour un usage reel (appel API sortant vers
 * Twilio/Vonage/etc., validation de signature de webhook). Tolerant aux
 * valeurs encore en clair (migration progressive, cf. decryptSensitiveData) —
 * ne casse jamais les configs deja enregistrees avant ce changement.
 */
export function decryptProviderConfig<T extends Record<string, any>>(provider: string, config: T): T {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info || !config) return config;
  const out = { ...config } as Record<string, any>;
  for (const field of info.configFields) {
    if (!field.secret) continue;
    const val = out[field.key];
    if (typeof val === "string" && val) {
      try {
        out[field.key] = decryptSensitiveData(val);
      } catch {
        // Cle de chiffrement changee ou donnees corrompues — laisser tel
        // quel plutot que de faire planter l'appelant ; l'appel Twilio/etc.
        // echouera proprement plus loin avec une erreur d'auth explicite.
      }
    }
  }
  return out as T;
}

export function validateProviderConfig(provider: string, config: Record<string, any>): { valid: boolean; errors: string[] } {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return { valid: false, errors: [`Fournisseur inconnu: ${provider}`] };

  const errors: string[] = [];
  for (const field of info.configFields) {
    if (field.required && !config[field.key]) {
      errors.push(`${field.label} est requis`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function maskConfig(config: Record<string, any>, provider: string): Record<string, any> {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return {};
  // Dechiffrer avant de masquer : sinon le "***xxxx" affiche les 4 derniers
  // caracteres du blob chiffre (base64 illisible) au lieu du vrai secret.
  const decrypted = decryptProviderConfig(provider, config);
  const masked: Record<string, any> = {};
  for (const field of info.configFields) {
    const val = decrypted[field.key];
    if (val) {
      masked[field.key] = field.secret ? `***${String(val).slice(-4)}` : val;
    }
  }
  return masked;
}

export { maskConfig };

async function callTwilio(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const accountSid = config.accountSid;
    const authToken = config.authToken;
    const from = params.from || config.fromNumber || "";
    const urlEncodedBody = new URLSearchParams({
      To: params.to,
      From: from,
      Url: params.callbackUrl || "http://demo.twilio.com/docs/voice.xml",
      ...(params.record ? { Record: "true" } : {}),
      ...(params.statusCallback ? { StatusCallback: params.statusCallback } : {}),
    });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: urlEncodedBody.toString(),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.message || `Twilio error ${resp.status}` };
    return { success: true, callSid: data.sid, status: data.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsTwilio(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const accountSid = config.accountSid;
    const authToken = config.authToken;
    const from = params.from || config.fromNumber || "";
    const urlEncodedBody = new URLSearchParams({
      To: params.to,
      From: from,
      Body: params.body,
      ...(params.statusCallback ? { StatusCallback: params.statusCallback } : {}),
    });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: urlEncodedBody.toString(),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.message || `Twilio SMS error ${resp.status}` };
    return { success: true, messageSid: data.sid, status: data.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function callVonage(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const body: any = {
      to: [{ type: "phone", number: params.to.replace(/\+/g, "") }],
      from: { type: "phone", number: from.replace(/\+/g, "") },
      answer_url: [params.callbackUrl || "https://raw.githubusercontent.com/nexmo-community/ncco-examples/main/talk.json"],
    };
    if (params.statusCallback) body.event_url = [params.statusCallback];
    const resp = await fetch("https://api.nexmo.com/v1/calls", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.title || data.detail || `Vonage error ${resp.status}` };
    return { success: true, callSid: data.uuid, status: data.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsVonage(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch("https://rest.nexmo.com/sms/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        api_secret: config.apiSecret,
        to: params.to.replace(/\+/g, ""),
        from: from.replace(/\+/g, ""),
        text: params.body,
      }),
    });
    const data = await resp.json() as any;
    const msg = data.messages?.[0];
    if (msg?.status !== "0") return { success: false, error: msg?.["error-text"] || "Vonage SMS error" };
    return { success: true, messageSid: msg["message-id"], status: "sent" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function callTelnyx(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const body: any = {
      to: params.to,
      from: from,
      connection_id: config.applicationId || undefined,
      ...(params.record ? { record: "record-from-answer" } : {}),
      ...(params.statusCallback ? { webhook_url: params.statusCallback } : {}),
    };
    const resp = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.errors?.[0]?.detail || `Telnyx error ${resp.status}` };
    return { success: true, callSid: data.data?.call_control_id, status: data.data?.state };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsTelnyx(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: params.to, from: from, text: params.body }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.errors?.[0]?.detail || `Telnyx SMS error ${resp.status}` };
    return { success: true, messageSid: data.data?.id, status: "sent" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function callPlivo(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://api.plivo.com/v1/Account/${config.authId}/Call/`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.authId}:${config.authToken}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: params.to.replace(/\+/g, ""),
        from: from.replace(/\+/g, ""),
        answer_url: params.callbackUrl || "https://s3.amazonaws.com/plivocloud/Phlo/b]_]]_testing.xml",
        ...(params.record ? { record: true } : {}),
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.error || `Plivo error ${resp.status}` };
    return { success: true, callSid: data.request_uuid, status: "initiated" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsPlivo(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://api.plivo.com/v1/Account/${config.authId}/Message/`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.authId}:${config.authToken}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dst: params.to.replace(/\+/g, ""),
        src: from.replace(/\+/g, ""),
        text: params.body,
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.error || `Plivo SMS error ${resp.status}` };
    return { success: true, messageSid: data.message_uuid?.[0], status: "sent" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function callSinch(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://calling.api.sinch.com/calling/v1/callouts`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.applicationId}:${config.apiSecret}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "ttsCallout",
        ttsCallout: {
          cli: from,
          destination: { type: "number", endpoint: params.to },
          text: "Appel en cours de connexion.",
        },
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.message || `Sinch error ${resp.status}` };
    return { success: true, callSid: data.callId, status: "initiated" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsSinch(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://sms.api.sinch.com/xms/v1/${config.applicationId}/batches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [params.to],
        from: from,
        body: params.body,
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.text || `Sinch SMS error ${resp.status}` };
    return { success: true, messageSid: data.id, status: "sent" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function callBandwidth(config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://voice.bandwidth.com/api/v2/accounts/${config.accountId}/calls`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.apiToken}:${config.apiSecret}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: params.to,
        from: from,
        applicationId: config.applicationId,
        answerUrl: params.callbackUrl || "https://www.bandwidth.com/docs",
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.description || `Bandwidth error ${resp.status}` };
    return { success: true, callSid: data.callId, status: "initiated" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function smsBandwidth(config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  try {
    const from = params.from || config.fromNumber || "";
    const resp = await fetch(`https://messaging.bandwidth.com/api/v2/users/${config.accountId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${config.apiToken}:${config.apiSecret}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [params.to],
        from: from,
        text: params.body,
        applicationId: config.applicationId,
      }),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.description || `Bandwidth SMS error ${resp.status}` };
    return { success: true, messageSid: data.id, status: "accepted" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

const CALL_HANDLERS: Record<string, (config: TelephonyProviderConfig, params: MakeCallParams) => Promise<CallResult>> = {
  twilio: callTwilio,
  vonage: callVonage,
  telnyx: callTelnyx,
  plivo: callPlivo,
  sinch: callSinch,
  bandwidth: callBandwidth,
};

const SMS_HANDLERS: Record<string, (config: TelephonyProviderConfig, params: SendSmsParams) => Promise<SmsResult>> = {
  twilio: smsTwilio,
  vonage: smsVonage,
  telnyx: smsTelnyx,
  plivo: smsPlivo,
  sinch: smsSinch,
  bandwidth: smsBandwidth,
};

export async function makeCall(provider: string, config: TelephonyProviderConfig, params: MakeCallParams): Promise<CallResult> {
  const handler = CALL_HANDLERS[provider];
  if (!handler) return { success: false, error: `Fournisseur non supporte: ${provider}` };
  return handler(config, params);
}

export async function sendSms(provider: string, config: TelephonyProviderConfig, params: SendSmsParams): Promise<SmsResult> {
  const handler = SMS_HANDLERS[provider];
  if (!handler) return { success: false, error: `Fournisseur SMS non supporte: ${provider}` };
  return handler(config, params);
}

// --- WhatsApp -------------------------------------------------------------
//
// Twilio reutilise l'endpoint Messages.json pour WhatsApp; seuls les numeros
// From/To sont prefixes par "whatsapp:". Le numero expediteur doit etre un
// sender WhatsApp valide (numero approuve par Meta ou le Sandbox Twilio,
// ex. "whatsapp:+14155238886"). On lit `config.whatsappNumber` en priorite,
// sinon on retombe sur `fromNumber`.

export interface SendWhatsAppParams {
  to: string;
  from?: string;
  body: string;
  statusCallback?: string;
}

function withWhatsAppPrefix(num: string): string {
  const trimmed = (num || "").trim();
  if (!trimmed) return "";
  return /^whatsapp:/i.test(trimmed) ? trimmed : `whatsapp:${trimmed}`;
}

async function whatsAppTwilio(config: TelephonyProviderConfig, params: SendWhatsAppParams): Promise<SmsResult> {
  try {
    const accountSid = config.accountSid;
    const authToken = config.authToken;
    const rawFrom = params.from || config.whatsappNumber || config.fromNumber || "";
    const from = withWhatsAppPrefix(rawFrom);
    const to = withWhatsAppPrefix(params.to);
    if (!from) return { success: false, error: "Numero expediteur WhatsApp non configure." };
    const urlEncodedBody = new URLSearchParams({
      To: to,
      From: from,
      Body: params.body,
      ...(params.statusCallback ? { StatusCallback: params.statusCallback } : {}),
    });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: urlEncodedBody.toString(),
    });
    const data = await resp.json() as any;
    if (!resp.ok) return { success: false, error: data.message || `Twilio WhatsApp error ${resp.status}` };
    return { success: true, messageSid: data.sid, status: data.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

const WHATSAPP_HANDLERS: Record<string, (config: TelephonyProviderConfig, params: SendWhatsAppParams) => Promise<SmsResult>> = {
  twilio: whatsAppTwilio,
};

export async function sendWhatsApp(provider: string, config: TelephonyProviderConfig, params: SendWhatsAppParams): Promise<SmsResult> {
  const handler = WHATSAPP_HANDLERS[provider];
  if (!handler) return { success: false, error: `Fournisseur WhatsApp non supporte: ${provider}` };
  return handler(config, params);
}
