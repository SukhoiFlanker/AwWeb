import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { parseVisitorKey } from "@/lib/guestbook/visitor";

export const dynamic = "force-dynamic";

/* ---------------- utils ---------------- */

function formatErr(e: unknown) {
  if (e instanceof Error) {
    return e.message || e.name || "Error";
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

const UuidSchema = z.string().uuid();

/* ---------------- types ---------------- */

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

type EntryRow = {
  id: string;
  created_at: string;
  parent_id: string | null;
  author_key: string;
  author_name: string | null;
  content: string;
  content_type: string;
  deleted_at: string | null;
};

/* ---------------- handler ---------------- */

export async function GET(req: Request, context: RouteContext) {
  try {
    const visitorKey = parseVisitorKey(req);
    const url = new URL(req.url);

    // ---------- route param ----------
    const resolved = await context.params;
    const idRaw = resolved?.id;
    if (!idRaw) {
      return NextResponse.json(
        { success: false, error: "Missing id" },
        { status: 400 }
      );
    }

    const parsed = UuidSchema.safeParse(idRaw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid id (uuid required)" },
        { status: 400 }
      );
    }

    const id = parsed.data;

    // ---------- query ----------
    const includeComments =
      ["1", "true"].includes(
        (url.searchParams.get("includeComments") ?? "").toLowerCase()
      );

    const limit = intParam(url, "limit", 50);
    const search = url.searchParams.get("search")?.trim() || null;
    const status = (url.searchParams.get("status") ?? "active").toLowerCase();
    const withCounts = url.searchParams.get("withCounts") === "1";

    const svc = createSupabaseServiceRoleClient();

    // ---------- 主 entry ----------
    const { data: entry, error: entryErr } = await svc
      .from("guestbook_entries")
      .select(
        "id, created_at, parent_id, author_key, author_name, content, content_type, deleted_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (entryErr) {
      console.error("[guestbook][id] entry error", entryErr);
      return NextResponse.json(
        { success: false, error: entryErr.message },
        { status: 500 }
      );
    }

    if (!entry) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    const row = entry as EntryRow;

    // ---------- 统计（不使用 head:true + count，避免空 error） ----------
    const statsErrors: Record<string, unknown> = {};

    const [likeRowsRes, dislikeRowsRes, commentCountRes] = await Promise.all([
      svc
        .from("guestbook_reactions")
        .select("entry_id")
        .eq("entry_id", id)
        .eq("value", 1),

      svc
        .from("guestbook_reactions")
        .select("entry_id")
        .eq("entry_id", id)
        .eq("value", -1),

      svc
        .from("guestbook_entries")
        .select("id", { count: "estimated", head: true })
        .eq("parent_id", id)
        .is("deleted_at", null),
    ]);

    if (likeRowsRes.error) statsErrors.like = likeRowsRes.error;
    if (dislikeRowsRes.error) statsErrors.dislike = dislikeRowsRes.error;
    if (commentCountRes.error) statsErrors.commentCount = commentCountRes.error;

    const like =
      likeRowsRes.error ? 0 : Array.isArray(likeRowsRes.data) ? likeRowsRes.data.length : 0;

    const dislike =
      dislikeRowsRes.error ? 0 : Array.isArray(dislikeRowsRes.data) ? dislikeRowsRes.data.length : 0;

    const commentCount =
      commentCountRes.error ? 0 : typeof commentCountRes.count === "number" ? commentCountRes.count : 0;

    if (Object.keys(statsErrors).length > 0) {
      console.error("[guestbook][id] statsErrors raw", statsErrors);
    }

    let myReaction: -1 | 0 | 1 = 0;

    if (visitorKey) {
      const { data: myRow } = await svc
        .from("guestbook_reactions")
        .select("value")
        .eq("entry_id", id)
        .eq("user_key", visitorKey)
        .maybeSingle();

      const v = (myRow as { value?: unknown } | null)?.value;
      if (v === 1 || v === -1) myReaction = v;
    }

    const entryPayload = {
      id: row.id,
      createdAt: row.created_at,
      parentId: row.parent_id,
      authorName: row.author_name,
      content: row.content,
      contentType: row.content_type,
      deleted: Boolean(row.deleted_at),
      mine: visitorKey ? row.author_key === visitorKey : false,
      stats: {
        like,
        dislike,
        myReaction,
        commentCount,
        statsErrors: Object.keys(statsErrors).length ? statsErrors : undefined,
      },
    };

    // ---------- 子评论（不再使用 RPC） ----------
    let comments: unknown[] = [];
    let counts: unknown = undefined;

    if (includeComments) {
      let q = svc
        .from("guestbook_entries")
        .select(
          "id, created_at, parent_id, author_key, author_name, content, content_type, deleted_at"
        )
        .eq("parent_id", id);

      if (status === "active") q = q.is("deleted_at", null);
      if (status === "deleted") q = q.not("deleted_at", "is", null);
      if (search) q = q.ilike("content", `%${search}%`);

      const { data, error } = await q
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        console.error("[guestbook][id] comments error", error);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      comments = Array.isArray(data) ? data : [];
      counts = withCounts ? { returned: comments.length } : undefined;
    }

    return NextResponse.json({
      success: true,
      entry: entryPayload,
      comments,
      counts,
      data: comments, // 兼容旧前端
    });
  } catch (e: unknown) {
    console.error("[guestbook][id] crashed", e);
    return NextResponse.json(
      { success: false, error: formatErr(e) },
      { status: 500 }
    );
  }
}