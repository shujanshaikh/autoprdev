import { getIcon } from "material-file-icons";

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

export function getFileTypeIconName(file: string) {
  return getIcon(pathParts(file).name).name;
}

export function FileTypeIcon({ file, className }: { file: string; className?: string }) {
  const icon = getIcon(pathParts(file).name);

  return (
    <span
      aria-hidden="true"
      className={className}
      data-file-icon={icon.name}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
