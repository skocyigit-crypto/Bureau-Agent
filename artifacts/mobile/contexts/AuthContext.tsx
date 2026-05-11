import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { API_BASE, SESSION_STORAGE_KEY } from "@/lib/api-config";

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
 * SESSION_SECRETS deja en place). On le stocke dans AsyncStorage et
 * on l'envoie via `Authorization: Bearer <token>` — l'en-tete HTTP
 * standard, supporte tel quel par tous les middlewares en aval.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiToken, setApiToken] = useState<string | null>(null);

  const fetchAuth = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
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
      const stored = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        let token: string | null = null;
        try {
          const parsed = JSON.parse(stored);
          token = typeof parsed?.token === "string" ? parsed.token : null;
        } catch {
          token = null;
        }
        if (!token) {
          await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
        } else {
          setApiToken(token);
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data);
          } else {
            await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
            setApiToken(null);
          }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, wantsToken: true }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || "Identifiants invalides." };
      }

      const data = await res.json();

      if (typeof data?.apiToken === "string" && data.apiToken.length > 0) {
        setApiToken(data.apiToken);
        await AsyncStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({ token: data.apiToken }),
        );
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
          headers: { Authorization: `Bearer ${apiToken}` },
        });
      }
    } catch (err) {
      console.warn("[Auth] logout request failed:", err);
    } finally {
      setUser(null);
      setApiToken(null);
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  const authHeaders = useCallback((): Record<string, string> => {
    return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
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
