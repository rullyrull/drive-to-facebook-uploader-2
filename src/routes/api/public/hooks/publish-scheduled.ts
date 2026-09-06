import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/publish-scheduled")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const allowed = [
          process.env["CRON_SHARED_SECRET"],
          process.env["CRON_TRIGGER_TOKEN"],
        ].filter(Boolean);
        const provided = request.headers.get("x-cron-secret");
        if (!provided || !allowed.includes(provided)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const { runSync, publishNext } = await import("@/lib/sync.server");
          // post the due video first, then pick up brand new videos from Drive
          const posted = await publishNext();
          const scan = await runSync();
          return Response.json({ ok: true, scan, posted });
        } catch (error) {
          console.error("Posting terjadwal gagal", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
