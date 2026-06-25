import { Link } from "@tanstack/react-router";

const footerLinks = [
  { label: "Open app", to: "/dashboard" },
  { label: "Settings", to: "/dashboard" },
  { label: "Billing", to: "/dashboard" },
] as const;

export function LandingFooter() {
  return (
    <footer className="border-t border-[color:var(--landing-line)] bg-[color:var(--landing-paper)] px-5 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <div className="flex flex-wrap items-center gap-6">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--landing-muted)] transition-colors hover:text-[color:var(--landing-ink)]"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
