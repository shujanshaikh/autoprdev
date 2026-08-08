export const DEFAULT_SANDBOX_DOMAIN_ALLOW_LIST = [
  "github.com",
  "api.github.com",
  "*.githubusercontent.com",
  "registry.npmjs.org",
  "*.npmjs.org",
  "pypi.org",
  "*.pypi.org",
  "*.pythonhosted.org",
  "rubygems.org",
  "*.rubygems.org",
  "proxy.golang.org",
  "sum.golang.org",
  "crates.io",
  "*.crates.io",
  "repo.maven.apache.org",
  "plugins.gradle.org",
  "services.gradle.org",
].join(",");

export function sandboxDomainAllowList(configuredValue?: string) {
  return configuredValue?.trim() || DEFAULT_SANDBOX_DOMAIN_ALLOW_LIST;
}
