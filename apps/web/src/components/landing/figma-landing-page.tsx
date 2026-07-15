import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CircleDot,
  Code2,
  GitBranch,
  Github,
  Image,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";

import { CodexLogo } from "#/components/icons/codex-logo";
import { ModeToggle } from "#/components/mode-toggle";

const signInHref = "/api/auth/sign-in?returnTo=%2Fdashboard";

const workflow = [
  {
    label: "Connect",
    title: "Your repo, ready in seconds.",
    copy: "Choose a GitHub repository and branch. AutoPR creates an isolated Daytona workspace with the full project context.",
    icon: Github,
  },
  {
    label: "Delegate",
    title: "Describe the change. Stay in control.",
    copy: "Start a Codex thread in plain language, attach visual context, and watch the agent inspect, edit, and validate the code.",
    icon: MessageSquareText,
  },
  {
    label: "Ship",
    title: "Review the work, not the busywork.",
    copy: "See every changed file, inspect the diff, and open a pull request without losing the conversation behind it.",
    icon: GitBranch,
  },
] as const;

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="#top" className="flex items-center gap-2.5" aria-label="AutoPR home">
      <span className="flex size-7 items-center justify-center rounded-[7px] bg-[var(--landing-v2-ink)]">
        <img
          src="/images/landing/autopr-mark.png"
          alt=""
          aria-hidden="true"
          className="size-5 object-contain invert dark:invert-0"
        />
      </span>
      <span className={cn("font-display font-semibold tracking-[-0.045em]", compact ? "text-base" : "text-lg")}>
        AutoPR
      </span>
    </a>
  );
}

function HeroMascot() {
  return (
    <div className="landing-v2-mascot" aria-hidden="true">
      <img src="/images/landing/mascot-spark.svg" alt="" className="absolute left-0 top-0 h-[35.47%] w-[42.71%]" />
      <img src="/images/landing/mascot-body.svg" alt="" className="absolute left-[15.08%] top-[11.11%] h-[88.89%] w-[84.92%]" />
      <img src="/images/landing/mascot-leg-right.svg" alt="" className="absolute left-[38.44%] top-[55.68%] h-[18.89%] w-[15.23%]" />
      <img src="/images/landing/mascot-leg-left.svg" alt="" className="absolute left-[63.47%] top-[55.68%] h-[18.89%] w-[15.23%]" />
    </div>
  );
}

function AgentWorkspace() {
  return (
    <div className="landing-workspace landing-hero-workspace" aria-label="Preview of the AutoPR chat workspace">
      <div className="landing-chat-appbar">
        <div className="flex items-center gap-2.5">
          <PanelLeft className="size-3.5 text-[var(--landing-v2-muted)]" aria-hidden="true" />
          <span className="font-display text-[11px] font-semibold tracking-[-0.03em]">AUTOPR</span>
        </div>
        <button type="button" className="landing-chat-commit"><GitBranch className="size-3" /> Commit <ChevronDown className="size-3" /></button>
      </div>

      <div className="grid min-h-[650px] grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="landing-chat-sidebar hidden md:flex">
          <div className="shrink-0 space-y-1 px-3 pb-3 pt-4">
            <div className="landing-chat-sidebar-action text-[var(--landing-v2-muted)]">
              <Search className="size-3.5" aria-hidden="true" /><span>Search threads</span><kbd className="ml-auto rounded bg-[var(--landing-v2-active)] px-1.5 py-0.5 font-mono text-[8px] opacity-60">⌘K</kbd>
            </div>
            <div className="landing-chat-sidebar-action font-medium">
              <Pencil className="size-3.5 text-[var(--landing-v2-muted)]" aria-hidden="true" /><span>New thread</span><span className="ml-auto font-mono text-[8px] uppercase text-[var(--landing-v2-faint)]">AutoPR</span>
            </div>
          </div>

          <div className="landing-chat-projects">
            <div className="landing-chat-project"><span className="grid size-5 place-items-center rounded bg-sky-500 text-[8px] font-semibold text-white">DS</span><span>deskcloud</span></div>
            <div className="landing-chat-project is-active"><span className="grid size-5 place-items-center rounded bg-violet-600 text-[8px] font-semibold text-white">AP</span><span>autopr</span></div>
            <div className="grid size-8 shrink-0 place-items-center rounded border border-dashed border-[var(--landing-v2-line-strong)] text-[var(--landing-v2-muted)]"><Plus className="size-3" /></div>
          </div>

          <div className="flex h-10 shrink-0 items-center px-3 font-mono text-[8px] uppercase tracking-[0.15em] text-[var(--landing-v2-faint)]">
            AutoPR threads <span className="ml-auto tabular-nums">12</span><Trash2 className="ml-2 size-3" />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-hidden px-2 pt-1">
            {[
              ["Improve landing page hierarchy", "now", true],
              ["Review authentication flow", "1d", false],
              ["Fix mobile sidebar spacing", "3d", false],
              ["Summarize latest changes", "4d", false],
              ["Add loading states", "5d", false],
              ["Refactor project settings", "5d", false],
            ].map(([title, age, active]) => (
              <div key={title as string} className={cn("landing-chat-thread", active && "is-active")}>
                <span className="landing-chat-thread-title">{title as string}</span>
                <div className="landing-chat-thread-meta">
                  <span className="flex min-w-0 items-center gap-1"><GitBranch className="size-2.5 shrink-0" /><span className="truncate">main</span></span>
                  {active ? (
                    <span className="flex shrink-0 items-center gap-1 text-[var(--landing-v2-blue)]">
                      <span className="size-1.5 rounded-full bg-current" /> Live
                    </span>
                  ) : (
                    <span className="shrink-0">{age as string}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex h-12 shrink-0 items-center border-t border-[var(--landing-v2-line)] px-3 text-[10px] text-[var(--landing-v2-muted)]">
            <Settings className="mr-2 size-3.5" />Settings<Moon className="ml-auto size-3.5" /><span className="ml-3 size-5 rounded-full bg-gradient-to-br from-amber-200 via-orange-400 to-violet-700" />
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-col bg-[var(--landing-v2-panel)]">
          <div className="landing-chat-conversation mx-auto w-full max-w-[700px] flex-1 px-5 pb-40 pt-7 sm:px-9 sm:pt-10">
            <div className="ml-auto w-fit max-w-[80%] rounded-full bg-[var(--landing-v2-user)] px-4 py-2.5 text-[11px]">Make the landing page feel like the actual product.</div>

            <div className="mt-12 text-[11px] leading-[1.65]">
              <div className="mb-3 flex items-center gap-2 font-mono text-[9px] text-[var(--landing-v2-faint)]"><ChevronDown className="size-3" /> Worked for 28s <span>·</span> 31.4k tokens</div>
              <p>I’ll inspect the current interface and align the landing page with the real AutoPR workspace.</p>
              <p className="mt-2">The preview now mirrors the product’s core structure:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li><strong>Workspace sidebar:</strong> project tabs, searchable threads, branch context, and settings.</li>
                <li><strong>Focused conversation:</strong> a calm reading column with visible run metadata.</li>
                <li><strong>Persistent composer:</strong> model controls and follow-up actions stay within reach.</li>
              </ul>
            </div>

            <div className="mt-9 ml-auto w-fit rounded-full bg-[var(--landing-v2-user)] px-4 py-2.5 text-[11px]">Keep it minimal and accurate.</div>
            <div className="mt-10 text-[11px] leading-[1.65]">
              <div className="mb-3 flex items-center gap-2 font-mono text-[9px] text-[var(--landing-v2-faint)]"><ChevronDown className="size-3" /> Worked for 7s <span>·</span> 11.2k tokens</div>
              <p><strong>Done.</strong> The marketing surface now feels like the same product developers use after signing in.</p>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--landing-v2-panel)] via-[var(--landing-v2-panel)] to-transparent px-4 pb-5 pt-16 sm:px-8">
            <button type="button" className="landing-chat-scroll-latest" aria-label="Scroll to latest message"><ArrowDown className="size-3" /></button>
            <div className="landing-chat-composer mx-auto max-w-[700px]">
              <p className="px-3.5 pb-7 pt-3 text-[10px] text-[var(--landing-v2-faint)]">Add a follow up…</p>
              <div className="flex items-center gap-2 px-2.5 pb-2.5">
                <CodexLogo className="size-3.5 text-[var(--landing-v2-muted)]" />
                <span className="text-[9px] font-medium">GPT-5.6</span><ChevronDown className="size-3 text-[var(--landing-v2-muted)]" />
                <button type="button" className="grid size-6 place-items-center rounded-full bg-[var(--landing-v2-active)]" aria-label="More options"><MoreHorizontal className="size-3" /></button>
                <Image className="size-3 text-[var(--landing-v2-muted)]" aria-hidden="true" />
                <span className="ml-auto size-3 rounded-full border-2 border-[var(--landing-v2-line-strong)] border-t-[var(--landing-v2-blue)]" />
                <button type="button" className="grid size-7 place-items-center rounded-full bg-[var(--landing-v2-ink)] text-[var(--landing-v2-bg)]" aria-label="Send message"><ArrowUp className="size-3" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="landing-v2-header">
      <div className="mx-auto w-full max-w-[1440px] px-3 pt-3 sm:px-6 lg:px-9">
        <div className="landing-v2-header-shell">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-1.5">
            <ModeToggle className="size-8 bg-transparent text-[var(--landing-v2-muted)] hover:bg-[var(--landing-v2-active)] hover:text-[var(--landing-v2-ink)]" />
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="landing-v2-sign-in hidden sm:inline-flex">Sign in</a>
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="landing-button landing-button-primary h-8 pl-3.5 pr-2.5"><span className="hidden sm:inline">Start building</span><span className="sm:hidden">Start</span><span className="flex size-5 items-center justify-center rounded-full bg-[var(--landing-v2-bg)] text-[var(--landing-v2-ink)]"><ArrowRight className="size-3" /></span></a>
          </div>
        </div>
      </div>
    </header>
  );
}

export function FigmaLandingPage() {
  return (
    <div id="top" className="landing-page landing-v2 min-h-full w-full overflow-x-clip">
      <Header />

      <main>
        <section className="landing-v2-hero">
          <div className="landing-v2-grid" aria-hidden="true" />
          <div className="relative mx-auto w-full max-w-[1440px] px-5 pb-16 pt-32 sm:px-8 sm:pt-36 lg:px-12 lg:pb-24 lg:pt-40">
            <div className="relative mx-auto max-w-4xl text-center">
              <HeroMascot />
              <h1 className="landing-hero-in-delayed text-balance font-display text-[clamp(3.1rem,8vw,7.4rem)] font-medium leading-[0.88] tracking-[-0.065em]">
                Turn tasks into<br /><span className="landing-v2-outline-text">pull requests.</span>
              </h1>
              <p className="landing-hero-in-late mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-[var(--landing-v2-muted)] sm:text-lg">
                AutoPR gives every GitHub repo an autonomous coding agent—inside a secure workspace you can guide, inspect, and ship from.
              </p>
              <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--landing-v2-faint)]">Bring your Codex subscription · Isolated Daytona runtime</p>
            </div>

            <div id="workspace" className="relative mx-auto mt-14 max-w-[1180px] scroll-mt-24 sm:mt-20">
              <div className="landing-workspace-glow" aria-hidden="true" />
              <AgentWorkspace />
            </div>
          </div>
        </section>

        <section id="workflow" className="border-t border-[var(--landing-v2-line)] scroll-mt-20">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
              <div className="lg:sticky lg:top-28 lg:self-start">
                <p className="landing-kicker">One continuous workflow</p>
                <h2 className="mt-5 max-w-lg font-display text-4xl font-medium leading-[0.98] tracking-[-0.05em] sm:text-5xl lg:text-6xl">From “can we fix this?” to ready for review.</h2>
                <p className="mt-6 max-w-md text-sm leading-6 text-[var(--landing-v2-muted)] sm:text-base">No context switching between a chatbot, terminal, diff viewer, and GitHub. The whole trail stays attached to the work.</p>
              </div>
              <div className="border-t border-[var(--landing-v2-line)]">
                {workflow.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.label} className="group grid gap-5 border-b border-[var(--landing-v2-line)] py-9 sm:grid-cols-[72px_1fr] sm:py-12">
                      <div className="flex items-center gap-3 sm:block">
                        <span className="font-mono text-[10px] text-[var(--landing-v2-faint)]">0{index + 1}</span>
                        <span className="mt-4 hidden size-10 items-center justify-center rounded-lg border border-[var(--landing-v2-line)] bg-[var(--landing-v2-subtle)] transition-transform duration-300 group-hover:-translate-y-1 sm:flex">
                          <Icon className="size-4 text-[var(--landing-v2-blue)]" aria-hidden="true" />
                        </span>
                      </div>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--landing-v2-blue)]">{item.label}</p>
                        <h3 className="mt-3 font-display text-2xl font-medium tracking-[-0.035em] sm:text-3xl">{item.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--landing-v2-muted)] sm:text-base">{item.copy}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="security" className="border-t border-[var(--landing-v2-line)] bg-[var(--landing-v2-ink)] text-[var(--landing-v2-bg)] scroll-mt-20">
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-12 lg:py-28">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--landing-v2-blue)]">Built for real repositories</p>
              <h2 className="mt-5 max-w-2xl font-display text-4xl font-medium leading-[0.98] tracking-[-0.05em] sm:text-5xl lg:text-6xl">Autonomy with an audit trail.</h2>
              <p className="mt-6 max-w-xl text-sm leading-6 opacity-60 sm:text-base">The agent works in a disposable sandbox, shows its terminal activity, and leaves every decision attached to the thread. You decide what ships.</p>
            </div>
            <div className="grid content-end gap-px overflow-hidden rounded-xl border border-white/15 bg-white/15">
              {[
                [ShieldCheck, "Isolated execution", "Every project runs away from your local machine."],
                [Terminal, "Visible runtime", "Follow commands and validation as they happen."],
                [Code2, "Review-first shipping", "Inspect every changed line before opening the PR."],
              ].map(([Icon, title, copy]) => (
                <div key={title as string} className="grid grid-cols-[32px_1fr] gap-3 bg-[var(--landing-v2-ink)] p-5 sm:p-6">
                  <Icon className="mt-0.5 size-4 text-[var(--landing-v2-blue)]" aria-hidden="true" />
                  <div><h3 className="text-sm font-medium">{title as string}</h3><p className="mt-1.5 text-xs leading-5 opacity-55">{copy as string}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-b border-[var(--landing-v2-line)]">
          <div className="landing-v2-grid opacity-50" aria-hidden="true" />
          <div className="relative mx-auto flex max-w-[1440px] flex-col items-center px-5 py-24 text-center sm:px-8 lg:px-12 lg:py-32">
            <CircleDot className="size-5 text-[var(--landing-v2-blue)]" aria-hidden="true" />
            <h2 className="mt-7 max-w-4xl text-balance font-display text-4xl font-medium leading-[0.95] tracking-[-0.055em] sm:text-6xl lg:text-7xl">Your next pull request can start with one sentence.</h2>
            <p className="mt-6 max-w-xl text-sm leading-6 text-[var(--landing-v2-muted)] sm:text-base">Connect a repository, describe the outcome, and keep your team focused on the decisions that matter.</p>
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="landing-button landing-button-primary mt-8 h-11 px-5 text-sm">Start building free <ArrowRight className="size-4" /></a>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1440px] flex-col gap-7 px-5 py-9 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <Logo compact />
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--landing-v2-faint)]">© 2026 AutoPR · Built for developers who would rather be building.</p>
        <div className="flex items-center gap-5 text-xs text-[var(--landing-v2-muted)]"><a href="#workflow">Workflow</a><a href="#security">Security</a><a href="/dashboard">Open app</a></div>
      </footer>
    </div>
  );
}
