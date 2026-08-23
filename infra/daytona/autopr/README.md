# AutoPR Daytona Snapshot

This snapshot builds a self-contained AutoPR workstation on Ubuntu 24.04. It includes the FFF runtime used by AutoPR search tools, Bash terminals, Daytona's required VNC/Computer Use packages, a small gateway to the official CUA Driver SDK, and the desktop customization used by AutoPR's Daytona preview.

Create a Daytona snapshot named `autopr-cua` from this Dockerfile, then AutoPR will use it by default. The application still honors `DAYTONA_SNAPSHOT` when you need to override the default.

## Base Image

The Dockerfile defaults to:

```text
ubuntu:24.04
```

The image creates the `daytona` user and installs the complete custom-image package contract itself. It intentionally does not inherit from `daytonaio/sandbox`.

This follows Daytona's [custom-image VNC requirements](https://www.daytona.io/docs/en/vnc-access/#required-packages) and [Dockerfile snapshot workflow](https://www.daytona.io/docs/en/snapshots/#snapshots-from-local-images). The desktop package layout remains aligned with `libs/xfce-cua` in the local official CUA checkout, while the official Driver SDK is pinned separately for reproducibility.

## Terminal Profile

The `daytona` user's login shell and the image-level `SHELL` are both `/bin/bash`. Zsh, Fish, Starship, and their profile files are intentionally absent. The only terminal customization retained is the optional tmux configuration:

```text
/home/daytona/.tmux.conf
```

AutoPR launches a short-lived `ttyd` process for each browser terminal preview. Each process receives the selected thread's authoritative checkout or worktree through `ttyd --cwd` and listens on its own signed-preview port, so concurrent thread terminals cannot overwrite one another's working directory. The processes exit after their client disconnects or after a bounded timeout.

Tmux is opt-in so Daytona's hosted web terminal, AutoPR's embedded ttyd terminal, and automated sessions continue to open as normal Bash login shells.

AutoPR does not rewrite or sync these terminal files at runtime. Update the files in this directory and rebuild the `autopr-cua` snapshot when the terminal profile needs to change.

ttyd is installed from its official release at the version pinned in the Dockerfile and verified with the architecture-specific checksum.

## Developer and Diagnostic Tools

The snapshot installs these tools from the Debian/Ubuntu repositories supplied by the base image:

- ripgrep (`rg`)
- fd-find (`fdfind`, plus a stable `fd` symlink)
- fzf
- bat (`batcat`, plus a stable `bat` symlink)
- lsof
- netcat-openbsd (`nc`)
- dnsutils (`dig`)
- procps (`ps`)
- psmisc (`pstree`)
- sqlite3
- build-essential

GitHub CLI (`gh`), git-delta (`delta`), and ttyd use pinned official releases because their distro availability and versions vary across supported base-image releases. Their amd64 and arm64 checksums are pinned and verified in the Dockerfile. The original `fdfind` and `batcat` executable names remain available alongside the convenience symlinks.

The Daytona snapshot is intentionally amd64-only because Google publishes Chrome Stable for Linux only on amd64 and Chrome is required, not optional. A non-amd64 build stops explicitly instead of producing a browserless desktop.

The snapshot also includes conservative system Git defaults for pruning stale remote-tracking refs, histogram diffs, and `main` as the initial branch. Git rerere is enabled so repeated agent retries can reuse recorded conflict resolutions, while `zdiff3` conflict markers include the common ancestor to make overlapping edits easier to resolve. User and repository Git configuration can override all of these defaults.

## Desktop Profile

Because the base is bare Ubuntu, the snapshot installs the exact custom-image desktop stack Daytona requires: Xvfb, XFCE, xfce4-terminal, x11vnc, noVNC, D-Bus, and the required X11 libraries. Daytona still owns starting, stopping, health-checking, and recording those processes through its Computer Use API. AutoPR uses the co-located official CUA Driver for agent interaction.

- Google Chrome Stable, installed from Google's Linux apt repository on amd64 builders.
- Chrome-compatible wrappers in `/opt/autopr/bin` so AutoPR's browser open path prefers Chrome even when it asks for `chromium`.
- XFCE application launchers and preferred-browser helpers that show one `Google Chrome` browser entry and no Firefox or Chromium installation.
- Chrome launches without `--no-sandbox`; the snapshot preserves Chrome's own setuid sandbox permissions instead of forcing the unsupported flag.
- A minimal XFCE profile under `/home/daytona/.config/xfce4`, with a compositor-backed, fully transparent bottom-center launcher strip containing only Chrome and the default terminal. The session reapplies its zero-alpha RGBA background so persisted XFCE state cannot restore the black rectangle.
- Chrome starts maximized and receives an explicit XFWM maximize state after its first window appears, preventing stale profile geometry from reopening it at half width.
- XDG user-dir config that collapses Documents, Pictures, Music, Videos, Downloads, Templates, Public, and Desktop into the home folder instead of creating separate visible folders.
- A desktop startup hook that reapplies the wallpaper whenever Daytona starts XFCE.
- A clean wallpaper installed at `/usr/share/backgrounds/autopr/wallpaper.png`.
- An invisible hardware Xcursor theme. Real pointer motion and input remain active, but Daytona cannot composite the stock black X11 cursor over CUA's animated software cursor.
- A fixed `1920x1080` noVNC desktop, matching Daytona's computer-use `VNC_RESOLUTION` path, that AutoPR scales inside the desktop panel without resizing the sandbox display.
- The web preview trusts noVNC's completed connection handshake instead of treating dark framebuffer pixels as a transport failure. After repeated downstream failures it restarts x11vnc, waits for port 5901, then restarts noVNC and waits for port 6080. This preserves Xvfb, XFCE, and open applications without racing a downstream server that has not bound yet. Expiring credentials are replaced before another noVNC handshake, a connection revision replaces the RFB client even when Daytona returns the same signed URL, and bounded recovery prevents reconnect storms. The compact and full viewers share preview requests and one five-minute activity heartbeat per project, keeping an actively viewed desktop from falling through the 15-minute auto-stop window without duplicate Daytona calls.
- Command-line developer utilities such as htop, jq, tmux, tree, git-lfs, zip/unzip, vim, nano, and the diagnostic tools listed above. They do not add third-party GUI applications.

## CUA Computer Use

The snapshot installs pinned `uv` 0.9.26 into an isolated bootstrap environment, then uses it to install an isolated Python 3.13 runtime. That runtime contains only the official `cua-driver==0.21.0` SDK and AutoPR's stdlib-only HTTP gateway; Ubuntu's system Python is left untouched. The old patched `cua-computer-server`, its source checkout, and the `cua-core`/`cua-auto` compatibility dependencies are no longer part of the image.

`autopr-cua-gateway` starts lazily on port `8765` and owns one same-process runtime through `CuaDriver.create()`, the application boundary recommended by the official SDK. There is no daemon socket or second runtime generation to supervise. Readiness validates the SDK's side-effect-free metadata, screen, cursor, and implicit-session APIs, and the launcher can replace a gateway that exits during startup. Screenshot responses carry one copy of the PNG, and native calls end before the agent's HTTP and tool deadlines so a timeout cannot leave hidden work blocking the next action. Screenshot, pointer, keyboard, scroll, drag, and clipboard operations use the official typed SDK methods directly. URL opening goes through CUA's `launch_app` tool. The gateway uses `wmctrl` and `xprop` only for X11 window discovery, focus, and maximize.

The SDK session deliberately has no public label. Every action passes `session=None`, allowing CUA 0.21 to reuse the SDK transport's private implicit lifecycle, and selects `ActionTarget.DESKTOP(display_id="primary")` independently per call. Readiness requires an implicit session, a null public session label, `label_visible=false`, the built-in theme, and an enabled embedded cursor. This keeps the official animated pointer without adding a product label beneath it.

The X11 overlay is a click-through, top-level software-composited window on Daytona's desktop, so Daytona's unchanged X11 screen recorder captures it together with the rest of the display. Daytona's recorder can also obtain the hardware cursor through XFixes instead of desktop pixels, so the image configures a fully transparent system Xcursor while preserving its coordinates and input delivery; only CUA supplies visible cursor pixels. Driver startup now fails clearly instead of silently dropping to a second automation backend with different screenshot and cursor behavior. The gateway binds inside the VM so AutoPR can access it through a short-lived Daytona signed preview URL; the signed URL is never included in model output or persisted tool metadata. Daytona remains responsible for bringing up Xvfb/XFCE/noVNC and for start/stop/download of screen recordings.

The agent runtime probes the gateway status, protocol, command manifest, desktop size, and label-safe cursor state before every interaction sequence. The embedded Driver uses an unlabeled implicit desktop session, accepts the Driver's cursorless mode, and revives that session once when its idle TTL expires. It also reads all four Daytona desktop process states; an explicitly stopped Xvfb, XFCE, x11vnc, or noVNC process overrides a stale aggregate `active` state and only that failed process is restarted. It initializes or recovers the Driver before asking Daytona to start a recording, so startup is never part of the captured demo. It no longer downloads, launches, or recognizes the old patched server. Rebuilding the snapshot is required to install the gateway.

The desktop setup files live under `desktop/`. Update those files and rebuild the `autopr-cua` snapshot when you want to change the visible desktop.

## Build

From the AutoPR repo root:

```bash
daytona snapshot create autopr-cua \
  --dockerfile infra/daytona/autopr/Dockerfile \
  --cpu 4 \
  --memory 8 \
  --disk 10
```

The Daytona CLI automatically includes files referenced by `COPY` and `ADD` in the Dockerfile. Daytona's custom-image documentation requires the VNC packages already installed here, and its local Dockerfile builder targets amd64.

You can verify the snapshot exists with:

```bash
daytona snapshot list
```

## Verification

After creating a sandbox from the `autopr-cua` snapshot and cloning a repo into `/home/<repository-name>`, run:

```bash
REPO_DIR=/home/<repository-name>
echo "$SHELL"
bash --version
test "$SHELL" = /bin/bash
test "$(getent passwd daytona | cut -d: -f7)" = /bin/bash
! command -v zsh
tmux -V
test -f /home/daytona/.tmux.conf
for executable in node npm uv rg fd fdfind fzf bat batcat delta flock gh lsof nc dig ps pstree sqlite3 ttyd Xvfb x11vnc websockify startxfce4 xfce4-terminal; do
  command -v "$executable"
done
/opt/autopr/cua/bin/python -c 'from importlib.metadata import version; from cua_driver import CuaDriver, get_binary_path; from cua_driver._native_contract import ActionTarget, CaptureScope, StartSessionInput; assert version("cua-driver") == "0.21.0"; assert get_binary_path().is_file(); assert ActionTarget.DESKTOP(display_id="primary").display_id == "primary"; assert StartSessionInput(session=None, capture_scope=CaptureScope.DESKTOP, cursor_theme=None).session is None; assert hasattr(CuaDriver, "get_desktop_state"); assert hasattr(CuaDriver, "start_session")'
/opt/autopr/cua/bin/python -m py_compile /opt/autopr/cua-gateway/cua_gateway.py
test -s /usr/share/icons/AutoPRHidden/cursors/left_ptr
rg --fixed-strings 'XCURSOR_THEME=AutoPRHidden' /opt/autopr/bin/autopr-cua-gateway
command -v autopr-cua-gateway
CUA_PORT=8765 DISPLAY=:1 autopr-cua-gateway
curl --fail --silent http://127.0.0.1:8765/status | jq -e '.status == "ok" and .os_type == "linux" and .backend == "cua-driver"'
curl --fail --silent http://127.0.0.1:8765/commands | jq -e '.commands.screenshot and .commands.left_click and .commands.type_text and .commands.get_desktop_state and .commands.get_agent_cursor_state'
curl --fail --silent -H 'Content-Type: application/json' --data '{"command":"version"}' http://127.0.0.1:8765/cmd | jq -e '.success and .package == "autopr-cua-gateway" and .version == "1.3.0" and .driver_version == "0.21.0"'
curl --fail --silent -H 'Content-Type: application/json' --data '{"command":"get_agent_cursor_state"}' http://127.0.0.1:8765/cmd | jq -e '.success and .runtime_mode == "embedded" and (.enabled | type) == "boolean" and .implicit and .session == null and .label_visible == false and .theme.id == "cua.default"'
rg --version
fd --version
bat --version
delta --version
gh --version
git config --system --get rerere.enabled
git config --system --get fetch.prune
git config --system --get merge.conflictStyle
git config --system --get diff.algorithm
git config --system --get init.defaultBranch
command -v google-chrome
google-chrome --version
for browser_package in firefox firefox-esr chromium chromium-browser; do ! dpkg-query -W -f='${db:Status-Abbrev}' "$browser_package" 2>/dev/null | grep -q '^ii'; done
echo "$BROWSER"
grep -R "Name=Google Chrome" /usr/share/applications/google-chrome.desktop /usr/share/xfce4/helpers/google-chrome.desktop
grep -R "NoDisplay=true" /usr/share/applications/exo-web-browser.desktop /usr/share/applications/chromium.desktop 2>/dev/null
grep -R 'XDG_DOCUMENTS_DIR="$HOME"' /home/daytona/.config/user-dirs.dirs
test "$XCURSOR_THEME" = Adwaita
stat -c "%a %U %G" /opt/google/chrome/chrome-sandbox
test -f /usr/share/backgrounds/autopr/wallpaper.png
test -x /usr/bin/startxfce4.autopr-original
test -f /home/daytona/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml
grep -F 'value="p=12;x=960;y=1080"' /home/daytona/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml
test -f /home/daytona/.config/xfce4/panel/launcher-1/google-chrome.desktop
test -f /home/daytona/.config/xfce4/panel/launcher-2/xfce4-terminal.desktop
grep -F 'Icon=org.xfce.terminal' /home/daytona/.config/xfce4/panel/launcher-2/xfce4-terminal.desktop
grep -F -- '--start-maximized' /opt/autopr/desktop/browser-launcher
htop --version
autopr-fff health --cwd "$REPO_DIR"
autopr-fff find --cwd "$REPO_DIR" --query thread --limit 10
autopr-fff find --cwd "$REPO_DIR" --path "src/**/*.ts" --query thread --exclude "test/,node_modules/" --limit 10
autopr-fff grep --cwd "$REPO_DIR" --path src/ --pattern createDaytonaTools --limit 10
```

The CLI is both the smoke-test surface and the harness boundary. AutoPR's `find` and `grep` tools call `autopr-fff` inside Daytona and parse its JSON output, which keeps fff indexing the sandbox checkout instead of the host app checkout. File discovery and content search stay on this FFF path: do not add ripgrep, grep, or shell-search fallback behavior to the agent tools.

`autopr-fff` starts a private, per-workspace daemon on demand. The daemon owns one long-lived FFF finder, so the initial scan is reused across agent tool calls and the native watcher keeps results current. It exits after five idle minutes, isolates frecency/history databases by canonical workspace path, serializes native searches, and falls back to a one-shot finder if its local socket cannot start. Set `AUTOPR_FFF_DAEMON=0` or pass `--no-daemon` for diagnostics.

Content searches have a native 10-second search budget even when the surrounding tool call allows more time. Wildcard-only grep patterns are rejected with guidance to use `read` or `find`; this prevents expensive match-everything retries. FFF `0.10.3` is pinned intentionally as the current stable release.

When a response includes `nextCursor`, pass that value back with the same command to continue pagination. Cursors are encoded in the token itself, so they work across separate `autopr-fff` processes.

## Agent command lifecycle

Foreground `bash` commands use disposable Daytona sessions and are cleaned up after completion or timeout. Long-running commands use `isBackground: true`; the harness keeps their `autopr-*` session alive and returns both the session ID and command ID.

The agent's `process` tool owns the rest of that lifecycle:

- `list` discovers only harness-created `autopr-*` sessions, leaving user terminal sessions private.
- `poll` returns current logs, status, and exit code with the same bounded-output policy as foreground commands.
- `input` sends stdin to an interactive background command.
- `terminate` stops and removes a background session when it is no longer needed.

Agents should poll only when output or completion is expected and must terminate temporary servers and watchers after validation. Repeated identical failures or unchanged polls are detected by the step controller, which forces a tool-free status response instead of spending the remaining step budget in a loop.

## Agent tool reliability contract

The coding tools follow the same bounded, resumable conventions used by mature coding harnesses while keeping Daytona as the source of truth:

- Every file and search scope is resolved to its canonical Daytona workspace path before use. Paths that escape through `..` or symlinks are rejected, and mutations targeting the same canonical file are serialized.
- `read` returns at most 2,000 numbered lines and 64 KiB per call. Its continuation includes both a line offset and an exact byte offset, including when a UTF-8 character crosses the byte boundary.
- `ls` is deterministically sorted and uses 1-based offset pagination. `find` and `grep` retain FFF cursors only when every result in the fetched page was returned, so output clipping cannot silently skip matches.
- `edit` is exact and atomic: ambiguous, missing, overlapping, binary, and no-op edits fail before a write. UTF-8 BOM and CRLF style are preserved. `edit` and `write` keep UI diffs bounded so a large generated file cannot overload model or persistence payloads.
- Foreground `bash` commands default to a 120-second timeout. Command and process output keep the diagnostic tail within 2,000 lines and 50 KiB; output stored in tool details is bounded by the same policy. Environment override names are reported, but their values are never echoed by the harness.
- Computer actions have a bounded execution time, browser navigation accepts only absolute HTTP(S) URLs, and large desktop metadata or recording lists are summarized before they enter the model context.

Tool failures are raised as failures rather than successful text results. This lets model providers, retry logic, and the repeated-failure step controller treat them consistently.
