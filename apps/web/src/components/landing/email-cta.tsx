"use client";

const ACCENT = "rgb(45 212 191)";

export function EmailCta() {
  return (
    <form
      className="mx-auto mt-10 flex max-w-lg flex-col gap-3 sm:flex-row sm:items-stretch"
      onSubmit={(e) => {
        e.preventDefault();
      }}
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
        className="min-h-11 flex-1 border border-border bg-background px-4 font-mono text-sm shadow-inner outline-none ring-offset-background placeholder:text-muted-foreground/70 focus-visible:border-teal-500/50 focus-visible:ring-2 focus-visible:ring-teal-500/25"
      />
      <button
        type="submit"
        className="min-h-11 shrink-0 px-6 font-mono text-sm font-semibold text-teal-950 shadow-md transition hover:brightness-105 active:scale-[0.99] dark:text-teal-950"
        style={{ backgroundColor: ACCENT }}
      >
        Get early access
      </button>
    </form>
  );
}
