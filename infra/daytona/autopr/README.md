# AutoPR Daytona Snapshot

This snapshot extends the Daytona sandbox image with the FFF runtime used by AutoPR search tools, the zsh/starship terminal profile used by the hosted Daytona web terminal and AutoPR's embedded PTY terminal, and the desktop customization used by AutoPR's Daytona computer-use preview.

Create a Daytona snapshot named `autopr` from this Dockerfile, then AutoPR will use it by default. The application still honors `DAYTONA_SNAPSHOT` when you need to override the default.

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

AutoPR does not rewrite or sync these terminal files at runtime. Update the files in this directory and rebuild the `autopr` snapshot when the terminal profile needs to change.

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

The snapshot keeps Daytona's existing XFCE, x11vnc, noVNC, Xvfb, recording, and computer-use support intact. The customization layer only adds and configures:

- Google Chrome Stable, installed from Google's Linux apt repository on amd64 builders.
- Chrome-compatible wrappers in `/opt/autopr/bin` so AutoPR's browser open path prefers Chrome even when it asks for `chromium`.
- XFCE application launchers and preferred-browser helpers that show one `Google Chrome` menu entry and hide the base Chromium/x11vnc launchers.
- Chrome launches without `--no-sandbox`; the snapshot preserves Chrome's own setuid sandbox permissions instead of forcing the unsupported flag.
- A minimal XFCE profile under `/home/daytona/.config/xfce4`.
- XDG user-dir config that collapses Documents, Pictures, Music, Videos, Downloads, Templates, Public, and Desktop into the home folder instead of creating separate visible folders.
- A desktop startup hook that reapplies the wallpaper whenever Daytona starts XFCE.
- A clean wallpaper installed at `/usr/share/backgrounds/autopr/wallpaper.png`.
- The stock Adwaita/XFCE cursor, kept at a normal 24px size.
- A fixed `1920x1080` noVNC desktop, matching Daytona's computer-use `VNC_RESOLUTION` path, that AutoPR scales inside the desktop panel without resizing the sandbox display.
- Dev/desktop utilities for a more complete workstation feel: fish, htop, jq, tmux, tree, xterm, git-lfs, zip/unzip, vim, nano, and the developer and diagnostic tools listed above.

The desktop setup files live under `desktop/`. Update those files and rebuild the `autopr` snapshot when you want to change the visible desktop.

## Build

From the AutoPR repo root:

```bash
daytona snapshot create autopr \
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

After creating a sandbox from the `autopr` snapshot and cloning a repo into `/home/<repository-name>`, run:

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
echo "$XCURSOR_THEME"
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

The CLI is both the smoke-test surface and the harness boundary. AutoPR's `find` and `grep` tools call `autopr-fff` inside Daytona and parse its JSON output, which keeps fff indexing the sandbox checkout instead of the host app checkout. File discovery and content search should stay on this FFF path: do not add ripgrep, grep, or shell-search fallback behavior to the agent tools. A persistent daemon can still be added later if we want one warm fff index across repeated tool calls.

When a response includes `nextCursor`, pass that value back with the same command to continue pagination. Cursors are encoded in the token itself, so they work across separate `autopr-fff` processes.

## Agent command lifecycle

Foreground `bash` commands use disposable Daytona sessions and are cleaned up after completion or timeout. Long-running commands use `isBackground: true`; the harness keeps their `autopr-*` session alive and returns both the session ID and command ID.

The agent's `process` tool owns the rest of that lifecycle:

- `list` discovers only harness-created `autopr-*` sessions, leaving user terminal sessions private.
- `poll` returns current logs, status, and exit code with the same bounded-output policy as foreground commands.
- `input` sends stdin to an interactive background command.
- `terminate` stops and removes a background session when it is no longer needed.

Agents should poll only when output or completion is expected and must terminate temporary servers and watchers after validation. Repeated identical failures or unchanged polls are detected by the step controller, which forces a tool-free status response instead of spending the remaining step budget in a loop.
