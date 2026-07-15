import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { setBaseUrl, setAuthTokenGetter, setDefaultOrigin } from "@workspace/api-client-react";
import { API_BASE, MOBILE_APP_ORIGIN } from "@/lib/api-config";
import { loadSessionToken, saveSessionToken, clearSessionToken } from "@/lib/secure-session";

// Configure le client API genere (OpenAPI / @workspace/api-client-react) une
// seule fois au chargement du module : meme URL de base que `fetchAuth`. Les
// fonctions generees (listCalls, createContact, ...) recoivent un chemin
// relatif (`/api/...`) et `customFetch` y prefixe API_BASE. Le Bearer token,
// lui, est fourni dynamiquement via setAuthTokenGetter dans AuthProvider.
setBaseUrl(API_BASE);
// Cf. MOBILE_APP_ORIGIN dans lib/api-config.ts : un build natif n'envoie pas
// d'Origin/Referer automatiquement, ce qui ferait rejeter chaque requete non-
// GET par la verification CSRF du backend.
setDefaultOrigin(MOBILE_APP_ORIGIN);

interface User {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  role: string;
  departement?: string;
  organisation?: string;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  fetchAuth: (url: string, options?: RequestInit) => Promise<Response>;
  authHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => ({ success: false }),
  logout: async () => {},
  fetchAuth: async () => new Response(),
  authHeaders: () => ({}),
});

/**
 * Authentification mobile basee sur un Bearer token HMAC stateless,
 * emis par le backend (POST /api/auth/login avec `wantsToken: true`).
 *
 * AVANT: le client lisait l'en-tete `Set-Cookie` de la reponse de
 * login, en gardait la portion `name=value` (perdant Secure / SameSite
 * / __Host- / HttpOnly), puis renvoyait ce fragment dans un en-tete
 * `Cookie:` manuel. Ce pattern court-circuitait toutes les protections
 * d'attribut du cookie et empechait le navigateur (RN runtime) de
 * gerer la rotation. C'etait un anti-pattern documente cote serveur.
 *
 * APRES: le serveur signe un token opaque via HMAC-SHA256 (rotation
 * SESSION_SECRETS deja en place). On le stocke dans un coffre CHIFFRE
 * (`expo-secure-store`, voir `@/lib/secure-session`) et on l'envoie via
 * `Authorization: Bearer <token>` — l'en-tete HTTP standard, supporte tel
 * quel par tous les middlewares en aval.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiToken, setApiToken] = useState<string | null>(null);

  // Le client API genere lit le token via un getter synchrone : on garde
  // donc une ref a jour plutot que de re-enregistrer le getter a chaque
  // changement de token (le getter capture la ref, pas la valeur figee).
  const apiTokenRef = useRef<string | null>(null);
  useEffect(() => { apiTokenRef.current = apiToken; }, [apiToken]);
  useEffect(() => {
    setAuthTokenGetter(() => apiTokenRef.current);
    return () => setAuthTokenGetter(null);
  }, []);

  const fetchAuth = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      Origin: MOBILE_APP_ORIGIN,
      ...(options.headers as Record<string, string> || {}),
    };
    if (apiToken && !headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }
    return fetch(url, { ...options, headers });
  }, [apiToken]);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const token = await loadSessionToken();
      if (token) {
        setApiToken(token);
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else {
          await clearSessionToken();
          setApiToken(null);
        }
      }
    } catch (err) {
      console.warn("[Auth] restoreSession failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: MOBILE_APP_ORIGIN },
        body: JSON.stringify({ email: email.trim(), password, wantsToken: true }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || "Identifiants invalides." };
      }

      const data = await res.json();

      if (typeof data?.apiToken === "string" && data.apiToken.length > 0) {
        setApiToken(data.apiToken);
        try {
          await saveSessionToken(data.apiToken);
        } catch (err) {
          // La session reste valide en memoire pour cette execution, mais
          // ne survivra pas a un redemarrage. On previent l'utilisateur.
          console.warn("[Auth] persistance du token echouee:", err);
          return {
            success: true,
            error: "Connexion etablie mais le stockage securise est indisponible : vous devrez vous reconnecter au redemarrage.",
          };
        }
      } else {
        // Le backend a refuse d'emettre un token (deploiement legacy?).
        // Refuser le login plutot que de laisser une session muette.
        return {
          success: false,
          error: "Le serveur n'a pas emis de token API. Mettez a jour le serveur.",
        };
      }

      setUser(data);
      return { success: true };
    } catch {
      return { success: false, error: "Erreur de connexion au serveur." };
    }
  }

  async function logout() {
    try {
      if (apiToken) {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, Origin: MOBILE_APP_ORIGIN },
        });
      }
    } catch (err) {
      console.warn("[Auth] logout request failed:", err);
    } finally {
      setUser(null);
      setApiToken(null);
      await clearSessionToken();
    }
  }

  // Doit toujours inclure Origin, comme fetchAuth() ci-dessus — cet en-tete
  // n'est jamais envoye automatiquement par les builds natifs, et son absence
  // fait 403 (origine invalide) cote serveur. Plusieurs ecrans utilisaient ce
  // helper directement pour des SSE POST / uploads natifs sans Origin,
  // reproduisant le meme bug deja corrige ailleurs (LocationContext, login) —
  // corrige ici a la source plutot que par appelant.
  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { Origin: MOBILE_APP_ORIGIN };
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
    return headers;
  }, [apiToken]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout, fetchAuth, authHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Re-export pour conserver les imports existants (`from "@/contexts/AuthContext"`).
// La source de verite est desormais `@/lib/api-config`.
export { API_BASE };
