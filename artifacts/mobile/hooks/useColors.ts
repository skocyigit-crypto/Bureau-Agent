import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

let _themeOverride: "system" | "light" | "dark" = "system";
export function setThemeOverride(mode: "system" | "light" | "dark") {
  _themeOverride = mode;
}
export function getThemeOverride() {
  return _themeOverride;
}

export function useColors() {
  const scheme = useColorScheme();
  const effectiveScheme = _themeOverride === "system" ? scheme : _themeOverride;
  const palette = effectiveScheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
