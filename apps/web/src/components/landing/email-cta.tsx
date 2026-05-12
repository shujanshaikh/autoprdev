"use client";

export function EmailCta() {
  return (
    <form
      action="/"
      className="mx-auto mt-10 flex max-w-lg flex-col gap-3 sm:flex-row sm:items-stretch"
      method="get"
    >
      <label htmlFor="email-cta" className="sr-only">
        Work email
      </label>
      <input
        id="email-cta"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        className="min-h-11 flex-1 border border-border bg-background px-4 font-mono text-sm shadow-inner outline-none ring-offset-background placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25"
      />
      <button
        type="submit"
        className="min-h-11 shrink-0 bg-primary px-6 font-mono text-sm font-semibold text-primary-foreground shadow-md transition hover:brightness-105 active:scale-[0.99]"
      >
        Get early access
      </button>
    </form>
  );
}
