import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseVisitorKey, requireVisitorKey } from "@/lib/guestbook/visitor";

const ContentTypeSchema = z.enum(["plain", "md"]).default("plain");

const PostBodySchema = z.object({
  authorName: z.string().trim().max(40).optional(),
  content: z.string().trim().min(1).max(5000),
  contentType: ContentTypeSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
});

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

type EntryRow = {
  id: string;
  created_at: string;
  author_key: string;
  author_name: string | null;
  content: string;
  content_type: string;
  parent_id: string | null;
  deleted_at: string | null;
};

type ReactionRow = { entry_id: string; user_key: string; value: number };
type ParentRow = { id: string; parent_id: string | null; deleted_at: string | null };

export async function GET(req: Request) {
  try {
    const visitorKey = parseVisitorKey(req);
    const url = new URL(req.url);
    const parentId = url.searchParams.get("parentId");
    const limit = intParam(url, "limit", 20);
    const search = url.searchParams.get("search")?.trim();
    const withCounts = url.searchParams.get("withCounts") === "1";
    const status = (url.searchParams.get("status") ?? "active").toLowerCase();

    const supabase = createSupabaseServerClient();

    let q = supabase
      .from("guestbook_entries")
      .select(
        "id, created_at, author_key, author_name, content, content_type, parent_id, deleted_at"
      )
      .limit(limit);

    if (parentId) {
      q = q.eq("parent_id", parentId).order("created_at", { ascending: true });
    } else {
      q = q.is("parent_id", null).order("created_at", { ascending: false });
    }
    // status: active | deleted | all（默认 active）
    if (status === "active") q = q.is("deleted_at", null);
    else if (status === "deleted") q = q.not("deleted_at", "is", null);
    // status === "all" 不加过滤

    if (search) {
      if (status === "deleted") {
        q = q.or(`author_name.ilike.%${search}%`);
      } else {
        q = q.or(`content.ilike.%${search}%,author_name.ilike.%${search}%`);
      }
    }

    const { data: rows, error } = await q;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const entries = (rows ?? []) as EntryRow[];
    const ids = entries.map((e) => e.id);

    const reactionByEntry: Record<string, { like: number; dislike: number; my: 1 | -1 | 0 }> =
      Object.fromEntries(ids.map((id) => [id, { like: 0, dislike: 0, my: 0 }]));

    if (ids.length > 0) {
      const { data: rs, error: rErr } = await supabase
        .from("guestbook_reactions")
        .select("entry_id, user_key, value")
        .in("entry_id", ids);

      if (rErr) {
        return NextResponse.json({ success: false, error: rErr.message }, { status: 500 });
      }

      for (const r of (rs ?? []) as ReactionRow[]) {
        const bucket = reactionByEntry[r.entry_id];
        if (!bucket) continue;
        if (r.value === 1) bucket.like += 1;
        if (r.value === -1) bucket.dislike += 1;
        if (visitorKey && r.user_key === visitorKey && (r.value === 1 || r.value === -1)) {
          bucket.my = r.value as 1 | -1;
        }
      }
    }

    const commentCountByEntry: Record<string, number> = Object.fromEntries(
      ids.map((id) => [id, 0])
    );

    if (!parentId && ids.length > 0 && status !== "deleted") {
      const { data: cs, error: cErr } = await supabase
        .from("guestbook_entries")
        .select("parent_id")
        .in("parent_id", ids)
        .is("deleted_at", null);

      if (cErr) {
        return NextResponse.json({ success: false, error: cErr.message }, { status: 500 });
      }

      for (const c of (cs ?? []) as { parent_id: string | null }[]) {
        if (!c.parent_id) continue;
        commentCountByEntry[c.parent_id] = (commentCountByEntry[c.parent_id] ?? 0) + 1;
      }
    }

    let counts: { active: number; deleted: number } | undefined;

if (withCounts) {
  const base = supabase.from("guestbook_entries");

  const [{ count: activeCount, error: aErr }, { count: deletedCount, error: dErr }] =
    await Promise.all([
      base
        .select("id", { count: "exact", head: true })
        .is("parent_id", null)
        .is("deleted_at", null),
      base
        .select("id", { count: "exact", head: true })
        .is("parent_id", null)
        .not("deleted_at", "is", null),
    ]);

  if (aErr)
    return NextResponse.json({ success: false, error: aErr.message }, { status: 500 });
  if (dErr)
    return NextResponse.json({ success: false, error: dErr.message }, { status: 500 });

  counts = {
    active: activeCount ?? 0,
    deleted: deletedCount ?? 0,
  };
}

    return NextResponse.json({
      success: true,
      counts,
      data: entries.map((e) => {
        const stats = reactionByEntry[e.id] ?? { like: 0, dislike: 0, my: 0 };
        const deleted = Boolean(e.deleted_at);
        return {
          id: e.id,
          createdAt: e.created_at,
          parentId: e.parent_id,
          authorName: e.author_name,
          content: deleted ? "" : e.content,
          contentType: e.content_type,
          deleted,
          mine: Boolean(visitorKey && e.author_key === visitorKey),
          stats: {
            like: stats.like,
            dislike: stats.dislike,
            myReaction: stats.my,
            commentCount: parentId ? undefined : (commentCountByEntry[e.id] ?? 0),
          },
        };
      }),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const visitorKey = requireVisitorKey(req);
    const raw = await req.json().catch(() => null);
    const parsed = PostBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { authorName, content, contentType, parentId } = parsed.data;
    const supabase = createSupabaseServerClient();

    if (parentId) {
      const { data: parent, error: pErr } = await supabase
        .from("guestbook_entries")
        .select("id, parent_id, deleted_at")
        .eq("id", parentId)
        .maybeSingle();

      if (pErr) {
        return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
      }
      if (!parent) {
        return NextResponse.json({ success: false, error: "Parent not found" }, { status: 404 });
      }
      const p = parent as ParentRow;
      if (p.deleted_at) {
        return NextResponse.json(
          { success: false, error: "Cannot comment on deleted entry" },
          { status: 400 }
        );
      }
      // Removed the one-level comment restriction to allow nested replies
    }

    const { data, error } = await supabase
  .from("guestbook_entries")
  .insert({
    visitor_id: visitorKey,              // ✅ 新增：满足 NOT NULL
    author_key: visitorKey,              // ✅ 继续保留：兼容你现有查询逻辑（mine 用它）
    author_name: authorName?.trim() || null,
    content,
    content_type: contentType ?? "plain",
    parent_id: parentId ?? null,
  })
  .select("id")
  .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id !== "string") {
      return NextResponse.json(
        { success: false, error: "Failed to create entry" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("x-visitor-id") ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}