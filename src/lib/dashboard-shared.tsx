import { queryOptions } from "@tanstack/react-query";

import { getDashboard } from "@/lib/automation.functions";
import { Badge } from "@/components/ui/badge";

export const DEFAULT_CAPTION = `{filename}
Barakallah dr Zaidul Akbar
Sumber video dari Youtube dr Zaidul Akbar Official
#reels #fyp #zidulakbar #drzaidulakbar #resepsehatdrzaidulakbar`;

export const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  refetchInterval: 20000,
});

export function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export function statusDetail(status: string) {
  const map: Record<string, string> = {
    success: "Video sudah tayang di Halaman Facebook Anda.",
    uploading: "Video sedang dikirim ke Facebook.",
    pending: "Video menunggu giliran untuk dikirim.",
    queued: "Video menunggu jadwal posting berikutnya.",
    failed: "Pengiriman gagal — lihat pesan kesalahan di bawah.",
  };
  return map[status] ?? "Status tidak dikenal.";
}

export function StatusBadge({ status }: { status: string }) {
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
