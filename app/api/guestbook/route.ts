import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ContentTypeSchema = z.enum(["plain", "md"]).default("plain");

const ParentIdSchema = z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable());

const PostBodySchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    contentType: ContentTypeSchema.optional(),
    parentId: ParentIdSchema.optional(),
    parent_id: ParentIdSchema.optional(),
  })
  .transform((v) => ({
    content: v.content,
    contentType: v.contentType,
    parentId: v.parentId ?? v.parent_id ?? null,
  }));

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

type EntryRow = {
  id: string;
  created_at: string;
  parent_id: string | null;
  root_id: string | null;
  depth: number | null;
  reply_to_user_id: string | null;
  reply_to_name: string | null;
  status: string | null;
  author_name: string | null;
  author_is_admin: boolean | null;
  author_user_id: string | null;
  author_key: string;
  content: string;
  content_type: string;
  deleted_at: string | null;
};

function toPayload(row: EntryRow, opts: { viewerUserId: string | null; myReaction: -1 | 0 | 1; like: number; dislike: number; commentCount: number }) {
  const viewer = opts.viewerUserId;
  return {
    id: row.id,
    createdAt: row.created_at,
    parentId: row.parent_id,
    rootId: row.root_id,
    depth: row.depth ?? 0,
    replyToUserId: row.reply_to_user_id,
    replyToName: row.reply_to_name,
    authorName: row.author_name,
    authorIsAdmin: Boolean(row.author_is_admin),
    content: row.content,
    contentType: row.content_type,
    deleted: row.status === "deleted" || Boolean(row.deleted_at),
    mine: viewer ? row.author_user_id === viewer : false,
    stats: {
      like: opts.like,
      dislike: opts.dislike,
      myReaction: opts.myReaction,
      commentCount: opts.commentCount,
    },
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const parentIdRaw = url.searchParams.get("parentId");
    const parentIdParsed = parentIdRaw ? z.string().uuid().safeParse(parentIdRaw) : null;
    if (parentIdRaw && !parentIdParsed?.success) {
      return NextResponse.json({ success: false, error: "Invalid parentId (uuid required)" }, { status: 400 });
    }
    const parentId = parentIdParsed?.success ? parentIdParsed.data : null;

    const limit = intParam(url, "limit", 20);
    const page = intParam(url, "page", 1);
    const search = url.searchParams.get("search")?.trim() || null;
    const withCounts = url.searchParams.get("withCounts") === "1";
    const status = (url.searchParams.get("status") ?? "active").toLowerCase();

    // viewer（可为空：允许匿名浏览）
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const viewerUserId = u.user?.id ?? null;

    // 用 service role 做读（省心；不吃 RLS），但 mine/myReaction 依据 viewerUserId 计算
    const svc = createSupabaseServiceRoleClient();

    // ---- 列表查询：只拉 root（parent_id is null）或指定 parentId ----
    let q = svc
      .from("guestbook_entries")
      .select("id, created_at, parent_id, root_id, depth, reply_to_user_id, reply_to_name, status, author_name, author_is_admin, author_user_id, author_key, content, content_type, deleted_at")
      .limit(limit);

    if (parentId) {
      q = q.eq("parent_id", parentId).order("created_at", { ascending: true });
    } else {
      q = q.is("parent_id", null).order("created_at", { ascending: false });
    }

    if (status === "active") q = q.eq("status", "active");
    if (status === "deleted") q = q.eq("status", "deleted");

    if (search) q = q.ilike("content", `%${search}%`);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    q = q.range(from, to);

    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const list = (rows ?? []) as EntryRow[];
    const ids = list.map((r) => r.id);

    // ---- counts（active/deleted） ----
    let counts: { active?: number; deleted?: number } | undefined = undefined;
    if (withCounts) {
      const [activeCnt, deletedCnt] = await Promise.all([
        svc
          .from("guestbook_entries")
          .select("id", { count: "estimated", head: true })
          .is("parent_id", null)
          .eq("status", "active"),
        svc
          .from("guestbook_entries")
          .select("id", { count: "estimated", head: true })
          .is("parent_id", null)
          .eq("status", "deleted"),
      ]);

      counts = {
        active: typeof activeCnt.count === "number" ? activeCnt.count : 0,
        deleted: typeof deletedCnt.count === "number" ? deletedCnt.count : 0,
      };
    }

    // ---- 批量统计：like/dislike/commentCount ----
    // 说明：为了可用性，这里走“行数计数”方式（ids 不大时足够稳定）
    const [reactionsRes, commentRes] = ids.length
      ? await Promise.all([
          svc
            .from("guestbook_reactions")
            .select("entry_id, value, visitor_id")
            .in("entry_id", ids),
          svc
            .from("guestbook_entries")
            .select("id, parent_id")
            .in("parent_id", ids)
            .eq("status", "active"),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

    if (reactionsRes.error) return NextResponse.json({ success: false, error: reactionsRes.error.message }, { status: 500 });
    if (commentRes.error) return NextResponse.json({ success: false, error: commentRes.error.message }, { status: 500 });

    const likeMap = new Map<string, number>();
    const dislikeMap = new Map<string, number>();
    const myReactionMap = new Map<string, -1 | 0 | 1>();
    const commentCountMap = new Map<string, number>();

    // reactions
    for (const r of (reactionsRes.data ?? []) as Array<{ entry_id: string; value: number; visitor_id?: string }>) {
      if (r.value === 1) likeMap.set(r.entry_id, (likeMap.get(r.entry_id) ?? 0) + 1);
      if (r.value === -1) dislikeMap.set(r.entry_id, (dislikeMap.get(r.entry_id) ?? 0) + 1);

      // 方案A：visitor_id = auth.uid()::text
      if (viewerUserId && (r as any).visitor_id === viewerUserId) {
        if (r.value === 1 || r.value === -1) myReactionMap.set(r.entry_id, r.value as -1 | 0 | 1);
      }
    }

    // comment count
    for (const c of (commentRes.data ?? []) as Array<{ parent_id: string | null }>) {
      const pid = c.parent_id;
      if (!pid) continue;
      commentCountMap.set(pid, (commentCountMap.get(pid) ?? 0) + 1);
    }

    const userIds = Array.from(new Set(list.map((r) => r.author_user_id).filter(Boolean))) as string[];
    const nameMap = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles } = await svc
        .from("user_profiles")
        .select("user_id, username")
        .in("user_id", userIds);
      for (const p of (profiles ?? []) as Array<{ user_id: string; username: string }>) {
        if (p.user_id && p.username) nameMap.set(p.user_id, p.username);
      }
    }

    const data = list.map((row) => {
      const payload = toPayload(row, {
        viewerUserId,
        myReaction: viewerUserId ? (myReactionMap.get(row.id) ?? 0) : 0,
        like: likeMap.get(row.id) ?? 0,
        dislike: dislikeMap.get(row.id) ?? 0,
        commentCount: commentCountMap.get(row.id) ?? 0,
      });
      const latestName = row.author_user_id ? nameMap.get(row.author_user_id) : undefined;
      return latestName ? { ...payload, authorName: latestName } : payload;
    });

    return NextResponse.json({ success: true, counts, page, limit, data });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // 必须登录：评论/发帖都需要 user
    const sb = supabaseServer();
    const { data: u, error: uErr } = await sb.auth.getUser();
    const userId = u.user?.id;
    if (uErr || !userId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const raw = await req.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    const { content, contentType, parentId } = parsed.data;
    if ((content.match(/https?:\/\/|www\./gi) ?? []).length > 3) {
      return NextResponse.json({ success: false, error: "链接过多" }, { status: 400 });
    }
    const meta = (u.user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName =
      (typeof meta.name === "string" && meta.name.trim()) ||
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      null;
    const emailPrefix = (u.user?.email ?? "").split("@")[0] || null;
    const authorName = metaName || emailPrefix || "用户";
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    const isAdmin = !!adminEmail && (u.user?.email ?? "").trim().toLowerCase() === adminEmail;

    // 写入用 RLS（entries_insert_own），author_user_id 必须 = auth.uid()
    // 这里直接用 sb（cookie session client）
    if (parentId) {
      const { data: parent, error: pErr } = await sb
        .from("guestbook_entries")
        .select("id, parent_id, root_id, depth, author_user_id, author_name, status, deleted_at")
        .eq("id", parentId)
        .maybeSingle();

      if (pErr) return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
      if (!parent) return NextResponse.json({ success: false, error: "Parent not found" }, { status: 404 });
      if ((parent as { deleted_at: string | null }).deleted_at || (parent as any).status === "deleted") {
        return NextResponse.json({ success: false, error: "Cannot comment on deleted entry" }, { status: 400 });
      }
    }

    const visitorId = req.headers.get("x-visitor-id") || userId;
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;

    const svc = createSupabaseServiceRoleClient();
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const [userRate, ipRate] = await Promise.all([
      svc
        .from("guestbook_entries")
        .select("id", { count: "estimated", head: true })
        .eq("author_user_id", userId)
        .gte("created_at", since),
      ip
        ? svc
            .from("guestbook_entries")
            .select("id", { count: "estimated", head: true })
            .eq("ip", ip)
            .gte("created_at", since)
        : Promise.resolve({ count: 0 }),
    ]);

    if ((userRate.count ?? 0) >= 5) {
      return NextResponse.json({ success: false, error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }
    if (ip && (ipRate.count ?? 0) >= 5) {
      return NextResponse.json({ success: false, error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }

    let rootId: string | null = null;
    let depth = 0;
    let replyToUserId: string | null = null;
    let replyToName: string | null = null;

    if (parentId) {
      const { data: parent } = await svc
        .from("guestbook_entries")
        .select("id, root_id, depth, author_user_id, author_name")
        .eq("id", parentId)
        .maybeSingle();
      rootId = (parent as any)?.root_id ?? (parent as any)?.id ?? null;
      depth = Math.min(((parent as any)?.depth ?? 0) + 1, 5);
      replyToUserId = (parent as any)?.author_user_id ?? null;
      replyToName = (parent as any)?.author_name ?? null;
    }

    const { data, error } = await sb
      .from("guestbook_entries")
      .insert({
        root_id: rootId,
        depth,
        reply_to_user_id: replyToUserId,
        reply_to_name: replyToName,
        status: "active",
        ip,
        visitor_id: visitorId,
        author_user_id: userId,
        // 兼容字段（可保留）
        author_key: visitorId,
        author_name: authorName,
        author_is_admin: isAdmin,
        content,
        content_type: contentType ?? "plain",
        parent_id: parentId ?? null,
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id !== "string") {
      return NextResponse.json({ success: false, error: "Failed to create entry" }, { status: 500 });
    }
    if (!rootId) {
      await svc.from("guestbook_entries").update({ root_id: id }).eq("id", id);
    }

    return NextResponse.json({ success: true, id });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
