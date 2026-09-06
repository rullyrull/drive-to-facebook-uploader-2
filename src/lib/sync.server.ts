/**
 * Server-only logic: read videos from Google Drive (via the Lovable connector
 * gateway) and publish them to a Facebook Page using the resumable upload API.
 */

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const GRAPH = "https://graph.facebook.com/v21.0";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  thumbnailLink?: string;
};

export type FacebookPage = {
  id: string;
  name: string | null;
  page_id: string;
  access_token: string;
  is_active: boolean;
  drive_folder_id?: string | null;
  drive_folder_name?: string | null;
};


function driveHeaders() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const driveKey = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !driveKey) throw new Error("Google Drive belum tersambung.");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": driveKey,
  };
}

async function driveFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...driveHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive gagal [${res.status}]: ${body.slice(0, 400)}`);
  }
  return res;
}

/** Loads the active Facebook page from the database, falling back to env vars. */
export async function loadActiveFacebookPage(): Promise<FacebookPage | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("facebook_page_id")
    .eq("id", "default")
    .maybeSingle();

  if (settings?.facebook_page_id) {
    const { data: page } = await supabaseAdmin
      .from("facebook_pages")
      .select("id,name,page_id,access_token,is_active")
      .eq("id", settings.facebook_page_id)
      .maybeSingle();
    if (page) return page as unknown as FacebookPage;
  }

  const pageId = process.env["FACEBOOK_PAGE_ID"];
  const token = process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  if (pageId && token) {
    return { id: "env", name: "Default", page_id: pageId, access_token: token, is_active: true };
  }

  return null;
}


export async function listDriveFolders(search?: string): Promise<DriveFile[]> {
  const clauses = [
    "mimeType='application/vnd.google-apps.folder'",
    "'root' in parents",
    "trashed=false",
  ];
  if (search) clauses.push(`name contains '${search.replace(/'/g, "\\'")}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: "50",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`/drive/v3/files?${params}`);
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

/** Returns the Google account currently linked through the Drive connector. */
export async function getDriveAccount(): Promise<{
  connected: boolean;
  email: string | null;
  name: string | null;
  error?: string;
}> {
  try {
    const res = await driveFetch("/drive/v3/about?fields=user(displayName,emailAddress)");
    const json = (await res.json()) as {
      user?: { displayName?: string; emailAddress?: string };
    };
    return {
      connected: true,
      email: json.user?.emailAddress ?? null,
      name: json.user?.displayName ?? null,
    };
  } catch (e) {
    return { connected: false, email: null, name: null, error: (e as Error).message };
  }
}


export async function listDriveVideos(folderId: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id,name,mimeType,size,createdTime,thumbnailLink)",
    pageSize: "100",
    orderBy: "createdTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`/drive/v3/files?${params}`);
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

async function driveChunk(fileId: string, start: number, end: number): Promise<Blob> {
  const res = await driveFetch(
    `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Range: `bytes=${start}-${end}` } },
  );
  return await res.blob();
}

async function graph(params: FormData, page: FacebookPage): Promise<Record<string, unknown>> {
  if (!page.page_id || !page.access_token) throw new Error("Token Halaman Facebook belum diatur.");
  params.set("access_token", page.access_token);
  const res = await fetch(`${GRAPH}/${page.page_id}/videos`, { method: "POST", body: params });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep raw text below */
  }
  if (!res.ok || json["error"]) {
    const err = json["error"] as { message?: string } | undefined;
    throw new Error(`Facebook gagal [${res.status}]: ${err?.message ?? text.slice(0, 400)}`);
  }
  return json;
}


function applyTemplate(template: string, file: DriveFile) {
  const base = file.name.replace(/\.[^.]+$/, "");
  return template
    .replaceAll("{filename}", base)
    .replaceAll("{date}", new Date().toLocaleDateString("id-ID"));
}

/** Uploads one Drive video to the Facebook Page in chunks. Returns the video id. */
export async function uploadDriveVideoToFacebook(
  file: DriveFile,
  titleTemplate: string,
  descriptionTemplate: string,
  page: FacebookPage,
): Promise<string> {
  const size = Number(file.size ?? 0);
  if (!size) throw new Error("Ukuran video tidak diketahui.");

  const startForm = new FormData();
  startForm.set("upload_phase", "start");
  startForm.set("file_size", String(size));
  const started = (await graph(startForm, page)) as {
    upload_session_id: string;
    video_id: string;
    start_offset: string;
    end_offset: string;
  };

  let startOffset = Number(started.start_offset);
  let endOffset = Number(started.end_offset);

  while (startOffset < endOffset) {
    const chunk = await driveChunk(file.id, startOffset, endOffset - 1);
    const transfer = new FormData();
    transfer.set("upload_phase", "transfer");
    transfer.set("upload_session_id", started.upload_session_id);
    transfer.set("start_offset", String(startOffset));
    transfer.set("video_file_chunk", chunk, file.name);
    const next = (await graph(transfer, page)) as { start_offset: string; end_offset: string };
    startOffset = Number(next.start_offset);
    endOffset = Number(next.end_offset);
  }

  const finish = new FormData();
  finish.set("upload_phase", "finish");
  finish.set("upload_session_id", started.upload_session_id);
  finish.set("title", applyTemplate(titleTemplate || "{filename}", file));
  if (descriptionTemplate) {
    finish.set("description", applyTemplate(descriptionTemplate, file));
  }
  await graph(finish, page);

  return started.video_id;
}


/** Downloads a whole Drive file (used for the Reels single-request upload). */
async function driveDownload(fileId: string): Promise<ArrayBuffer> {
  const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  return await res.arrayBuffer();
}

/** Permanently deletes a Drive file (skips the trash). */
export async function driveDeleteFile(fileId: string): Promise<void> {
  await driveFetch(`/drive/v3/files/${fileId}?supportsAllDrives=true`, { method: "DELETE" });
}

/** Publishes one Drive video as a Facebook Page Reel. Returns the video id. */
export async function uploadDriveVideoAsReel(
  file: DriveFile,
  description: string,
  page: FacebookPage,
): Promise<string> {
  if (!page.page_id || !page.access_token) throw new Error("Token Halaman Facebook belum diatur.");

  const startRes = await fetch(
    `${GRAPH}/${page.page_id}/video_reels?upload_phase=start&access_token=${encodeURIComponent(page.access_token)}`,
    { method: "POST" },
  );
  const startText = await startRes.text();
  let start: { video_id?: string; upload_url?: string; error?: { message?: string } } = {};
  try {
    start = JSON.parse(startText);
  } catch {
    /* raw text below */
  }
  if (!startRes.ok || start.error || !start.video_id || !start.upload_url) {
    throw new Error(
      `Facebook Reels gagal dimulai [${startRes.status}]: ${
        start.error?.message ?? startText.slice(0, 300)
      }`,
    );
  }

  const bytes = await driveDownload(file.id);
  const upload = await fetch(start.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${page.access_token}`,
      offset: "0",
      file_size: String(bytes.byteLength),
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  if (!upload.ok) {
    throw new Error(
      `Facebook Reels gagal saat kirim berkas [${upload.status}]: ${(await upload.text()).slice(0, 300)}`,
    );
  }

  const finishParams = new URLSearchParams({
    access_token: page.access_token,
    video_id: start.video_id,
    upload_phase: "finish",
    video_state: "PUBLISHED",
    description,
  });
  const finishRes = await fetch(`${GRAPH}/${page.page_id}/video_reels?${finishParams}`, {
    method: "POST",
  });
  const finishText = await finishRes.text();
  if (!finishRes.ok || finishText.includes('"error"')) {
    throw new Error(
      `Facebook Reels gagal dipublikasikan [${finishRes.status}]: ${finishText.slice(0, 300)}`,
    );
  }

  return start.video_id;
}


/** Builds the caption: file name, then the fixed sentences from the template. */
function buildCaption(template: string, file: DriveFile) {
  const text = applyTemplate(template || "{filename}", file);
  if (template.includes("{filename}")) return text;
  const base = file.name.replace(/\.[^.]+$/, "");
  return `${base}\n${text}`;
}

/** File name without extension, lower-cased, used to spot re-uploaded duplicates. */
function normalizeName(name: string) {
  return name.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Returns the next `count` posting slots (as UTC dates) after `from`. */
export function nextSlots(times: string[], count: number, from = new Date()): Date[] {
  const minutes = times
    .map((t) => {
      const [h, m] = t.split(":");
      return Number(h) * 60 + Number(m ?? 0);
    })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (minutes.length === 0) return [];

  const local = new Date(from.getTime() + JAKARTA_OFFSET_MS);
  const dayStartLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0,
    0,
    0,
  );
  const nowLocalMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();

  const slots: Date[] = [];
  let day = 0;
  while (slots.length < count && day < 60) {
    for (const min of minutes) {
      if (day === 0 && min <= nowLocalMinutes) continue;
      slots.push(new Date(dayStartLocal + day * 86400000 + min * 60000 - JAKARTA_OFFSET_MS));
      if (slots.length >= count) break;
    }
    day += 1;
  }
  return slots;
}

async function loadSettings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return data as
    | {
        drive_folder_id: string | null;
        auto_enabled: boolean;
        title_template: string;
        description_template: string;
        post_as_reels: boolean;
        schedule_times: string[];
        queue_limit: number;
        facebook_page_id: string | null;
      }
    | null;

}

/** Recomputes scheduled_at for the queued videos of one page, in queue order. */
async function reschedule(times: string[], pageKey: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("upload_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true });
  query = pageKey ? query.eq("facebook_page_id", pageKey) : query.is("facebook_page_id", null);
  const { data: queued } = await query;
  const rows = queued ?? [];
  const slots = nextSlots(times, rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const slot = slots[i];
    if (!slot) break;
    await supabaseAdmin
      .from("upload_jobs")
      .update({ scheduled_at: slot.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", rows[i]!.id);
  }
}

export type SyncResult = {
  checked: number;
  uploaded: number;
  failed: number;
  skipped: number;
  queued?: number;
  message?: string;
};

type SyncTarget = {
  /** facebook_pages row id, or "" for the legacy global folder */
  key: string;
  label: string;
  folderId: string;
};

/** Every folder that should be scanned: one per mapped page plus the legacy global folder. */
async function loadSyncTargets(): Promise<SyncTarget[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("id,name,page_id,is_active,drive_folder_id")
    .eq("is_active", true);

  const targets: SyncTarget[] = [];
  for (const page of pages ?? []) {
    if (page.drive_folder_id) {
      targets.push({
        key: page.id,
        label: page.name ?? page.page_id,
        folderId: page.drive_folder_id,
      });
    }
  }

  const settings = await loadSettings();
  if (settings?.drive_folder_id) {
    targets.push({ key: "", label: "folder bawaan", folderId: settings.drive_folder_id });
  }
  return targets;
}

/** Scans every mapped folder and adds new videos to each page's posting queue. */
export async function runSync(options: { force?: boolean } = {}): Promise<SyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settings = await loadSettings();

  if (settings && !settings.auto_enabled && !options.force) {
    return { checked: 0, uploaded: 0, failed: 0, skipped: 0, message: "Otomatis sedang mati." };
  }

  const targets = await loadSyncTargets();
  if (targets.length === 0) {
    return { checked: 0, uploaded: 0, failed: 0, skipped: 0, message: "Folder belum dipilih." };
  }

  const { data: known } = await supabaseAdmin
    .from("upload_jobs")
    .select("drive_file_id,file_name,status,facebook_page_id");
  const rows = known ?? [];
  const limit = settings?.queue_limit ?? 10;
  const times = settings?.schedule_times ?? ["13:00", "17:00", "19:00"];

  let checked = 0;
  let added = 0;
  let skipped = 0;
  let removed = 0;
  let totalQueued = 0;

  for (const target of targets) {
    const files = await listDriveVideos(target.folderId);
    checked += files.length;

    // duplicates and queue size are tracked per page
    const own = rows.filter((row) => (row.facebook_page_id ?? "") === target.key);
    const seen = new Set(own.map((row) => row.drive_file_id));
    const publishedNames = new Set(
      own.filter((row) => row.status === "success").map((row) => normalizeName(row.file_name)),
    );
    const publishedIds = new Set(
      own.filter((row) => row.status === "success").map((row) => row.drive_file_id),
    );
    let queuedCount = own.filter((row) => row.status === "queued").length;

    // oldest first so the queue follows the order videos were added to Drive
    for (const file of [...files].reverse()) {
      const isDuplicate = publishedIds.has(file.id) || publishedNames.has(normalizeName(file.name));
      if (isDuplicate) {
        try {
          await driveDeleteFile(file.id);
          removed += 1;
          let cleanup = supabaseAdmin
            .from("upload_jobs")
            .update({ drive_deleted_at: new Date().toISOString() })
            .eq("drive_file_id", file.id);
          cleanup = target.key
            ? cleanup.eq("facebook_page_id", target.key)
            : cleanup.is("facebook_page_id", null);
          await cleanup;
        } catch (e) {
          console.error("Gagal menghapus duplikat di Drive", file.name, e);
        }
        continue;
      }
      if (seen.has(file.id)) {
        skipped += 1;
        continue;
      }
      if (queuedCount >= limit) {
        skipped += 1;
        continue;
      }
      await supabaseAdmin.from("upload_jobs").insert({
        drive_file_id: file.id,
        file_name: file.name,
        size_bytes: file.size ? Number(file.size) : null,
        status: "queued",
        error_message: null,
        facebook_page_id: target.key || null,
        updated_at: new Date().toISOString(),
      });
      queuedCount += 1;
      added += 1;
    }
    totalQueued += queuedCount;
    await reschedule(times, target.key);
  }

  return {
    checked,
    uploaded: 0,
    failed: 0,
    skipped,
    queued: added,
    message:
      [
        added > 0 ? `${added} video baru masuk antrian.` : null,
        removed > 0 ? `${removed} video duplikat dihapus dari Google Drive.` : null,
        added === 0 && removed === 0
          ? totalQueued > 0
            ? `Tidak ada video baru. ${totalQueued} video menunggu jadwal.`
            : "Tidak ada video baru."
          : null,
      ]
        .filter(Boolean)
        .join(" "),
  };
}

/** Publishes the next queued video for every page. Called by the schedule and the manual button. */
export async function publishNext(options: { force?: boolean } = {}): Promise<SyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settings = await loadSettings();
  if (!settings) {
    return { checked: 0, uploaded: 0, failed: 0, skipped: 0, message: "Pengaturan belum ada." };
  }
  if (!settings.auto_enabled && !options.force) {
    return { checked: 0, uploaded: 0, failed: 0, skipped: 0, message: "Otomatis sedang mati." };
  }

  const { data: pages } = await supabaseAdmin
    .from("facebook_pages")
    .select("id,name,page_id,access_token,is_active")
    .eq("is_active", true);

  // one publishing target per saved page, plus the legacy active page for older jobs
  const targets: Array<{ key: string; page: FacebookPage }> = (pages ?? []).map((p) => ({
    key: p.id as string,
    page: p as unknown as FacebookPage,
  }));
  const legacy = await loadActiveFacebookPage();
  if (legacy) targets.push({ key: "", page: legacy });
  if (targets.length === 0) {
    return { checked: 0, uploaded: 0, failed: 0, skipped: 0, message: "Halaman Facebook belum diatur." };
  }

  const totals = { checked: 0, uploaded: 0, failed: 0, skipped: 0 };
  const messages: string[] = [];

  for (const target of targets) {
    let query = supabaseAdmin
      .from("upload_jobs")
      .select("id,drive_file_id,file_name,size_bytes,scheduled_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);
    query = target.key
      ? query.eq("facebook_page_id", target.key)
      : query.is("facebook_page_id", null);
    const { data: next } = await query.maybeSingle();

    if (!next) continue;
    // 5 minute grace so a job scheduled exactly at the cron minute still goes out
    if (
      !options.force &&
      next.scheduled_at &&
      new Date(next.scheduled_at).getTime() - Date.now() > 5 * 60 * 1000
    ) {
      totals.skipped += 1;
      continue;
    }

    const result = await publishJob(next, target.page, settings, target.key);
    totals.checked += result.checked;
    totals.uploaded += result.uploaded;
    totals.failed += result.failed;
    if (result.message) messages.push(result.message);
  }

  if (totals.checked === 0) {
    return {
      ...totals,
      skipped: totals.skipped,
      message: totals.skipped > 0 ? "Belum waktunya tayang." : "Antrian kosong.",
    };
  }
  return { ...totals, message: messages.join(" ") };
}

/** Publishes a single queued job to its Facebook Page. */
async function publishJob(
  next: { id: string; drive_file_id: string; file_name: string; size_bytes: number | null },
  page: FacebookPage,
  settings: {
    title_template: string;
    description_template: string;
    post_as_reels: boolean;
    schedule_times: string[];
  },
  pageKey: string,
): Promise<SyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await supabaseAdmin
    .from("upload_jobs")
    .update({ status: "uploading", updated_at: new Date().toISOString() })
    .eq("id", next.id);

  const file: DriveFile = {
    id: next.drive_file_id,
    name: next.file_name,
    mimeType: "video/mp4",
    ...(next.size_bytes ? { size: String(next.size_bytes) } : {}),
  };

  try {
    const caption = buildCaption(settings.description_template, file);
    const videoId = settings.post_as_reels
      ? await uploadDriveVideoAsReel(file, caption, page)
      : await uploadDriveVideoToFacebook(file, settings.title_template, caption, page);

    // published successfully -> remove the source video from Drive for good
    let driveDeletedAt: string | null = null;
    try {
      await driveDeleteFile(file.id);
      driveDeletedAt = new Date().toISOString();
    } catch (e) {
      console.error("Gagal menghapus video di Drive", file.name, e);
    }

    await supabaseAdmin
      .from("upload_jobs")
      .update({
        status: "success",
        facebook_video_id: videoId,
        facebook_page_id: pageKey || null,
        published_at: new Date().toISOString(),
        drive_deleted_at: driveDeletedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id);


    await reschedule(settings.schedule_times ?? ["13:00", "17:00", "19:00"], pageKey);
    const pageName = page.name ? `[${page.name}] ` : "";
    return {
      checked: 1,
      uploaded: 1,
      failed: 0,
      skipped: 0,
      message: driveDeletedAt
        ? `${pageName}${file.name} tayang dan sudah dihapus dari Google Drive.`
        : `${pageName}${file.name} tayang, tetapi gagal dihapus dari Google Drive.`,
    };
  } catch (error) {
    console.error("Posting gagal", file.name, error);
    await supabaseAdmin
      .from("upload_jobs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id);
    return {
      checked: 1,
      uploaded: 0,
      failed: 1,
      skipped: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}


/* ------------------------------------------------------------------ */
/* Facebook performance numbers for videos that are already published  */
/* ------------------------------------------------------------------ */

export type VideoInsight = {
  jobId: string;
  fileName: string;
  videoId: string;
  permalink: string | null;
  publishedAt: string | null;
  plays: number;
  reach: number;
  likes: number;
  comments: number;
  avgWatchSeconds: number;
  error?: string;
};

type InsightEdge = {
  data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
};

function insightValue(insights: InsightEdge | undefined, name: string): number {
  const row = insights?.data?.find((item) => item.name === name);
  const raw = row?.values?.[0]?.value;
  return typeof raw === "number" ? raw : Number(raw ?? 0) || 0;
}

/** Reads the latest published videos and their live Facebook numbers. */
export async function getPublishedInsights(limit = 12): Promise<{
  ready: boolean;
  message?: string;
  fetchedAt: string;
  totals: { videos: number; plays: number; reach: number; likes: number; comments: number };
  videos: VideoInsight[];
}> {
  const fetchedAt = new Date().toISOString();
  const empty = {
    fetchedAt,
    totals: { videos: 0, plays: 0, reach: 0, likes: 0, comments: 0 },
    videos: [] as VideoInsight[],
  };

  const page = await loadActiveFacebookPage();
  if (!page) {
    return { ready: false, message: "Halaman Facebook belum diatur.", ...empty };
  }
  const token = page.access_token;


  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: jobs } = await supabaseAdmin
    .from("upload_jobs")
    .select("id,file_name,facebook_video_id,published_at,updated_at")
    .eq("status", "success")
    .not("facebook_video_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (!jobs || jobs.length === 0) {
    return { ready: true, ...empty };
  }

  const fields = [
    "permalink_url",
    "created_time",
    "likes.summary(true).limit(0)",
    "comments.summary(true).limit(0)",
    "video_insights.metric(blue_reels_play_count,post_impressions_unique,post_video_avg_time_watched)",
  ].join(",");

  const videos = await Promise.all(
    jobs.map(async (job): Promise<VideoInsight> => {
      const base: VideoInsight = {
        jobId: job.id,
        fileName: job.file_name,
        videoId: job.facebook_video_id as string,
        permalink: null,
        publishedAt: job.published_at ?? job.updated_at ?? null,
        plays: 0,
        reach: 0,
        likes: 0,
        comments: 0,
        avgWatchSeconds: 0,
      };
      try {
        const res = await fetch(
          `${GRAPH}/${job.facebook_video_id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
        );
        const json = (await res.json()) as {
          permalink_url?: string;
          created_time?: string;
          likes?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } };
          video_insights?: InsightEdge;
          error?: { message?: string };
        };
        if (!res.ok || json.error) {
          return { ...base, error: json.error?.message ?? `Gagal (${res.status})` };
        }
        const avgMs = insightValue(json.video_insights, "post_video_avg_time_watched");
        return {
          ...base,
          permalink: json.permalink_url
            ? json.permalink_url.startsWith("http")
              ? json.permalink_url
              : `https://www.facebook.com${json.permalink_url}`
            : `https://www.facebook.com/${job.facebook_video_id}`,
          publishedAt: json.created_time ?? base.publishedAt,
          plays: insightValue(json.video_insights, "blue_reels_play_count"),
          reach: insightValue(json.video_insights, "post_impressions_unique"),
          likes: json.likes?.summary?.total_count ?? 0,
          comments: json.comments?.summary?.total_count ?? 0,
          avgWatchSeconds: avgMs > 1000 ? Math.round(avgMs / 1000) : Math.round(avgMs),
        };
      } catch (error) {
        return { ...base, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  const totals = videos.reduce(
    (acc, video) => ({
      videos: acc.videos + 1,
      plays: acc.plays + video.plays,
      reach: acc.reach + video.reach,
      likes: acc.likes + video.likes,
      comments: acc.comments + video.comments,
    }),
    { videos: 0, plays: 0, reach: 0, likes: 0, comments: 0 },
  );

  return { ready: true, fetchedAt, totals, videos };
}
