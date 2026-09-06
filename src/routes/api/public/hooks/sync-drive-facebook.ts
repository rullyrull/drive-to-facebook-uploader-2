import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/sync-drive-facebook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const allowed = [
          process.env["CRON_SHARED_SECRET"],
          process.env["CRON_TRIGGER_TOKEN"],
        ].filter(Boolean);
        const provided = request.headers.get("x-cron-secret");
        if (!provided || !allowed.includes(provided)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const { runSync } = await import("@/lib/sync.server");
          const result = await runSync();
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("Sync gagal", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
