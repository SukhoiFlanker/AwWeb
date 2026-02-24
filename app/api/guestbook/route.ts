import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ContentTypeSchema = z.enum(["plain", "md"]).default("plain");

const ParentIdSchema = z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable());

const PostBodySchema = z
  .object({
    authorName: z.string().trim().max(40).optional(),
    content: z.string().trim().min(1).max(5000),
    contentType: ContentTypeSchema.optional(),
    parentId: ParentIdSchema.optional(),
    parent_id: ParentIdSchema.optional(),
  })
  .transform((v) => ({
    authorName: v.authorName,
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
  author_name: string | null;
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
    authorName: row.author_name,
    content: row.content,
    contentType: row.content_type,
    deleted: Boolean(row.deleted_at),
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
      .select("id, created_at, parent_id, author_name, author_user_id, author_key, content, content_type, deleted_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (parentId) q = q.eq("parent_id", parentId);
    else q = q.is("parent_id", null);

    if (status === "active") q = q.is("deleted_at", null);
    if (status === "deleted") q = q.not("deleted_at", "is", null);

    if (search) q = q.ilike("content", `%${search}%`);

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
          .is("deleted_at", null),
        svc
          .from("guestbook_entries")
          .select("id", { count: "estimated", head: true })
          .is("parent_id", null)
          .not("deleted_at", "is", null),
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
            .select("entry_id, value")
            .in("entry_id", ids),
          svc
            .from("guestbook_entries")
            .select("id, parent_id")
            .in("parent_id", ids)
            .is("deleted_at", null),
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

    const data = list.map((row) =>
      toPayload(row, {
        viewerUserId,
        myReaction: viewerUserId ? (myReactionMap.get(row.id) ?? 0) : 0,
        like: likeMap.get(row.id) ?? 0,
        dislike: dislikeMap.get(row.id) ?? 0,
        commentCount: commentCountMap.get(row.id) ?? 0,
      })
    );

    return NextResponse.json({ success: true, counts, data });
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

    const { authorName, content, contentType, parentId } = parsed.data;

    // 写入用 RLS（entries_insert_own），author_user_id 必须 = auth.uid()
    // 这里直接用 sb（cookie session client）
    if (parentId) {
      const { data: parent, error: pErr } = await sb
        .from("guestbook_entries")
        .select("id, deleted_at")
        .eq("id", parentId)
        .maybeSingle();

      if (pErr) return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
      if (!parent) return NextResponse.json({ success: false, error: "Parent not found" }, { status: 404 });
      if ((parent as { deleted_at: string | null }).deleted_at) {
        return NextResponse.json({ success: false, error: "Cannot comment on deleted entry" }, { status: 400 });
      }
    }

    const { data, error } = await sb
      .from("guestbook_entries")
      .insert({
        author_user_id: userId,
        // 兼容字段（可保留）
        author_key: userId,
        author_name: authorName?.trim() || null,
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

    return NextResponse.json({ success: true, id });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}