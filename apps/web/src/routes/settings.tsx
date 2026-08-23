import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({
        to: "/settings/$section",
        params: { section: "overview" },
        replace: true,
      });
    }
  },
});
