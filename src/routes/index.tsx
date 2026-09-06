import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getDashboard,
  listFolders,
  listFolderVideos,
  saveSettings,
  runSyncNow,
  publishNextNow,
  retryJob,
  addFacebookPage,
  addFacebookPages,
  discoverFacebookPages,
  deleteFacebookPage,
  setActiveFacebookPage,
  type FacebookPage,
  type DiscoveredPage,
} from "@/lib/automation.functions";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_CAPTION = `{filename}
Barakallah dr Zaidul Akbar
Sumber video dari Youtube dr Zaidul Akbar Official
#reels #fyp #zidulakbar #drzaidulakbar #resepsehatdrzaidulakbar`;

const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  refetchInterval: 20000,
});

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

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function statusDetail(status: string) {
  const map: Record<string, string> = {
    success: "Video sudah tayang di Halaman Facebook Anda.",
    uploading: "Video sedang dikirim ke Facebook.",
    pending: "Video menunggu giliran untuk dikirim.",
    queued: "Video menunggu jadwal posting berikutnya.",
    failed: "Pengiriman gagal — lihat pesan kesalahan di bawah.",
  };
  return map[status] ?? "Status tidak dikenal.";
}

function StatusBadge({ status }: { status: string }) {

  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    success: { label: "Terunggah", variant: "default" },
    uploading: { label: "Sedang diunggah", variant: "secondary" },
    pending: { label: "Menunggu", variant: "secondary" },
    queued: { label: "Dalam antrian", variant: "secondary" },
    failed: { label: "Gagal", variant: "destructive" },
  };
  const info = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function Home() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(dashboardQuery);
  const queuedJobs = (data?.jobs ?? []).filter((job) => job.status === "queued");

  const foldersFn = useServerFn(listFolders);
  const videosFn = useServerFn(listFolderVideos);
  const saveFn = useServerFn(saveSettings);
  const syncFn = useServerFn(runSyncNow);
  const publishFn = useServerFn(publishNextNow);
  const retryFn = useServerFn(retryJob);
  const addPageFn = useServerFn(addFacebookPage);
  const deletePageFn = useServerFn(deleteFacebookPage);
  const setActivePageFn = useServerFn(setActiveFacebookPage);
  const discoverFn = useServerFn(discoverFacebookPages);
  const addPagesFn = useServerFn(addFacebookPages);


  const [folderId, setFolderId] = useState("");
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [titleTemplate, setTitleTemplate] = useState("{filename}");
  const [descriptionTemplate, setDescriptionTemplate] = useState(DEFAULT_CAPTION);
  const [postAsReels, setPostAsReels] = useState(true);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(["13:00", "17:00", "19:00"]);
  const [queueLimit, setQueueLimit] = useState(10);
  const [activeFacebookPageId, setActiveFacebookPageId] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const [newPageName, setNewPageName] = useState("");
  const [newPageId, setNewPageId] = useState("");
  const [newPageToken, setNewPageToken] = useState("");
  const [userToken, setUserToken] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredPage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());



  const toggleJob = (id: string) =>
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (!data) return;
    setFolderId(data.settings.drive_folder_id ?? "");
    setAutoEnabled(data.settings.auto_enabled);
    setTitleTemplate(data.settings.title_template);
    setDescriptionTemplate(data.settings.description_template || DEFAULT_CAPTION);
    setPostAsReels(data.settings.post_as_reels);
    setScheduleTimes(
      data.settings.schedule_times?.length ? data.settings.schedule_times : ["13:00", "17:00", "19:00"],
    );
    setQueueLimit(data.settings.queue_limit ?? 10);
    setActiveFacebookPageId(data.activeFacebookPageId ?? null);
  }, [data]);


  const folders = useQuery({
    queryKey: ["folders"],
    queryFn: () => foldersFn({ data: {} }),
    enabled: Boolean(data?.driveReady),
  });

  const videos = useQuery({
    queryKey: ["folder-videos", folderId],
    queryFn: () => videosFn({ data: { folderId } }),
    enabled: Boolean(folderId),
  });

  const save = useMutation({
    mutationFn: async () => {
      const folder = folders.data?.find((f) => f.id === folderId);
      return await saveFn({
        data: {
          driveFolderId: folderId,
          driveFolderName: folder?.name ?? data?.settings.drive_folder_name ?? folderId,
          autoEnabled,
          titleTemplate,
          descriptionTemplate,
          postAsReels,
          scheduleTimes,
          queueLimit,
          facebookPageId: activeFacebookPageId,
        },
      });
    },
    onSuccess: () => {
      toast.success("Pengaturan tersimpan");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
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

  const addPage = useMutation({
    mutationFn: async () => {
      const page = await addPageFn({
        data: {
          name: newPageName,
          pageId: newPageId,
          accessToken: newPageToken,
        },
      });
      return page;
    },
    onSuccess: (page) => {
      toast.success("Halaman Facebook ditambahkan");
      setNewPageName("");
      setNewPageId("");
      setNewPageToken("");
      setActiveFacebookPageId(page.id);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discover = useMutation({
    mutationFn: () => discoverFn({ data: { userToken: userToken.trim() } }),
    onSuccess: (pages) => {
      setDiscovered(pages);
      setSelectedPageIds(new Set(pages.filter((p) => !p.already_saved).map((p) => p.page_id)));
      toast.success(`${pages.length} halaman ditemukan`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPages = useMutation({
    mutationFn: () =>
      addPagesFn({
        data: {
          pages: discovered
            .filter((p) => selectedPageIds.has(p.page_id))
            .map((p) => ({ name: p.name, pageId: p.page_id, accessToken: p.access_token })),
        },
      }),
    onSuccess: (saved) => {
      toast.success(`${saved.length} halaman tersimpan`);
      setUserToken("");
      setDiscovered([]);
      setSelectedPageIds(new Set());
      const first = saved[0];
      if (first && !activeFacebookPageId) {
        setActiveFacebookPageId(first.id);
        setActivePage.mutate(first.id);
      }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const deletePage = useMutation({
    mutationFn: (id: string) => deletePageFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Halaman Facebook dihapus");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setActivePage = useMutation({
    mutationFn: (pageId: string | null) => setActivePageFn({ data: { pageId } }),
    onSuccess: () => {
      toast.success("Halaman aktif diperbarui");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
              <Link to="/status">Status posting</Link>
            </Button>
            <Button

              variant="outline"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || !folderId}
            >
              {sync.isPending ? "Memeriksa…" : "Periksa video baru"}
            </Button>
            <Button onClick={() => publishNow.mutate()} disabled={publishNow.isPending}>
              {publishNow.isPending ? "Memposting…" : "Posting sekarang"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-8">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-card-foreground">Akun Google Drive</h2>
            <Badge variant={data?.driveAccount?.connected ? "default" : "destructive"}>
              {data?.driveAccount?.connected ? "Terhubung" : "Belum terhubung"}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-foreground">
            {data?.driveAccount?.connected
              ? `${data.driveAccount.name ?? "Akun Google"}${
                  data.driveAccount.email ? ` (${data.driveAccount.email})` : ""
                }`
              : (data?.driveAccount?.error ??
                "Hubungkan akun Google Drive Anda untuk mulai memantau folder.")}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["folders"] });
                toast.success("Memeriksa ulang koneksi Google Drive…");
              }}
            >
              Periksa ulang koneksi
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
              >
                Kelola izin akun Google
              </a>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Untuk berganti akun: putuskan koneksi Google Drive di panel koneksi Lovable, lalu
            hubungkan lagi dengan akun yang Anda inginkan. Setelah itu tekan “Periksa ulang
            koneksi”.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground">Jadwal posting otomatis</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sistem memposting 3 video setiap hari pada jam di bawah (waktu Indonesia bagian barat).
            Video baru di folder Drive otomatis masuk antrian, maksimal {queueLimit} video.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {scheduleTimes.map((time, index) => (
              <div key={index} className="space-y-1">
                <Label className="text-xs">Posting {index + 1}</Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) =>
                    setScheduleTimes((prev) =>
                      prev.map((t, i) => (i === index ? e.target.value : t)),
                    )
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="queue-limit">Maksimal video dalam antrian</Label>
            <Input
              id="queue-limit"
              type="number"
              min={1}
              max={50}
              value={queueLimit}
              onChange={(e) => setQueueLimit(Number(e.target.value) || 1)}
            />
          </div>

          <div className="mt-5 flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Posting sebagai Reels</p>
              <p className="text-xs text-muted-foreground">
                Bawaan menyala. Matikan untuk memposting sebagai video biasa.
              </p>
            </div>
            <Switch checked={postAsReels} onCheckedChange={setPostAsReels} />
          </div>

          <div className="mt-5">
            <p className="text-xs font-medium text-muted-foreground">
              Antrian saat ini ({queuedJobs.length} dari {queueLimit})
            </p>
            {queuedJobs.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Antrian kosong. Tekan “Periksa video baru” untuk mengisi antrian dari folder Drive.
              </p>
            ) : (
              <ol className="mt-2 space-y-1">
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
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground">Pengaturan</h2>


          <div className="mt-6 space-y-5">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <Label>Halaman Facebook</Label>
                <Badge variant={data?.facebookReady ? "default" : "destructive"}>
                  {data?.facebookReady ? "Siap" : "Belum diatur"}
                </Badge>
              </div>

              {data?.facebookPages && data.facebookPages.length > 0 ? (
                <div className="space-y-2">
                  <Select
                    value={activeFacebookPageId ?? "__none__"}
                    onValueChange={(value) => {
                      const next = value === "__none__" ? null : value;
                      setActiveFacebookPageId(next);
                      setActivePage.mutate(next);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih halaman aktif" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Gunakan pengaturan rahasia bawaan</SelectItem>
                      {data.facebookPages.map((page: FacebookPage) => (
                        <SelectItem key={page.id} value={page.id}>
                          {page.name ?? page.page_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <ul className="space-y-2">
                    {data.facebookPages.map((page: FacebookPage) => (
                      <li
                        key={page.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2 text-xs"
                      >
                        <span className="truncate">
                          {page.name ?? page.page_id}
                          {page.is_active ? (
                            <span className="ml-2 text-muted-foreground">(aktif)</span>
                          ) : null}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-destructive hover:text-destructive"
                          onClick={() => deletePage.mutate(page.id)}
                          disabled={deletePage.isPending}
                        >
                          Hapus
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Belum ada halaman Facebook tersimpan. Tambahkan di bawah atau gunakan pengaturan
                  rahasia bawaan.
                </p>
              )}

              <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-3">
                <p className="text-xs font-medium">Tambah halaman lewat token akun</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Tempel token akun Facebook Anda, lalu semua Halaman yang Anda kelola akan
                  ditampilkan untuk dipilih.
                </p>
                <Input
                  placeholder="Token akun Facebook"
                  type="password"
                  value={userToken}
                  onChange={(e) => setUserToken(e.target.value)}
                />
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => discover.mutate()}
                  disabled={discover.isPending || userToken.trim().length < 20}
                >
                  {discover.isPending ? "Mencari halaman…" : "Tampilkan halaman saya"}
                </Button>

                {discovered.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <ul className="space-y-1">
                      {discovered.map((page) => {
                        const checked = selectedPageIds.has(page.page_id);
                        return (
                          <li key={page.page_id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-2 text-xs">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-primary"
                                checked={checked}
                                onChange={() =>
                                  setSelectedPageIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(page.page_id)) next.delete(page.page_id);
                                    else next.add(page.page_id);
                                    return next;
                                  })
                                }
                              />
                              <span className="truncate">{page.name}</span>
                              {page.already_saved ? (
                                <span className="ml-auto shrink-0 text-muted-foreground">
                                  sudah ada
                                </span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <Button
                      className="w-full"
                      onClick={() => addPages.mutate()}
                      disabled={addPages.isPending || selectedPageIds.size === 0}
                    >
                      {addPages.isPending
                        ? "Menyimpan…"
                        : `Simpan ${selectedPageIds.size} halaman terpilih`}
                    </Button>
                  </div>
                ) : null}
              </div>

              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Tambah halaman secara manual
                </summary>
                <div className="space-y-2 pt-2">
                  <Input
                    placeholder="Nama halaman"
                    value={newPageName}
                    onChange={(e) => setNewPageName(e.target.value)}
                  />
                  <Input
                    placeholder="ID Halaman Facebook (page id)"
                    value={newPageId}
                    onChange={(e) => setNewPageId(e.target.value)}
                  />
                  <Input
                    placeholder="Akses token halaman"
                    type="password"
                    value={newPageToken}
                    onChange={(e) => setNewPageToken(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    onClick={() => addPage.mutate()}
                    disabled={addPage.isPending || !newPageName || !newPageId || !newPageToken}
                  >
                    {addPage.isPending ? "Menambahkan…" : "Tambah halaman"}
                  </Button>
                </div>
              </details>

            </div>

            <div className="space-y-2">
              <Label>Folder Google Drive yang dipantau</Label>
              <Select value={folderId} onValueChange={setFolderId}>

                <SelectTrigger>
                  <SelectValue
                    placeholder={folders.isLoading ? "Memuat folder…" : "Pilih folder"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(folders.data ?? []).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {folders.isError ? (
                <p className="text-xs text-destructive">
                  Tidak bisa membaca daftar folder Drive. Coba muat ulang halaman.
                </p>
              ) : null}

              {folderId ? (
                <div className="rounded-lg border border-border/70 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Isi folder ({videos.isLoading ? "memuat…" : `${videos.data?.length ?? 0} video`})
                  </p>
                  {videos.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : videos.isError ? (
                    <p className="text-xs text-destructive">
                      Isi folder tidak bisa dibaca: {videos.error.message}
                    </p>
                  ) : (videos.data?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Tidak ada video di folder ini. Masukkan berkas video (mp4, mov, dll.) ke
                      folder ini di Google Drive.
                    </p>
                  ) : (
                    <ul className="max-h-56 space-y-1 overflow-y-auto">
                      {videos.data!.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate text-foreground">{file.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatSize(file.size ? Number(file.size) : null)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Judul unggahan</Label>
              <Input
                id="title"
                value={titleTemplate}
                onChange={(e) => setTitleTemplate(e.target.value)}
                placeholder="{filename}"
              />
              <p className="text-xs text-muted-foreground">
                Gunakan {"{filename}"} untuk nama berkas dan {"{date}"} untuk tanggal hari ini.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">Keterangan</Label>
              <Textarea
                id="desc"
                rows={4}
                value={descriptionTemplate}
                onChange={(e) => setDescriptionTemplate(e.target.value)}
                placeholder="Tulis keterangan yang dipakai untuk semua video…"
                className="min-h-40"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Unggah otomatis</p>
                <p className="text-xs text-muted-foreground">
                  Video baru langsung dikirim tanpa Anda klik.
                </p>
              </div>
              <Switch checked={autoEnabled} onCheckedChange={setAutoEnabled} />
            </div>

            <Button
              className="w-full"
              onClick={() => save.mutate()}
              disabled={!folderId || save.isPending}
            >
              {save.isPending ? "Menyimpan…" : "Simpan pengaturan"}
            </Button>

            {data && !data.facebookReady ? (
              <p className="text-xs text-destructive">
                Halaman Facebook belum diatur — unggahan akan gagal.
              </p>
            ) : null}

          </div>
        </section>
        </div>



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
                Belum ada video yang diproses. Pilih folder, nyalakan unggah otomatis, lalu tekan
                “Periksa sekarang”.
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
                      <p className="break-words text-xs text-destructive">{job.error_message}</p>
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
