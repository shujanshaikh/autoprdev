import { useColorScheme } from "react-native";

import { darkTheme, lightTheme } from "../theme";

export function useAppTheme() {
  return useColorScheme() === "light" ? lightTheme : darkTheme;
}
