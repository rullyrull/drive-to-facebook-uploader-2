import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { getDashboard, getInsights, publishNextNow, retryJob } from "@/lib/automation.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

const statusQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  refetchInterval: 10000,
});

const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: () => getInsights(),
  refetchInterval: 30000,
});

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Status Posting — Antrian & Hasil Facebook" },
      {
        name: "description",
        content:
          "Lihat video yang sedang mengantri, jadwal posting berikutnya, dan hasil publikasi ke Halaman Facebook.",
      },
      { property: "og:title", content: "Status Posting Video Facebook" },
      {
        property: "og:description",
        content: "Antrian video, jadwal tayang berikutnya, dan hasil publikasi Facebook.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatusPage,
});

const WIB: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function formatWib(value: string | null) {
  if (!value) return "—";
  return `${new Date(value).toLocaleString("id-ID", WIB)} WIB`;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    success: { label: "Sudah tayang", variant: "default" },
    uploading: { label: "Sedang dikirim", variant: "secondary" },
    pending: { label: "Menunggu", variant: "secondary" },
    queued: { label: "Dalam antrian", variant: "secondary" },
    failed: { label: "Gagal", variant: "destructive" },
  };
  const info = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

/** Next upcoming slot from the saved daily times, in Jakarta time. */
function nextSlotLabel(times: string[]) {
  if (!times.length) return "—";
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const minutesNow = wibNow.getUTCHours() * 60 + wibNow.getUTCMinutes();
  const sorted = [...times].sort();
  for (const time of sorted) {
    const [h, m] = time.split(":").map(Number);
    if ((h ?? 0) * 60 + (m ?? 0) > minutesNow) return `Hari ini ${time} WIB`;
  }
  return `Besok ${sorted[0]} WIB`;
}

function StatusPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery(statusQuery);
  const insights = useQuery(insightsQuery);
  const publishFn = useServerFn(publishNextNow);
  const retryFn = useServerFn(retryJob);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  const toggleHistory = (id: string) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((job) => job.status === "queued" || job.status === "pending");
  const sending = jobs.filter((job) => job.status === "uploading");
  const published = jobs.filter((job) => job.status === "success");
  const failed = jobs.filter((job) => job.status === "failed");

  const publishNow = useMutation({
    mutationFn: () => publishFn({}),
    onSuccess: (r) => {
      toast.success(r.message ?? "Selesai");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Video dimasukkan kembali ke antrian.");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const times = data?.settings.schedule_times ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 py-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Status posting
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              Antrian &amp; hasil publikasi
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Pantau video yang menunggu giliran, jam tayang berikutnya, dan hasil setiap video yang
              sudah dikirim ke Halaman Facebook.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/">Kembali ke pengaturan</Link>
            </Button>
            <Button onClick={() => publishNow.mutate()} disabled={publishNow.isPending}>
              {publishNow.isPending ? "Memposting…" : "Posting sekarang"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Jadwal berikutnya
            </p>
            <p className="mt-2 text-xl font-semibold text-card-foreground">
              {isLoading ? <Skeleton className="h-6 w-32" /> : nextSlotLabel(times)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Jam tayang: {times.length ? times.join(", ") : "belum diatur"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Dalam antrian</p>
            <p className="mt-2 text-xl font-semibold text-card-foreground">{queued.length} video</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Batas antrian {data?.settings.queue_limit ?? 10} video
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sudah tayang</p>
            <p className="mt-2 text-xl font-semibold text-card-foreground">
              {published.length} video
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{failed.length} gagal dikirim</p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground">Sedang mengantri</h2>
          {isLoading ? (
            <Skeleton className="mt-4 h-16 w-full" />
          ) : queued.length === 0 && sending.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Belum ada video yang menunggu. Video baru dari folder Drive akan muncul di sini.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {[...sending, ...queued].map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{job.file_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Jadwal tayang: {formatWib(job.scheduled_at)} · {formatSize(job.size_bytes)}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground">Hasil publikasi Facebook</h2>
          {isLoading ? (
            <Skeleton className="mt-4 h-16 w-full" />
          ) : published.length === 0 && failed.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Belum ada video yang dikirim ke Halaman Facebook.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {[...failed, ...published].map((job) => {
                const expanded = expandedHistory.has(job.id);
                return (
                  <li
                    key={job.id}
                    className="rounded-lg border border-border px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => toggleHistory(job.id)}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {job.file_name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {expanded ? "Sembunyikan" : "Detail"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            Diproses {formatWib(job.updated_at)} · {formatSize(job.size_bytes)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {job.drive_deleted_at
                              ? `Sudah dihapus permanen dari Google Drive ${formatWib(job.drive_deleted_at)}`
                              : "Masih ada di Google Drive"}
                          </p>
                          {job.facebook_video_id ? (
                            <a
                              className="mt-1 inline-block text-xs font-medium text-primary underline"
                              href={`https://www.facebook.com/${job.facebook_video_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Lihat video di Facebook
                            </a>
                          ) : null}
                          {job.error_message ? (
                            <p className="mt-1 max-w-xl text-xs text-destructive">{job.error_message}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={job.status} />
                          {job.status === "failed" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retry.mutate(job.id)}
                              disabled={retry.isPending}
                            >
                              Coba lagi
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
