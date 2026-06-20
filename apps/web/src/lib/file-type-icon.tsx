import {
  SiBabel,
  SiC,
  SiCplusplus,
  SiCss,
  SiDart,
  SiDocker,
  SiElixir,
  SiErlang,
  SiGo,
  SiGraphql,
  SiHaskell,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiLess,
  SiLua,
  SiMarkdown,
  SiNginx,
  SiNodedotjs,
  SiPerl,
  SiPhp,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSass,
  SiScala,
  SiSharp,
  SiShell,
  SiSvelte,
  SiSwift,
  SiTypescript,
  SiVuedotjs,
  SiYaml,
} from "@icons-pack/react-simple-icons";
import { FileCode2 } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type IconEntry = {
  component: ComponentType<SVGProps<SVGSVGElement>>;
  color: string;
};

const iconMap = {
  ts: { component: SiTypescript, color: "#3178C6" },
  tsx: { component: SiReact, color: "#149ECA" },
  js: { component: SiJavascript, color: "#F7DF1E" },
  jsx: { component: SiReact, color: "#149ECA" },
  mjs: { component: SiJavascript, color: "#F7DF1E" },
  cjs: { component: SiJavascript, color: "#F7DF1E" },
  py: { component: SiPython, color: "#3776AB" },
  pyw: { component: SiPython, color: "#3776AB" },
  go: { component: SiGo, color: "#00ADD8" },
  rs: { component: SiRust, color: "#DEA584" },
  php: { component: SiPhp, color: "#777BB4" },
  rb: { component: SiRuby, color: "#CC342D" },
  swift: { component: SiSwift, color: "#F05138" },
  kt: { component: SiKotlin, color: "#7F52FF" },
  kts: { component: SiKotlin, color: "#7F52FF" },
  dart: { component: SiDart, color: "#0175C2" },
  cpp: { component: SiCplusplus, color: "#00599C" },
  cc: { component: SiCplusplus, color: "#00599C" },
  cxx: { component: SiCplusplus, color: "#00599C" },
  c: { component: SiC, color: "#A8B9CC" },
  cs: { component: SiSharp, color: "#239120" },
  node: { component: SiNodedotjs, color: "#339933" },
  graphql: { component: SiGraphql, color: "#E10098" },
  gql: { component: SiGraphql, color: "#E10098" },
  babel: { component: SiBabel, color: "#F9DC3E" },
  sh: { component: SiShell, color: "#4EAA25" },
  bash: { component: SiShell, color: "#4EAA25" },
  zsh: { component: SiShell, color: "#4EAA25" },
  fish: { component: SiShell, color: "#4EAA25" },
  pl: { component: SiPerl, color: "#39457E" },
  pm: { component: SiPerl, color: "#39457E" },
  lua: { component: SiLua, color: "#2C2D72" },
  ex: { component: SiElixir, color: "#4B275F" },
  exs: { component: SiElixir, color: "#4B275F" },
  erl: { component: SiErlang, color: "#A90533" },
  hs: { component: SiHaskell, color: "#5D4F85" },
  scala: { component: SiScala, color: "#DC322F" },
  css: { component: SiCss, color: "#1572B6" },
  scss: { component: SiSass, color: "#CC6699" },
  sass: { component: SiSass, color: "#CC6699" },
  less: { component: SiLess, color: "#1D365D" },
  html: { component: SiHtml5, color: "#E34F26" },
  htm: { component: SiHtml5, color: "#E34F26" },
  svelte: { component: SiSvelte, color: "#FF3E00" },
  vue: { component: SiVuedotjs, color: "#42B883" },
  json: { component: SiJson, color: "#F5F5F5" },
  md: { component: SiMarkdown, color: "#FFFFFF" },
  markdown: { component: SiMarkdown, color: "#FFFFFF" },
  yml: { component: SiYaml, color: "#CB171E" },
  yaml: { component: SiYaml, color: "#CB171E" },
  react: { component: SiReact, color: "#149ECA" },
  typescript: { component: SiTypescript, color: "#3178C6" },
  javascript: { component: SiJavascript, color: "#F7DF1E" },
  docker: { component: SiDocker, color: "#2496ED" },
  nginx: { component: SiNginx, color: "#009639" },
} as const;

export function pathParts(path: string): { name: string; dir: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
  const index = normalized.lastIndexOf("/");
  if (index === -1) {
    return { name: normalized, dir: "" };
  }
  return {
    name: normalized.slice(index + 1) || normalized,
    dir: normalized.slice(0, index),
  };
}

function getFileExtension(filename: string): string {
  const name = filename.split("/").pop() || filename;
  const lastDot = name.lastIndexOf(".");
  return lastDot === -1 ? "" : name.slice(lastDot + 1).toLowerCase();
}

function getFileTypeIconEntry(filename: string): IconEntry | undefined {
  const baseName = (filename.split("/").pop() || filename).toLowerCase();
  if (baseName === "dockerfile") return iconMap.docker;
  if (baseName === "nginx.conf") return iconMap.nginx;
  const ext = getFileExtension(filename) as keyof typeof iconMap;
  return iconMap[ext];
}

export function FileTypeIcon({ file, className }: { file: string; className?: string }) {
  const iconEntry = getFileTypeIconEntry(file);
  if (!iconEntry) {
    return <FileCode2 className={className} aria-hidden="true" />;
  }

  const IconComponent = iconEntry.component;
  return <IconComponent className={className} color={iconEntry.color} aria-hidden="true" />;
}
