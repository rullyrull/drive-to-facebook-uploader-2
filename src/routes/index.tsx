import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { runSyncNow, publishNextNow, retryJob } from "@/lib/automation.functions";
import {
  dashboardQuery,
  formatSize,
  statusDetail,
  StatusBadge,
} from "@/lib/dashboard-shared";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DriveKeFB — Unggah Video Drive ke Halaman Facebook" },
      {
        name: "description",
        content:
          "Pantau folder Google Drive dan unggah setiap video baru ke Halaman Facebook Anda secara otomatis.",
      },
      { property: "og:title", content: "DriveKeFB — Otomatis Drive ke Facebook" },
      {
        property: "og:description",
        content: "Video baru di folder Drive langsung tayang di Halaman Facebook Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(dashboardQuery);
  const queuedJobs = (data?.jobs ?? []).filter((job) => job.status === "queued");
  const queueLimit = data?.settings.queue_limit ?? 10;

  const syncFn = useServerFn(runSyncNow);
  const publishFn = useServerFn(publishNextNow);
  const retryFn = useServerFn(retryJob);

  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const toggleJob = (id: string) =>
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (r) => {
      toast.success(
        r.message ?? `${r.uploaded} video terunggah, ${r.failed} gagal, ${r.skipped} dilewati`,
      );
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
      toast.success("Dicoba ulang");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setupIncomplete = data && (!data.driveReady || !data.facebookReady);

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Otomatisasi video
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              Google Drive → Halaman Facebook
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Setiap video baru di folder yang Anda pilih akan diunggah sendiri ke Halaman Facebook
              Anda. Pemeriksaan berjalan otomatis tiap 15 menit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/settings">Pengaturan</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/status">Status posting</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || !data?.settings.drive_folder_id}
            >
              {sync.isPending ? "Memeriksa…" : "Periksa video baru"}
            </Button>
            <Button onClick={() => publishNow.mutate()} disabled={publishNow.isPending}>
              {publishNow.isPending ? "Memposting…" : "Posting sekarang"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {setupIncomplete ? (
          <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="text-base font-semibold text-foreground">Penyiapan belum lengkap</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {!data.driveReady
                ? "Google Drive belum terhubung. "
                : "Halaman Facebook belum diatur. "}
              Lengkapi dulu di halaman Pengaturan agar unggahan otomatis bisa berjalan.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/settings">Buka Pengaturan</Link>
            </Button>
          </section>
        ) : null}

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-card-foreground">Antrian posting</h2>
            <Badge variant="secondary">
              {queuedJobs.length} dari {queueLimit} video
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Sistem memposting video dari antrian pada jam yang diatur di Pengaturan
            {data?.settings.drive_folder_name
              ? `, dari folder "${data.settings.drive_folder_name}"`
              : ""}
            .
          </p>

          {queuedJobs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Antrian kosong. Tekan “Periksa video baru” untuk mengisi antrian dari folder Drive.
            </p>
          ) : (
            <ol className="mt-4 space-y-1">
              {queuedJobs.map((job, index) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2 text-xs"
                >
                  <span className="truncate text-foreground">
                    {index + 1}. {job.file_name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {job.scheduled_at
                      ? new Date(job.scheduled_at).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "menunggu"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-card-foreground">Riwayat unggahan</h2>
            {data?.settings.drive_folder_name ? (
              <span className="text-xs text-muted-foreground">
                Folder: {data.settings.drive_folder_name}
              </span>
            ) : null}
          </div>

          <div className="mt-6 space-y-3">
            {isLoading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : (data?.jobs.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada video yang diproses. Atur folder di Pengaturan, lalu tekan “Periksa
                video baru”.
              </p>
            ) : (
              data?.jobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-border/70">
                  <button
                    type="button"
                    onClick={() => toggleJob(job.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-accent/40"
                    aria-expanded={expandedJobs.has(job.id)}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {job.file_name}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={job.status} />
                      <span className="text-xs text-muted-foreground">
                        {expandedJobs.has(job.id) ? "Tutup" : "Detail"}
                      </span>
                    </span>
                  </button>

                  {expandedJobs.has(job.id) ? (
                    <div className="border-t border-border/70 p-4">
                      <p className="text-xs text-muted-foreground">{statusDetail(job.status)}</p>

                      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">Ukuran</dt>
                          <dd className="text-foreground">{formatSize(job.size_bytes)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">Ditemukan</dt>
                          <dd className="text-foreground">
                            {new Date(job.created_at).toLocaleString("id-ID")}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">Diperbarui</dt>
                          <dd className="text-foreground">
                            {new Date(job.updated_at).toLocaleString("id-ID")}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">Terunggah</dt>
                          <dd className="text-foreground">
                            {job.status === "success" ? "Ya" : "Belum"}
                          </dd>
                        </div>
                      </dl>

                      {job.facebook_video_id ? (
                        <div className="mt-3 space-y-1">
                          <a
                            className="text-xs text-primary underline-offset-4 hover:underline"
                            href={`https://www.facebook.com/${job.facebook_video_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Buka video di Facebook
                          </a>
                          <p className="break-all text-[11px] text-muted-foreground">
                            https://www.facebook.com/{job.facebook_video_id}
                          </p>
                        </div>
                      ) : null}

                      {job.error_message ? (
                        <div className="mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                          <p className="text-xs font-medium text-destructive">Penyebab kegagalan</p>
                          <p className="break-words text-xs text-destructive">
                            {job.error_message}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retry.mutate(job.id)}
                            disabled={retry.isPending}
                          >
                            Coba lagi
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
