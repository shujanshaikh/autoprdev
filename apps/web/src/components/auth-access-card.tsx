import { ArrowRight } from "lucide-react";

export function AuthAccessCard({ signInHref }: { signInHref: string }) {
  return (
    <main className="sign-in-shell relative flex min-h-svh flex-col overflow-hidden bg-background">
      <div className="sign-in-grid pointer-events-none absolute inset-0 z-0" aria-hidden="true" />

      <div
        className="pointer-events-none absolute left-1/2 top-[40%] z-0 -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
      >
        <div className="size-[520px] rounded-full bg-primary/[0.06] blur-[120px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between border-b border-border px-6 py-3 sm:px-10">
        <span className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
          <span className="inline-block size-1.5 bg-primary" />
          autopr
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/60">
          session · idle
        </span>
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-start justify-center px-8 py-16 sm:px-16 md:px-24 lg:px-32">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
          ↳ access required
        </p>

        <h1 className="mt-5 text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          Sign in to spin up
          <br />
          <span className="text-primary">sandboxes.</span>
        </h1>

        <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base sm:leading-relaxed">
          Persistent Daytona workspaces, wired to your GitHub repos in a
          single four-step flow.
        </p>

        <div className="my-8 h-px w-full max-w-xs bg-border" aria-hidden="true" />

        <a
          id="sign-in-cta"
          href={signInHref}
          className="sign-in-cta inline-flex h-12 items-center gap-3 border border-primary bg-primary px-7 text-sm font-semibold uppercase tracking-[0.18em] text-primary-foreground shadow-[0_0_32px_-8px] shadow-primary/30 transition-colors duration-150 hover:brightness-110 active:scale-[0.98]"
        >
          Continue
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </div>

    </main>
  );
}
