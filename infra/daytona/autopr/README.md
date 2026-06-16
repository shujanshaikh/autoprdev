# AutoPR Daytona Snapshot

This snapshot extends the Daytona sandbox image with the FFF runtime used by AutoPR search tools, plus the zsh/starship terminal profile used by the hosted Daytona web terminal and AutoPR's embedded PTY terminal.

Create a Daytona snapshot named `autopr` from this Dockerfile, then AutoPR will use it by default. The application still honors `DAYTONA_SNAPSHOT` when you need to override the default.

## Base Image

The Dockerfile defaults to:

```text
daytonaio/sandbox:0.8.0
```

If your current `daytona-large` snapshot is backed by a different Daytona sandbox image or digest, pass it as `DAYTONA_BASE_IMAGE` when creating the snapshot.

## Terminal Profile

The snapshot installs zsh and Starship, sets the `daytona` user's login shell to zsh, and writes:

```text
/home/daytona/.zshrc
/home/daytona/.config/starship.toml
```

Daytona's web terminal is exposed on port `22222`, and AutoPR's embedded terminal creates Daytona PTY sessions for the same sandbox user. Both paths pick up this shell profile when the sandbox is created from the `autopr` snapshot.

AutoPR does not rewrite or sync these terminal files at runtime. Update the files in this directory and rebuild the `autopr` snapshot when the terminal profile needs to change.

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

After creating a sandbox from the `autopr` snapshot and cloning a repo into `/home/daytona/repo`, run:

```bash
echo "$SHELL"
zsh --version
starship --version
autopr-fff health --cwd /home/daytona/repo
autopr-fff find --cwd /home/daytona/repo --query thread --limit 10
autopr-fff find --cwd /home/daytona/repo --path "src/**/*.ts" --query thread --exclude "test/,node_modules/" --limit 10
autopr-fff grep --cwd /home/daytona/repo --path src/ --pattern createDaytonaTools --limit 10
```

The CLI is both the smoke-test surface and the harness boundary. AutoPR's `find` and `grep` tools call `autopr-fff` inside Daytona and parse its JSON output, which keeps fff indexing the sandbox checkout instead of the host app checkout. File discovery and content search should stay on this FFF path: do not add ripgrep, grep, or shell-search fallback behavior to the agent tools. A persistent daemon can still be added later if we want one warm fff index across repeated tool calls.

When a response includes `nextCursor`, pass that value back with the same command to continue pagination. Cursors are encoded in the token itself, so they work across separate `autopr-fff` processes.
