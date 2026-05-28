import "@radix-ui/themes/styles.css";
import "@workos-inc/widgets/styles.css";

import { Button } from "@autopr/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { Pipes, WorkOsWidgets } from "@workos-inc/widgets";
import { ArrowLeft, Check, GitBranch, Github, Loader2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/github-connect")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : "/dashboard",
  }),
  component: GithubConnect,
});

function GithubConnect() {
  const { returnTo } = Route.useSearch();
  const { loading, organizationId, user } = useAuth();
  const widgetTokenQuery = useQuery({
    queryKey: ["workos", "widgets", "pipes-token"],
    enabled: Boolean(user),
    retry: false,
    queryFn: getPipesWidgetToken,
  });

  if (loading) {
    return (
      <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-svh place-items-center px-5">
        <a
          href={`/api/auth/sign-in?returnTo=${encodeURIComponent("/github-connect")}`}
          className="inline-flex h-10 items-center border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Sign in to connect GitHub
        </a>
      </main>
    );
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(hsl(var(--border)/0.16)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.16)_1px,transparent_1px)] bg-[size:100%_100%,44px_44px,44px_44px]" />
      <div className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center border border-border bg-card">
              <Github className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                autopr / integrations
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">Connect GitHub</h1>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => window.location.assign(returnTo)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
        </header>

        <section className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <div className="max-w-md">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">
                secure repository access
              </p>
              <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Choose the GitHub account AutoPR should use.
              </h2>
            </div>

            <div className="grid max-w-lg gap-2 text-sm text-muted-foreground">
              <IntegrationPoint icon={<GitBranch className="size-4" />} label="Repositories, branches, and pull requests stay tied to this account." />
              <IntegrationPoint icon={<ShieldCheck className="size-4" />} label="Tokens are handled by WorkOS Pipes and can be revoked at any time." />
              <IntegrationPoint icon={<Check className="size-4" />} label="After authorization, you will return to the sandbox flow." />
            </div>
          </div>

          <div className="border border-border bg-card/80 p-3 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="border border-border/70 bg-background">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  provider
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  github
                </span>
              </div>
              <div className="p-3">
                {!organizationId ? (
                  <GithubConnectError
                    message="Your WorkOS session does not include an organization. Create a WorkOS organization, add your user as a member, then sign out and sign in again."
                  />
                ) : widgetTokenQuery.isPending ? (
                  <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    Loading GitHub connection...
                  </div>
                ) : widgetTokenQuery.isError ? (
                  <GithubConnectError
                    message={
                      widgetTokenQuery.error instanceof Error
                        ? widgetTokenQuery.error.message
                        : "Could not load the WorkOS Pipes widget."
                    }
                  />
                ) : (
                  <div className="github-pipes-frame">
                    <WorkOsWidgets>
                      <Pipes authToken={widgetTokenQuery.data} />
                    </WorkOsWidgets>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

async function getPipesWidgetToken() {
  const response = await fetch("/api/workos/widgets/pipes-token");
  const body = (await response.json().catch(() => undefined)) as { token?: string; error?: string } | undefined;

  if (!response.ok || !body?.token) {
    throw new Error(body?.error ?? "Could not create a WorkOS widget token.");
  }

  return body.token;
}

function GithubConnectError({ message }: { message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-xs leading-6 text-destructive">
      {message}
    </div>
  );
}

function IntegrationPoint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-start gap-3 border border-border/70 bg-card/50 px-3 py-2.5">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="leading-6">{label}</span>
    </div>
  );
}
