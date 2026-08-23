#!/usr/bin/env python3
"""Build an invisible Xcursor theme for CUA-controlled Daytona desktops.

Daytona's X11 recorder can composite the hardware cursor independently from
the desktop pixels. The real pointer must keep moving for input delivery, but
its bitmap must be transparent so it cannot cover CUA's software overlay.
"""

from __future__ import annotations

import argparse
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

CURSOR_NAMES = {
    "arrow",
    "default",
    "hand",
    "hand1",
    "hand2",
    "left_ptr",
    "pointer",
    "text",
    "watch",
    "xterm",
}


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def transparent_png(size: int = 32) -> bytes:
    rows = b"".join(b"\0" + bytes(size * 4) for _ in range(size))
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(rows, level=9))
        + png_chunk(b"IEND", b"")
    )


def build_theme(output: Path, source_theme: Path) -> None:
    cursors = output / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    output.joinpath("index.theme").write_text(
        "[Icon Theme]\nName=AutoPR Hidden Hardware Cursor\nComment=CUA overlay owns cursor visuals\n",
        encoding="utf-8",
    )

    with tempfile.TemporaryDirectory(prefix="autopr-xcursor-") as temporary:
        workspace = Path(temporary)
        image = workspace / "transparent.png"
        config = workspace / "cursor.conf"
        image.write_bytes(transparent_png())
        config.write_text(f"32 0 0 {image}\n", encoding="utf-8")
        subprocess.run(
            ["xcursorgen", str(config), str(cursors / "left_ptr")],
            check=True,
        )

    names = set(CURSOR_NAMES)
    if source_theme.is_dir():
        names.update(entry.name for entry in source_theme.iterdir())
    for name in sorted(names - {"left_ptr"}):
        destination = cursors / name
        if not destination.exists() and not destination.is_symlink():
            destination.symlink_to("left_ptr")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--source-theme",
        type=Path,
        default=Path("/usr/share/icons/Adwaita/cursors"),
    )
    args = parser.parse_args()
    build_theme(args.output, args.source_theme)


if __name__ == "__main__":
    main()
