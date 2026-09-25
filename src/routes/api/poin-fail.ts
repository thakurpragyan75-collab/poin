import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/poin-fail")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "upstream exploded" }, { status: 500 }),
    },
  },
});
