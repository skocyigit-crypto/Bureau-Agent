import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

interface User {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => ({ success: false }),
  logout: async () => {},
});

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);

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
          setUser(data.user);
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

  async function login(email: string, password: string) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        return { success: false, error: "Identifiants invalides." };
      }

      const setCookie = res.headers.get("set-cookie");
      const data = await res.json();

      if (setCookie) {
        const cookieValue = setCookie.split(";")[0];
        setSessionCookie(cookieValue);
        await AsyncStorage.setItem("adb_session", JSON.stringify({ cookie: cookieValue }));
      }

      setUser(data.user);
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
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
