# AutoPR Daytona Snapshot

This snapshot extends the Daytona sandbox image with the FFF runtime used by AutoPR search tools, the zsh/starship terminal profile used by the hosted Daytona web terminal and AutoPR's embedded PTY terminal, the CUA computer server used for desktop interaction, and the desktop customization used by AutoPR's Daytona preview.

Create a Daytona snapshot named `autopr-cua` from this Dockerfile, then AutoPR will use it by default. The application still honors `DAYTONA_SNAPSHOT` when you need to override the default.

## Base Image

The Dockerfile defaults to:

```text
daytonaio/sandbox:0.8.0
```

If your current `daytona-large` snapshot is backed by a different Daytona sandbox image or digest, pass it as `DAYTONA_BASE_IMAGE` when creating the snapshot.

## Terminal Profile

The snapshot installs zsh, Starship, tmux, autosuggestions, and syntax highlighting, sets the `daytona` user's login shell to zsh, and writes:

```text
/home/daytona/.zshrc
/home/daytona/.tmux.conf
/home/daytona/.config/starship.toml
```

AutoPR launches a short-lived `ttyd` process for each browser terminal preview. Each process receives the selected thread's authoritative checkout or worktree through `ttyd --cwd` and listens on its own signed-preview port, so concurrent thread terminals cannot overwrite one another's working directory. The processes exit after their client disconnects or after a bounded timeout.

Tmux is opt-in so browser PTYs and automated sessions continue to open as normal zsh shells. Run `work` to create or attach to the shared `autopr` tmux session.

AutoPR does not rewrite or sync these terminal files at runtime. Update the files in this directory and rebuild the `autopr-cua` snapshot when the terminal profile needs to change.

Starship and ttyd are installed from their official releases at the versions pinned in the Dockerfile. Their checksums are selected for the build architecture and verified before installation.

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

GitHub CLI (`gh`), git-delta (`delta`), and ttyd use pinned official releases because their distro availability and versions vary across supported base-image releases. Their amd64 and arm64 checksums are pinned and verified in the Dockerfile. The original `fdfind` and `batcat` executable names remain available alongside the convenience symlinks.

The pinned `gh`, `delta`, Starship, and ttyd installation supports amd64 and arm64. Builds on other architectures stop with an explicit error rather than installing an unverified binary. Google Chrome remains amd64-only, as described below.

The snapshot also includes conservative system Git defaults for pruning stale remote-tracking refs, histogram diffs, and `main` as the initial branch. Git rerere is enabled so repeated agent retries can reuse recorded conflict resolutions, while `zdiff3` conflict markers include the common ancestor to make overlapping edits easier to resolve. User and repository Git configuration can override all of these defaults.

## Desktop Profile

The snapshot keeps Daytona's existing XFCE, x11vnc, noVNC, Xvfb, and recording support intact. AutoPR uses CUA rather than Daytona's mouse, keyboard, screenshot, and display SDK primitives. The customization layer adds and configures:

- Google Chrome Stable, installed from Google's Linux apt repository on amd64 builders.
- Chrome-compatible wrappers in `/opt/autopr/bin` so AutoPR's browser open path prefers Chrome even when it asks for `chromium`.
- XFCE application launchers and preferred-browser helpers that show one `Google Chrome` menu entry and hide the base Chromium/x11vnc launchers.
- Chrome launches without `--no-sandbox`; the snapshot preserves Chrome's own setuid sandbox permissions instead of forcing the unsupported flag.
- A minimal XFCE profile under `/home/daytona/.config/xfce4`.
- XDG user-dir config that collapses Documents, Pictures, Music, Videos, Downloads, Templates, Public, and Desktop into the home folder instead of creating separate visible folders.
- A desktop startup hook that reapplies the wallpaper whenever Daytona starts XFCE.
- A clean wallpaper installed at `/usr/share/backgrounds/autopr/wallpaper.png`.
- An invisible hardware Xcursor theme. Real pointer motion and input remain active, but Daytona cannot composite the stock black X11 cursor over CUA's violet software cursor.
- A fixed `1920x1080` noVNC desktop, matching Daytona's computer-use `VNC_RESOLUTION` path, that AutoPR scales inside the desktop panel without resizing the sandbox display.
- Dev/desktop utilities for a more complete workstation feel: fish, htop, jq, tmux, tree, xterm, git-lfs, zip/unzip, vim, nano, and the developer and diagnostic tools listed above.

## CUA Computer Use

The snapshot uses Daytona's bundled `uv` to install an isolated Python 3.13 runtime and pins CUA source revision `4c386183eab7109bfa9cb9f182e77c4756a4b403` in `/opt/autopr/cua`; Daytona's system Python is left untouched. The source revision is intentional: the published `cua-computer-server==0.3.42` wheel predates the generated Driver backend even though the current source package still reports `0.3.42`. The image installs `cua-core==0.3.1` and `cua-auto==0.1.2` from that same checked-out source rather than relying on their independently published wheels. These local dependencies are explicitly installed non-editably, and the compatibility patch replaces the upstream workspace/editable source declarations, so the runtime does not retain links into the temporary source checkout. After removing that checkout, the image imports `cua_core.telemetry` and the complete computer-server application with a headless input backend, so a missing or source-linked runtime dependency fails the snapshot build instead of failing when the sandbox starts. On amd64 the snapshot installs `cua-driver==0.19.3` and applies the checked `cua-computer-server-agent-cursor.patch` compatibility patch before installing computer-server. The patch exposes the typed Driver cursor commands, adapts the pinned computer-server handler to the newer typed inputs, and keeps desktop pointer delivery synchronized with CUA's official software-rendered cursor overlay. Other architectures use CUA's native Linux handler because the Driver's Linux release used by AutoPR remains amd64-only.

The image builds `dev.autopr.cursor.neon` from `cursor-theme/build_theme.py` with the matching, checksummed CUA 0.19.3 authoring sidecar. The compiled artifact is installed into CUA's normal per-user theme store; the compiler and source archive are removed after the build. The theme retains CUA's twelve semantic animations and native renderer while using a violet pointer, cyan action marks, white outline, and soft neon glow chosen for recording contrast.

`autopr-cua-computer-server` starts the service lazily on port `8765`. On amd64 it first supervises a private `cua-driver serve` process and connects computer-server to its explicit Unix socket in daemon mode. This launch-time ownership matters: CUA 0.19.3's generated embedded SDK starts with its cursor disabled, while Linux creates the X11 overlay UI thread only when the runtime starts enabled. A later setter can update embedded state without creating that missing UI owner. The daemon is CUA's documented overlay-owning host and starts with `dev.autopr.cursor.neon`, full animation, and the recording timing flags already active.

Readiness requires the expected package version, command manifest (including the cursor commands and AutoPR's painted-overlay probe), the live Driver socket, and a successful display-size call. The session uses the short public label `AutoPR` and applies the complete recording motion profile once per live session. The profile uses 480 ms curved glides, a visible spring landing, no idle auto-hide, and bounded post-action dwell. Move waits for its visible glide before returning, drag glides to its starting point before press/track/release, and click, drag, scroll, text, and key actions retain enough time for their semantic cue to appear before a following action or evidence screenshot can preempt it. Initialization is accepted only after an overlay-only move and an X11 Shape query prove that `Cua.AgentCursorOverlay.*` is both mapped and has painted pixels. Restart recovery compares the reported runtime mode, painted state, theme, reduced-motion mode, and every motion field before reinitializing; diagnostics expose the active motion, visual state, and overlay window evidence.

The X11 overlay is a click-through, top-level software-composited window on Daytona's desktop, so Daytona's unchanged X11 screen recorder captures it together with the rest of the display. Daytona's recorder can also obtain the hardware cursor through XFixes instead of desktop pixels, so the image configures a fully transparent system Xcursor while preserving its coordinates and input delivery; only CUA supplies visible cursor pixels. If Driver initialization fails on amd64, the launcher stops its private daemon and falls back to CUA's native X11 handler so computer use and Daytona recordings remain available; status diagnostics then explicitly report that the agent cursor is unavailable. It binds inside the VM so AutoPR can access it through a short-lived Daytona signed preview URL; the signed URL is never included in model output or persisted tool metadata. Daytona remains responsible for bringing up Xvfb/XFCE/noVNC and for start/stop/download of screen recordings.

The agent runtime probes CUA's status, version, and required command manifest before every interaction sequence. Existing sandboxes created from an older snapshot get a one-time user-local installation fallback; rebuilding this snapshot remains the preferred deployment because it removes that cold start.

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

The Daytona CLI automatically includes files referenced by `COPY` and `ADD` in the Dockerfile. If you want to override the base image, update the `DAYTONA_BASE_IMAGE` default at the top of the Dockerfile before running the snapshot command.

You can verify the snapshot exists with:

```bash
daytona snapshot list
```

## Verification

After creating a sandbox from the `autopr-cua` snapshot and cloning a repo into `/home/<repository-name>`, run:

```bash
REPO_DIR=/home/<repository-name>
echo "$SHELL"
zsh --version
starship --version
tmux -V
alias work
test -f /home/daytona/.tmux.conf
test -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
test -f /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
for executable in rg fd fdfind fzf bat batcat delta gh lsof nc dig ps pstree sqlite3 ttyd; do
  command -v "$executable"
done
/opt/autopr/cua/bin/python -c 'import cua_auto, cua_core; from cua_core.telemetry import record_event; import computer_server'
PYNPUT_BACKEND=dummy /opt/autopr/cua/bin/python -c 'import computer_server.main'
if [ "$(uname -m)" = "x86_64" ]; then /opt/autopr/cua/bin/python -c 'from cua_driver import CuaDriver, GetAgentCursorStateInput, SetAgentCursorEnabledInput, SetAgentCursorMotionInput, SetAgentCursorThemeInput; from computer_server.handlers.cua_driver import CuaDriverAutomationHandler; assert all(hasattr(CuaDriverAutomationHandler, name) for name in ("get_agent_cursor_state", "set_agent_cursor_enabled", "set_agent_cursor_motion", "set_agent_cursor_theme", "probe_agent_cursor"))'; fi
if [ "$(uname -m)" = "x86_64" ]; then test -r /home/daytona/.local/share/cua-driver/cursor-themes/dev.autopr.cursor.neon.cua-theme; fi
test -s /usr/share/icons/AutoPRHidden/cursors/left_ptr
rg --fixed-strings 'xsetroot -xcf /usr/share/icons/AutoPRHidden/cursors/left_ptr' /opt/autopr/desktop/autopr-desktop-session
/opt/autopr/cua/bin/cua-computer-server --help >/dev/null
command -v autopr-cua-computer-server
CUA_PORT=8765 DISPLAY=:1 autopr-cua-computer-server
curl --fail --silent http://127.0.0.1:8765/status | jq -e '.status == "ok" and .os_type == "linux"'
curl --fail --silent http://127.0.0.1:8765/commands | jq -e '.commands.screenshot and .commands.left_click and .commands.type_text and (.commands.get_desktop_state == null or (.commands.set_agent_cursor_enabled and .commands.set_agent_cursor_motion and .commands.set_agent_cursor_theme and .commands.get_agent_cursor_state and .commands.probe_agent_cursor))'
if [ "$(uname -m)" = "x86_64" ]; then curl --fail --silent -H 'Content-Type: application/json' --data '{"command":"probe_agent_cursor"}' http://127.0.0.1:8765/cmd | sed -n 's/^data: //p' | jq -e '.success and .runtime_mode == "daemon" and .enabled and .render_ready and .overlay.mapped and .overlay.painted'; fi
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
echo "$BROWSER"
grep -R "Name=Google Chrome" /usr/share/applications/google-chrome.desktop /usr/share/xfce4/helpers/google-chrome.desktop
grep -R "NoDisplay=true" /usr/share/applications/exo-web-browser.desktop /usr/share/applications/chromium.desktop 2>/dev/null
grep -R 'XDG_DOCUMENTS_DIR="$HOME"' /home/daytona/.config/user-dirs.dirs
test "$XCURSOR_THEME" = AutoPRHidden
stat -c "%a %U %G" /opt/google/chrome/chrome-sandbox
test -f /usr/share/backgrounds/autopr/wallpaper.png
test -x /usr/bin/startxfce4.autopr-original
test -f /home/daytona/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml
fish --version
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
