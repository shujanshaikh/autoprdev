# AutoPR Daytona Snapshot

This snapshot extends the Daytona sandbox image with the FFF runtime used by AutoPR search tools.

Create a Daytona snapshot named `autopr` from this Dockerfile, then AutoPR will use it by default. The application still honors `DAYTONA_SNAPSHOT` when you need to override the default.

## Base Image

The Dockerfile defaults to:

```text
daytonaio/sandbox:0.8.0
```

If your current `daytona-large` snapshot is backed by a different Daytona sandbox image or digest, pass it as `DAYTONA_BASE_IMAGE` when creating the snapshot.

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
autopr-fff health --cwd /home/daytona/repo
autopr-fff find --cwd /home/daytona/repo --query thread --limit 10
autopr-fff find --cwd /home/daytona/repo --path "src/**/*.ts" --query thread --exclude "test/,node_modules/" --limit 10
autopr-fff grep --cwd /home/daytona/repo --path src/ --pattern createDaytonaTools --limit 10
```

The CLI is both the smoke-test surface and the harness boundary. AutoPR's `find` and `grep` tools call `autopr-fff` inside Daytona and parse its JSON output, which keeps fff indexing the sandbox checkout instead of the host app checkout. File discovery and content search should stay on this FFF path: do not add ripgrep, grep, or shell-search fallback behavior to the agent tools. A persistent daemon can still be added later if we want one warm fff index across repeated tool calls.

When a response includes `nextCursor`, pass that value back with the same command to continue pagination. Cursors are encoded in the token itself, so they work across separate `autopr-fff` processes.
