import { Outlet, createFileRoute } from "@tanstack/react-router";

function ProjectThreadLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/project/$projectId/thread")({
  component: ProjectThreadLayout,
});
