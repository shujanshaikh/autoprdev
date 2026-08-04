import { useThemeContext } from "../theme/ThemeProvider";

export function useAppTheme() {
  return useThemeContext().theme;
}

export function useAppThemePreference() {
  const { preference, setPreference } = useThemeContext();
  return { preference, setPreference };
}
