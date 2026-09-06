import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type FacebookPage = {
  id: string;
  name: string | null;
  page_id: string;
  access_token: string;
  is_active: boolean;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
};

export type DashboardData = {
  settings: {
    drive_folder_id: string | null;
    drive_folder_name: string | null;
    auto_enabled: boolean;
    title_template: string;
    description_template: string;
    post_as_reels: boolean;
    schedule_times: string[];
    queue_limit: number;
    facebook_page_id: string | null;
  };
  facebookReady: boolean;
  driveReady: boolean;
  driveAccount: {
    connected: boolean;
    email: string | null;
    name: string | null;
    error?: string | undefined;
  };
  facebookPages: FacebookPage[];
  activeFacebookPageId: string | null;

  jobs: Array<{
    id: string;
    file_name: string;
    status: string;
    facebook_video_id: string | null;
    error_message: string | null;
    size_bytes: number | null;
    facebook_page_id: string | null;
    created_at: string;
    updated_at: string;
    scheduled_at: string | null;
    drive_deleted_at: string | null;
  }>;
};



export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select(
        "drive_folder_id,drive_folder_name,auto_enabled,title_template,description_template,post_as_reels,schedule_times,queue_limit,facebook_page_id",
      )
      .eq("id", "default")
      .maybeSingle();
    const { data: jobs } = await supabaseAdmin
      .from("upload_jobs")
      .select(
        "id,file_name,status,facebook_video_id,error_message,size_bytes,facebook_page_id,created_at,updated_at,scheduled_at,drive_deleted_at",
      )
      .order("updated_at", { ascending: false })
      .limit(50);

    const { data: pages } = await supabaseAdmin
      .from("facebook_pages")
      .select("id,name,page_id,access_token,is_active,drive_folder_id,drive_folder_name")
      .order("created_at", { ascending: true });

    const driveReady = Boolean(
      process.env["GOOGLE_DRIVE_API_KEY"] && process.env["LOVABLE_API_KEY"],
    );
    let driveAccount = {
      connected: false,
      email: null as string | null,
      name: null as string | null,
      error: "Google Drive belum tersambung." as string | undefined,
    };
    if (driveReady) {
      const { getDriveAccount } = await import("./sync.server");
      driveAccount = { ...(await getDriveAccount()), error: undefined };
      if (!driveAccount.connected) driveAccount.error = "Google Drive tidak bisa dihubungi.";
    }

    const activePageId = settings?.facebook_page_id ?? null;
    const hasPageInDb = Array.isArray(pages) && pages.length > 0;
    const hasLegacyPage = Boolean(
      process.env["FACEBOOK_PAGE_ID"] && process.env["FACEBOOK_PAGE_ACCESS_TOKEN"],
    );

    return {
      settings: settings ?? {
        drive_folder_id: null,
        drive_folder_name: null,
        auto_enabled: false,
        title_template: "{filename}",
        description_template: "",
        post_as_reels: true,
        schedule_times: ["13:00", "17:00", "19:00"],
        queue_limit: 10,
        facebook_page_id: null,
      },
      facebookReady: hasPageInDb || hasLegacyPage,
      driveReady,
      driveAccount,
      facebookPages: (pages ?? []) as unknown as FacebookPage[],
      activeFacebookPageId: activePageId,
      jobs: jobs ?? [],
    };

  },
);


export const listFolders = createServerFn({ method: "GET" })
  .inputValidator((input: { search?: string } | undefined) =>
    z.object({ search: z.string().max(80).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { listDriveFolders } = await import("./sync.server");
    return await listDriveFolders(data.search);
  });

export const listFolderVideos = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ folderId: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { listDriveVideos } = await import("./sync.server");
    return await listDriveVideos(data.folderId);
  });

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        driveFolderId: z.string().min(1).max(200),
        driveFolderName: z.string().min(1).max(200),
        autoEnabled: z.boolean(),
        titleTemplate: z.string().max(200),
        descriptionTemplate: z.string().max(2000),
        postAsReels: z.boolean(),
        scheduleTimes: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(6),
        queueLimit: z.number().int().min(1).max(50),
        facebookPageId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: "default",
        drive_folder_id: data.driveFolderId,
        drive_folder_name: data.driveFolderName,
        auto_enabled: data.autoEnabled,
        title_template: data.titleTemplate || "{filename}",
        description_template: data.descriptionTemplate,
        post_as_reels: data.postAsReels,
        schedule_times: data.scheduleTimes,
        queue_limit: data.queueLimit,
        facebook_page_id: data.facebookPageId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const addFacebookPage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(100),
        pageId: z.string().min(1).max(100),
        accessToken: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("facebook_pages")
      .insert({
        name: data.name,
        page_id: data.pageId,
        access_token: data.accessToken,
        is_active: true,
      })
      .select("id,name,page_id,access_token,is_active")
      .single();
    if (error) throw new Error(error.message);
    return inserted as unknown as FacebookPage;
  });

export const deleteFacebookPage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("facebook_pages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setActiveFacebookPage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ pageId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        { id: "default", facebook_page_id: data.pageId, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Maps a Facebook Page to its own Drive folder (or clears the mapping). */
export const setPageFolder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        pageId: z.string().uuid(),
        folderId: z.string().max(200).nullable(),
        folderName: z.string().max(200).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("facebook_pages")
      .update({
        drive_folder_id: data.folderId,
        drive_folder_name: data.folderName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.pageId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runSyncNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runSync } = await import("./sync.server");
  return await runSync({ force: true });
});


export const publishNextNow = createServerFn({ method: "POST" }).handler(async () => {
  const { publishNext } = await import("./sync.server");
  return await publishNext({ force: true });
});

export const retryJob = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("upload_jobs")
      .update({ status: "queued", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    const { runSync } = await import("./sync.server");
    return await runSync({ force: true });
  });

export const getInsights = createServerFn({ method: "GET" }).handler(async () => {
  const { getPublishedInsights } = await import("./sync.server");
  return await getPublishedInsights();
});

export type DiscoveredPage = {
  page_id: string;
  name: string;
  access_token: string;
  already_saved: boolean;
};

/** Reads every Facebook Page the given user access token can manage. */
export const discoverFacebookPages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ userToken: z.string().min(20).max(1000) }).parse(input),
  )
  .handler(async ({ data }): Promise<DiscoveredPage[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const url = new URL("https://graph.facebook.com/v21.0/me/accounts");
    url.searchParams.set("fields", "id,name,access_token");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", data.userToken);

    const res = await fetch(url.toString());
    const body = (await res.json()) as {
      data?: Array<{ id: string; name?: string; access_token?: string }>;
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      throw new Error(
        body.error?.message ?? `Facebook menolak token ini (kode ${res.status}).`,
      );
    }
    const pages = (body.data ?? []).filter((p) => p.id && p.access_token);
    if (pages.length === 0) {
      throw new Error("Token ini valid, tetapi tidak ada Halaman yang bisa dikelola.");
    }

    const { data: saved } = await supabaseAdmin.from("facebook_pages").select("page_id");
    const savedIds = new Set((saved ?? []).map((row) => String(row.page_id)));

    return pages.map((p) => ({
      page_id: p.id,
      name: p.name ?? p.id,
      access_token: p.access_token as string,
      already_saved: savedIds.has(p.id),
    }));
  });

/** Saves (or refreshes) several Facebook Pages at once. */
export const addFacebookPages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        pages: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              pageId: z.string().min(1).max(100),
              accessToken: z.string().min(1).max(1000),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const saved: FacebookPage[] = [];
    for (const page of data.pages) {
      const { data: existing } = await supabaseAdmin
        .from("facebook_pages")
        .select("id")
        .eq("page_id", page.pageId)
        .maybeSingle();

      if (existing?.id) {
        const { data: updated, error } = await supabaseAdmin
          .from("facebook_pages")
          .update({ name: page.name, access_token: page.accessToken, is_active: true })
          .eq("id", existing.id)
          .select("id,name,page_id,access_token,is_active")
          .single();
        if (error) throw new Error(error.message);
        saved.push(updated as unknown as FacebookPage);
      } else {
        const { data: inserted, error } = await supabaseAdmin
          .from("facebook_pages")
          .insert({
            name: page.name,
            page_id: page.pageId,
            access_token: page.accessToken,
            is_active: true,
          })
          .select("id,name,page_id,access_token,is_active")
          .single();
        if (error) throw new Error(error.message);
        saved.push(inserted as unknown as FacebookPage);
      }
    }
    return saved;
  });
