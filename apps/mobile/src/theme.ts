export const lightTheme = {
  mode: "light",
  screen: "#F6F3EA",
  screenAlt: "#EFECE1",
  surface: "#FFFCF4",
  ink: "#26241F",
  muted: "#716C61",
  faint: "#A09A8D",
  line: "#DCD7C5",
  darkSurface: "#282C39",
  darkSurfaceAlt: "#232734",
  darkInk: "#F0EDE2",
  darkMuted: "#A6A9B6",
  darkLine: "rgba(240, 237, 226, 0.16)",
  accent: "#F2BD45",
  accentInk: "#3A2A04",
  accentSecondary: "#BCCDF4",
  success: "#79C99E",
} as const;

export const darkTheme = {
  ...lightTheme,
  mode: "dark",
  screen: "#232734",
  screenAlt: "#282C39",
  surface: "#303443",
  ink: "#F0EDE2",
  muted: "#A6A9B6",
  faint: "#7C7F8D",
  line: "rgba(240, 237, 226, 0.16)",
  darkSurface: "#171A24",
  darkSurfaceAlt: "#11131B",
} as const;

export type AppTheme = typeof lightTheme | typeof darkTheme;
