import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { NotificationPrefsProvider } from "@/contexts/NotificationPrefsContext";
import { UnreadBadgesProvider } from "@/contexts/UnreadBadgesContext";
import { PrivacyOverlay } from "@/components/PrivacyOverlay";

if (Platform.OS !== "web") {
  SplashScreen.preventAutoHideAsync();
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="messages" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="calendar" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="analytics" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="ai-agents" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="automations" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="checkins" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="users" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="audit-log" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="integrations" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="organisations" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="face-recognition" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="ai-chat" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="telephony" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="notifications" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="admin-reports" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="voice-assistant" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="meetings" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="daily-digest" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="workforce-intelligence" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="workforce-agent" options={{ headerShown: false, presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      if (Platform.OS !== "web") {
        SplashScreen.hideAsync();
      }
    }
  }, [fontsLoaded, fontError]);

  // Tâche #81 — quand la secrétaire tape sur une notification système,
  // on lit le hint `route` posé par UnreadBadgesContext pour l'amener
  // direct sur Messages / Tâches / Appels au lieu de rouvrir le dernier
  // écran. Couvre aussi le cas "app tuée" via getLastNotificationResponseAsync.
  //
  // Subtilité cold-start : au tout premier rendu les fonts ne sont pas encore
  // chargées et `RootLayoutNav` n'est pas monté → `router.push` lève "Attempted
  // to navigate before mounting the Root Layout component". On met donc la
  // route en attente et on la rejoue dès que le navigateur est prêt
  // (fontsLoaded || fontError).
  const pendingRouteRef = useRef<string | null>(null);
  const navReadyRef = useRef(false);
  const navReady = Platform.OS === "web" ? true : fontsLoaded || !!fontError;

  const flushPendingRoute = React.useCallback(() => {
    const route = pendingRouteRef.current;
    if (!route || !navReadyRef.current) return;
    try {
      router.push(route as never);
      pendingRouteRef.current = null;
    } catch (err) {
      // Navigateur pas encore prêt : on garde la route en attente,
      // l'effet `navReady` ci-dessous la rejouera dès qu'il l'est.
      if (__DEV__) {
        console.warn("[notif] router.push deferred:", err);
      }
    }
  }, []);

  // Rejoue la navigation en attente dès que le navigateur devient prêt
  // (cas cold-start où la notification est traitée avant que `RootLayoutNav`
  // ne soit monté).
  useEffect(() => {
    navReadyRef.current = navReady;
    if (navReady) flushPendingRoute();
  }, [navReady, flushPendingRoute]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    // Whitelist explicite : on n'accepte que les routes que UnreadBadgesContext
    // peut légitimement émettre. Empêche qu'un payload malformé n'envoie la
    // secrétaire vers une route arbitraire.
    const ALLOWED_ROUTES = new Set<string>([
      "/messages",
      "/(tabs)/tasks",
      "/(tabs)/calls",
    ]);

    const extractRoute = (response: Notifications.NotificationResponse) => {
      const data = response?.notification?.request?.content?.data as
        | { route?: string }
        | undefined;
      const route = data?.route;
      if (typeof route !== "string" || !ALLOWED_ROUTES.has(route)) return null;
      return route;
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const route = extractRoute(response);
      if (!route) return;
      pendingRouteRef.current = route;
      flushPendingRoute();
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Cas "cold start": l'app a été ouverte en tapant sur la notif alors
    // qu'elle était killée. Le listener n'aura rien reçu, on rejoue.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const route = extractRoute(response);
        if (!route) return;
        pendingRouteRef.current = route;
        flushPendingRoute();
        // Évite de re-naviguer au prochain démarrage à froid.
        const maybeClear = (
          Notifications as unknown as {
            clearLastNotificationResponseAsync?: () => Promise<void>;
          }
        ).clearLastNotificationResponseAsync;
        if (typeof maybeClear === "function") {
          maybeClear().catch(() => {});
        }
      })
      .catch(() => {});

    return () => sub.remove();
  }, [flushPendingRoute]);

  if (!fontsLoaded && !fontError) {
    if (Platform.OS === "web") {
      return null;
    }
    return null;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <ThemeProvider>
                <PrivacyProvider>
                  <AuthProvider>
                    <NotificationPrefsProvider>
                      <UnreadBadgesProvider>
                        <RootLayoutNav />
                        <PrivacyOverlay />
                      </UnreadBadgesProvider>
                    </NotificationPrefsProvider>
                  </AuthProvider>
                </PrivacyProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
