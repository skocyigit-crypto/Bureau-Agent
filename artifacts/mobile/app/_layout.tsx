import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

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
      <Stack.Screen name="stock" options={{ headerShown: false, presentation: "modal" }} />
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
      <Stack.Screen name="prospects" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="invoices" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="projects" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="ai-chat" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="telephony" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="notifications" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="admin-reports" options={{ headerShown: false, presentation: "modal" }} />
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
                <AuthProvider>
                  <RootLayoutNav />
                </AuthProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
