import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  listFolders,
  listFolderVideos,
  saveSettings,
  addFacebookPage,
  addFacebookPages,
  discoverFacebookPages,
  deleteFacebookPage,
  setActiveFacebookPage,
  setPageFolder,
  type FacebookPage,
  type DiscoveredPage,
} from "@/lib/automation.functions";
import { DEFAULT_CAPTION, dashboardQuery, formatSize } from "@/lib/dashboard-shared";

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

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Pengaturan — DriveKeFB" },
      {
        name: "description",
        content:
          "Atur koneksi Google Drive, Halaman Facebook, jadwal posting, dan template unggahan DriveKeFB.",
      },
      { property: "og:title", content: "Pengaturan — DriveKeFB" },
      {
        property: "og:description",
        content: "Kelola folder Drive, halaman Facebook, dan jadwal posting otomatis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery(dashboardQuery);

  const foldersFn = useServerFn(listFolders);
  const videosFn = useServerFn(listFolderVideos);
  const saveFn = useServerFn(saveSettings);
  const addPageFn = useServerFn(addFacebookPage);
  const deletePageFn = useServerFn(deleteFacebookPage);
  const setActivePageFn = useServerFn(setActiveFacebookPage);
  const discoverFn = useServerFn(discoverFacebookPages);
  const addPagesFn = useServerFn(addFacebookPages);
  const setPageFolderFn = useServerFn(setPageFolder);

  const [folderId, setFolderId] = useState("");
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [titleTemplate, setTitleTemplate] = useState("{filename}");
  const [descriptionTemplate, setDescriptionTemplate] = useState(DEFAULT_CAPTION);
  const [postAsReels, setPostAsReels] = useState(true);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(["13:00", "17:00", "19:00"]);
  const [queueLimit, setQueueLimit] = useState(10);
  const [activeFacebookPageId, setActiveFacebookPageId] = useState<string | null>(null);

  const [newPageName, setNewPageName] = useState("");
  const [newPageId, setNewPageId] = useState("");
  const [newPageToken, setNewPageToken] = useState("");
  const [userToken, setUserToken] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredPage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());

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

  const addPage = useMutation({
    mutationFn: async () => {
      return await addPageFn({
        data: { name: newPageName, pageId: newPageId, accessToken: newPageToken },
      });
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

  const pageFolder = useMutation({
    mutationFn: (input: { pageId: string; folderId: string | null; folderName: string | null }) =>
      setPageFolderFn({ data: input }),
    onSuccess: () => {
      toast.success("Folder halaman diperbarui");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              DriveKeFB
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Pengaturan</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Kelola koneksi Google Drive, Halaman Facebook, jadwal, dan isi unggahan.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/">← Kembali ke beranda</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
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
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
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
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground">Halaman Facebook & unggahan</h2>

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
                        className="space-y-2 rounded-md border border-border/70 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
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
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">
                            Folder Drive untuk halaman ini
                          </Label>
                          <Select
                            value={page.drive_folder_id ?? "__none__"}
                            onValueChange={(value) => {
                              const folder =
                                value === "__none__"
                                  ? null
                                  : (folders.data?.find((f) => f.id === value) ?? null);
                              pageFolder.mutate({
                                pageId: page.id,
                                folderId: folder?.id ?? null,
                                folderName: folder?.name ?? null,
                              });
                            }}
                            disabled={!data?.driveReady || pageFolder.isPending}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue
                                placeholder={
                                  folders.isLoading ? "Memuat folder…" : "Pilih folder"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Tidak memantau folder</SelectItem>
                              {(folders.data ?? []).map((folder) => (
                                <SelectItem key={folder.id} value={folder.id}>
                                  {folder.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Setiap halaman hanya mengambil video dari folder yang dipetakan di atas.
                    Contoh: halaman “Berbagi Kebaikan” hanya mengambil video dari folder
                    “FB - Berbagi Kebaikan”.
                  </p>
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
              <Label>Folder bawaan (dipakai bila halaman tidak punya folder sendiri)</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger>
                  <SelectValue placeholder={folders.isLoading ? "Memuat folder…" : "Pilih folder"} />
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
      </main>
    </div>
  );
}
