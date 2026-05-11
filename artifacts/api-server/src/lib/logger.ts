import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.headers['x-twilio-signature']",
      "req.headers['stripe-signature']",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.currentPassword",
      "*.newPassword",
      "*.confirmPassword",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.apiKey",
      "*.api_key",
      "*.secret",
      "*.clientSecret",
      "*.client_secret",
      "*.authToken",
      "*.auth_token",
      "*.sessionId",
      "*.mfaSecret",
      "*.totpSecret",
      "*.creditCard",
      "*.cardNumber",
      "*.cvv",
      "*.iban",
      "body.password",
      "body.currentPassword",
      "body.newPassword",
      "body.token",
      "body.code",
      "body.refreshToken",
      "body.accessToken",
      "body.fileContent",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
