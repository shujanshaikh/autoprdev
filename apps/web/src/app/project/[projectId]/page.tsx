"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Bot,
  Filter,
  GitBranch,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Sliders,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthGate, ProjectShell } from "@/components/project-shell";

/* ─── Aurora Canvas ───────────────────────────────────────────────── */

function AuroraCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
      hue: number;
    }> = [];

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx!.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function initParticles() {
      if (!canvas) return;
      particles = [];
      const count = Math.min(140, Math.floor((canvas.offsetWidth * canvas.offsetHeight) / 4000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.offsetWidth,
          y: Math.random() * canvas.offsetHeight * 0.7,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.12 - 0.04,
          size: Math.random() * 2 + 0.3,
          opacity: Math.random() * 0.4 + 0.08,
          hue: 20 + Math.random() * 30,
        });
      }
    }

    let time = 0;
    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      ctx.clearRect(0, 0, w, h);
      time += 0.003;

      // Subtle aurora glow — using primary hue range (warm red/orange ~27°)
      const g1 = ctx.createRadialGradient(w * 0.35, h * 0.25, 0, w * 0.35, h * 0.25, w * 0.45);
      g1.addColorStop(0, `hsla(${27 + Math.sin(time) * 8}, 55%, 42%, 0.06)`);
      g1.addColorStop(0.6, `hsla(${30 + Math.sin(time * 1.2) * 6}, 45%, 32%, 0.03)`);
      g1.addColorStop(1, "transparent");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      const g2 = ctx.createRadialGradient(w * 0.68, h * 0.18, 0, w * 0.68, h * 0.18, w * 0.38);
      g2.addColorStop(0, `hsla(${245 + Math.cos(time * 0.8) * 10}, 50%, 38%, 0.05)`);
      g2.addColorStop(0.5, `hsla(${240 + Math.cos(time) * 5}, 40%, 28%, 0.025)`);
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      // Particles
      for (const p of particles) {
        p.x += p.vx + Math.sin(time * 2 + p.y * 0.01) * 0.08;
        p.y += p.vy + Math.cos(time * 1.5 + p.x * 0.008) * 0.04;
        p.opacity = 0.12 + Math.sin(time * 3 + p.x * 0.01) * 0.1;

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h * 0.7;
        if (p.y > h * 0.7) p.y = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 55%, 55%, ${p.opacity})`;
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    initParticles();
    draw();

    const handleResize = () => {
      resize();
      initParticles();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-80 dark:opacity-90"
    />
  );
}

/* ─── Quick Action Pill ───────────────────────────────────────────── */

function QuickAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 border border-primary/15 bg-primary/4 px-4 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-primary/35 hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-primary/6"
    >
      {children}
    </button>
  );
}

/* ─── Relative time helper ────────────────────────────────────────── */

function relativeTime(date: number) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ─── Thread Row ──────────────────────────────────────────────────── */

function ThreadRow({
  thread,
  projectId,
}: {
  thread: {
    threadId: string;
    title: string;
    isLive?: boolean;
    updatedAt: number;
  };
  projectId: string;
}) {
  return (
    <Link
      href={`/project/${projectId}/thread/${thread.threadId}`}
      className="grid gap-2 p-4 transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-semibold">{thread.title}</p>
          {thread.isLive ? (
            <span className="border border-primary/25 bg-primary/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              live
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          updated {relativeTime(thread.updatedAt)} ago
        </p>
      </div>
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────── */

export default function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const projectId = params.projectId;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const createThread = useMutation(api.threads.create);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [promptValue, setPromptValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const openThreads = threads?.filter((t) => t.isLive) ?? [];
  const filteredThreads = threads?.filter((t) =>
    searchQuery ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) : true,
  );

  const startThread = useCallback(async () => {
    if (!project || project.sandboxStatus !== "ready") return;
    setIsCreatingThread(true);
    setError(undefined);
    try {
      const threadId = await createThread({ projectId, title: promptValue.trim() || "New thread" });
      router.push(`/project/${projectId}/thread/${threadId}`);
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not create a thread.");
    } finally {
      setIsCreatingThread(false);
    }
  }, [project, projectId, promptValue, createThread, router]);

  const handlePromptSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void startThread();
    },
    [startThread],
  );

  return (
    <AuthGate>
      <ProjectShell
        projectId={projectId}
        repoFullName={project?.repoFullName}
        threads={threads}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Main content area */}
          <div className="minimal-scrollbar relative flex flex-1 flex-col overflow-y-auto">
            {project === undefined || threads === undefined ? (
              <div className="grid min-h-56 flex-1 place-items-center text-sm text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  Loading project
                </div>
              </div>
            ) : !project ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="border border-border p-5 text-sm text-muted-foreground">
                  Project not found.
                </div>
              </div>
            ) : (
              <>
                {/* ── Aurora hero + Prompt ─────────────────────── */}
                <div className="relative flex min-h-[380px] flex-col items-center justify-center px-4 py-10 sm:px-8">
                  {/* Aurora background */}
                  <div className="absolute inset-0 overflow-hidden">
                    <AuroraCanvas />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
                  </div>

                  <div className="relative z-10 w-full max-w-[640px]">
                    {/* Prompt */}
                    <form onSubmit={handlePromptSubmit}>
                      <div className="border border-primary/25 bg-background shadow-[0_18px_70px_rgba(0,0,0,0.16),inset_0_1px_0_0_rgba(var(--primary),0.07)] transition-all focus-within:border-primary/40 focus-within:shadow-[0_18px_70px_rgba(0,0,0,0.16),0_0_40px_rgba(var(--primary),0.06)]">
                        {/* Input */}
                        <div className="px-4 pt-4 pb-2">
                          <textarea
                            value={promptValue}
                            onChange={(e) => setPromptValue(e.target.value)}
                            placeholder={`Ask ${project.repoFullName?.split("/")[1] ?? "the agent"}…`}
                            disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                            rows={1}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void startThread();
                              }
                            }}
                            className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ minHeight: "28px", maxHeight: "120px" }}
                          />
                        </div>

                        {/* Toolbar */}
                        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              <Bot className="size-3 text-primary" aria-hidden="true" />
                              autopr agent
                            </span>
                          </div>
                          <button
                            type="submit"
                            disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                            className="inline-flex min-h-8 items-center justify-center gap-2 border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isCreatingThread ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <ArrowRight className="size-3.5" aria-hidden="true" />
                            )}
                            New thread
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Branch indicator */}
                    <div className="mt-3 flex items-center justify-center">
                      <span className="inline-flex items-center gap-1.5 border border-primary/15 bg-primary/4 px-3 py-1 font-mono text-[10px] text-primary dark:bg-primary/6">
                        <GitBranch className="size-3" aria-hidden="true" />
                        {project.repoBranch ?? "main"}
                      </span>
                    </div>

                    {/* Quick actions */}
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                      <QuickAction
                        onClick={() => {
                          setPromptValue("Summarize latest changes");
                          void startThread();
                        }}
                        disabled={project.sandboxStatus !== "ready"}
                      >
                        Summarize latest changes
                      </QuickAction>
                      <QuickAction
                        onClick={() => {
                          setPromptValue("Review my latest PR");
                          void startThread();
                        }}
                        disabled={project.sandboxStatus !== "ready"}
                      >
                        Review my latest PR
                      </QuickAction>
                      <QuickAction
                        onClick={() => {
                          setPromptValue("Suggest a new feature");
                          void startThread();
                        }}
                        disabled={project.sandboxStatus !== "ready"}
                      >
                        Suggest a new feature…
                      </QuickAction>
                      <QuickAction
                        onClick={() => {
                          setPromptValue("Create a task for");
                          void startThread();
                        }}
                        disabled={project.sandboxStatus !== "ready"}
                      >
                        Create a task for…
                      </QuickAction>
                    </div>
                  </div>
                </div>

                {/* ── Status banners ──────────────────────────── */}
                {project.sandboxStatus === "creating" ? (
                  <div className="mx-auto w-full max-w-[640px] px-4">
                    <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                      <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />
                      Creating the Daytona sandbox and cloning the repository. Threads unlock when the sandbox is ready.
                    </div>
                  </div>
                ) : null}

                {project.sandboxStatus === "failed" ? (
                  <div className="mx-auto w-full max-w-[640px] px-4">
                    <div className="border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
                      <p>{project.sandboxError ?? "Sandbox creation failed."}</p>
                      <Link href="/dashboard" className="mt-3 inline-flex text-foreground underline underline-offset-4">
                        Back to dashboard
                      </Link>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="mx-auto w-full max-w-[640px] px-4 pt-2">
                    <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  </div>
                ) : null}

                {/* ── Threads section ─────────────────────────── */}
                <div className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-12">
                  {/* Search + filters */}
                  <div className="mb-4 flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground transition focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/20">
                      <Search className="size-3.5 shrink-0" aria-hidden="true" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search threads…"
                        className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      />
                    </label>
                    <button
                      type="button"
                      className="grid size-9 place-items-center border border-border text-muted-foreground transition hover:bg-muted/35 hover:text-foreground"
                    >
                      <Sliders className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="grid size-9 place-items-center border border-border text-muted-foreground transition hover:bg-muted/35 hover:text-foreground"
                    >
                      <Filter className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Open threads badge */}
                  {openThreads.length > 0 ? (
                    <div className="mb-3 flex items-center gap-2 px-1">
                      <span className="size-1.5 bg-primary shadow-[0_0_0_3px_rgba(var(--primary),0.18)]" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Open threads
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{openThreads.length}</span>
                    </div>
                  ) : null}

                  {/* New thread button header */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Threads
                    </h2>
                    <button
                      type="button"
                      onClick={() => void startThread()}
                      disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                      className="inline-flex min-h-10 items-center justify-center gap-2 border border-primary/30 bg-primary/10 px-3 text-sm font-semibold text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreatingThread ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <MessageSquarePlus className="size-4" aria-hidden="true" />
                      )}
                      New thread
                    </button>
                  </div>

                  {/* Thread list */}
                  <div className="divide-y divide-border border border-border bg-background">
                    {filteredThreads === undefined ? (
                      <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                        Loading threads
                      </div>
                    ) : filteredThreads.length === 0 ? (
                      <div className="p-5 text-sm text-muted-foreground">
                        {searchQuery ? (
                          <>No threads match &quot;{searchQuery}&quot;</>
                        ) : (
                          "No threads yet."
                        )}
                      </div>
                    ) : (
                      filteredThreads.map((thread) => (
                        <ThreadRow key={thread.threadId} thread={thread} projectId={projectId} />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </ProjectShell>
    </AuthGate>
  );
}
