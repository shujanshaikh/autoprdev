# AutoPR E2B template

This template uses E2B's current TypeScript `Template` builder and layers E2B
lifecycle scripts over the existing `infra/daytona/autopr` image definition.
That keeps Chrome, XFCE, noVNC, FFF, ttyd, and the CUA Driver gateway identical
across providers. It does not use E2B Desktop or E2B computer-use APIs.

The template renames the inherited login user to `e2b`, so desktop terminal
prompts no longer mix Daytona and E2B names. Daytona images keep the `daytona`
login, while E2B uses `/home/autopr` as its home and workspace root.

E2B does not issue Daytona-style signed service URLs. The template exposes an
E2B-only preview gateway on port 6090 instead. AutoPR signs the target port and
expiry with a sandbox-local secret; noVNC, ttyd, and CUA bind to loopback behind
that gateway so their bare E2B hosts are not public entry points.

Set `E2B_API_KEY`, then build the template from the repository root:

```sh
pnpm build:e2b-template
```

The runtime defaults to the `autopr` template alias. Override it with
`E2B_TEMPLATE`. The default template allocates 8 vCPUs and 8,192 MB of memory
to each E2B sandbox.
