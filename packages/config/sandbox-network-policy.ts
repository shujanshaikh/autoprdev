// Daytona treats an empty domain allow-list as unset, which preserves normal
// outbound internet access. Deployments can still opt into a restricted
// sandbox by configuring DAYTONA_DOMAIN_ALLOW_LIST.
export const DEFAULT_SANDBOX_DOMAIN_ALLOW_LIST = "";

export function sandboxDomainAllowList(configuredValue?: string) {
  return configuredValue?.trim() || DEFAULT_SANDBOX_DOMAIN_ALLOW_LIST;
}
