import React, { createContext, useContext, useState } from "react";
import { useColorScheme } from "react-native";
import colors from "@/constants/colors";
import { setThemeOverride } from "@/hooks/useColors";

type ThemeMode = "system" | "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
  colors: typeof colors.light;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "system",
  setMode: () => {},
  isDark: false,
  colors: colors.light,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  const setMode = (m: ThemeMode) => {
    setThemeOverride(m);
    setModeState(m);
  };

  const isDark = mode === "dark" || (mode === "system" && systemScheme === "dark");
  const palette = isDark ? colors.dark : colors.light;

  return (
    <ThemeContext.Provider value={{ mode, setMode, isDark, colors: { ...palette, radius: colors.radius } as any }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
