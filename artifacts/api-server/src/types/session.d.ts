import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userRole?: string;
    userEmail?: string;
    prenom?: string;
    nom?: string;
    organisationId?: number;
    pendingMfaUserId?: number;
    pendingMfaExpiresAt?: number;
    loginIp?: string;
    loginUserAgent?: string;
    loginAt?: number;
    googleOAuthState?: string;
    googleOAuthServices?: string[];
  }
}
