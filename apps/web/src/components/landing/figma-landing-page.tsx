import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
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

function Logo() {
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
      <span className="font-display text-lg font-semibold tracking-[-0.045em]">
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
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="landing-workflow-heading">
              <div>
                <p className="landing-kicker">One continuous workflow</p>
                <h2 className="mt-5 max-w-3xl font-display text-4xl font-medium leading-[0.96] tracking-[-0.05em] sm:text-5xl lg:text-6xl">From “can we fix this?” to ready for review.</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[var(--landing-v2-muted)] sm:text-base">Start with a repo and one sentence. The branch, agent context, diff, and pull request stay on the same trail.</p>
            </div>

            <div className="landing-workflow-track">
              <div className="landing-workflow-lane landing-workflow-lane-main"><GitBranch className="size-3.5" aria-hidden="true" /> main</div>
              <div className="landing-workflow-lane landing-workflow-lane-result"><span className="size-1.5 rounded-full bg-[var(--landing-v2-blue)]" /> pull request ready</div>
              <svg className="landing-workflow-graph" viewBox="0 0 1200 112" preserveAspectRatio="none" aria-hidden="true">
                <path className="landing-workflow-mainline" d="M0 24 H1200" />
                <path className="landing-workflow-branchline" d="M72 24 C132 24 132 88 200 88 H1000 C1068 88 1068 24 1128 24" />
              </svg>

              <div className="landing-workflow-steps">
                {workflow.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.label} className="landing-workflow-stage group">
                      <span className="landing-workflow-node"><Icon className="size-4" aria-hidden="true" /></span>
                      <p className="font-mono text-[9px] text-[var(--landing-v2-faint)]">0{index + 1}</p>
                      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--landing-v2-blue)]">{item.label}</p>
                      <h3 className="mt-3 max-w-sm font-display text-2xl font-medium leading-tight tracking-[-0.035em]">{item.title}</h3>
                      <p className="mt-3 max-w-sm text-sm leading-6 text-[var(--landing-v2-muted)]">{item.copy}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-cta-mesh relative isolate overflow-hidden border-b border-[var(--landing-v2-line)]">
          <div className="landing-cta-mesh-grid" aria-hidden="true" />
          <div className="relative z-10 mx-auto flex max-w-[1440px] flex-col items-center px-5 py-24 text-center sm:px-8 sm:py-28 lg:px-12 lg:py-36">
            <h2 className="max-w-5xl text-balance font-display text-[clamp(2.7rem,7vw,6.75rem)] font-medium leading-[0.88] tracking-[-0.065em]">
              Your next pull request<br />
              <span className="landing-cta-outline">can start with one sentence.</span>
            </h2>
            <p className="landing-cta-copy mt-7 max-w-xl text-sm leading-6 sm:text-base">Connect a repository, describe the outcome, and keep your team focused on the decisions that matter.</p>
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="landing-button landing-cta-button mt-9 h-11 px-5 text-sm">Start building free <ArrowRight className="size-4" /></a>
          </div>
        </section>
      </main>

    </div>
  );
}
