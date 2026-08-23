# AutoPR E2B template

This template uses E2B's current TypeScript `Template` builder and layers E2B
lifecycle scripts over the existing `infra/daytona/autopr` image definition.
That keeps Chrome, XFCE, noVNC, FFF, ttyd, and the CUA Driver gateway identical
across providers. It does not use E2B Desktop or E2B computer-use APIs.

Set `E2B_API_KEY`, then build the template from the repository root:

```sh
pnpm build:e2b-template
```

The runtime defaults to the `autopr-cua-e2b` template alias. Override it with
`E2B_TEMPLATE`.
