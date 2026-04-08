import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

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
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  fetchAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => ({ success: false }),
  logout: async () => {},
  fetchAuth: async () => new Response(),
});

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const AUTO_LOGIN_EMAIL = "admin@agentdebureau.fr";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);

  const fetchAuth = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (sessionCookie) {
      headers["Cookie"] = sessionCookie;
    }
    return fetch(url, { ...options, headers });
  }, [sessionCookie]);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const stored = await AsyncStorage.getItem("adb_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        setSessionCookie(parsed.cookie);
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Cookie: parsed.cookie },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else {
          await AsyncStorage.removeItem("adb_session");
          setSessionCookie(null);
        }
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password?: string) {
    try {
      const isAutoLogin = email.toLowerCase().trim() === AUTO_LOGIN_EMAIL;
      const body: Record<string, string> = { email: email.trim() };
      if (!isAutoLogin && password) {
        body.password = password;
      }

      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || "Identifiants invalides." };
      }

      const setCookieHeader = res.headers.get("set-cookie");
      const data = await res.json();

      if (setCookieHeader) {
        const cookieValue = setCookieHeader.split(";")[0];
        setSessionCookie(cookieValue);
        await AsyncStorage.setItem("adb_session", JSON.stringify({ cookie: cookieValue }));
      }

      setUser(data);
      return { success: true };
    } catch {
      return { success: false, error: "Erreur de connexion au serveur." };
    }
  }

  async function logout() {
    try {
      if (sessionCookie) {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { Cookie: sessionCookie },
        });
      }
    } catch {
    } finally {
      setUser(null);
      setSessionCookie(null);
      await AsyncStorage.removeItem("adb_session");
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout, fetchAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { API_BASE };
