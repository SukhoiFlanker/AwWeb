import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseVisitorKey, requireVisitorKey } from "@/lib/guestbook/visitor";

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

async function loadStats(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ids: string[],
  visitorKey: string | null
) {
  const stats: Record<string, { like: number; dislike: number; my: 1 | -1 | 0 }> =
    Object.fromEntries(ids.map((id) => [id, { like: 0, dislike: 0, my: 0 }]));

  if (ids.length === 0) return stats;

  const { data: rs, error } = await supabase
    .from("guestbook_reactions")
    .select("entry_id, user_key, value")
    .in("entry_id", ids);

  if (error) throw new Error(error.message);

  for (const r of (rs ?? []) as ReactionRow[]) {
    const s = stats[r.entry_id];
    if (!s) continue;
    if (r.value === 1) s.like += 1;
    if (r.value === -1) s.dislike += 1;
    if (visitorKey && r.user_key === visitorKey && (r.value === 1 || r.value === -1)) {
      s.my = r.value as 1 | -1;
    }
  }
  return stats;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const visitorKey = parseVisitorKey(req);
    const url = new URL(req.url);
    const includeComments = url.searchParams.get("includeComments") !== "0";

    const supabase = createSupabaseServerClient();
    const { data: entry, error } = await supabase
      .from("guestbook_entries")
      .select(
        "id, created_at, author_key, author_name, content, content_type, parent_id, deleted_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!entry) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const entryRow = entry as EntryRow;

    let comments: EntryRow[] = [];
    if (includeComments) {
      // Load all descendants recursively
      const allComments: EntryRow[] = [];
      const queue = [id];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const { data: cs, error: cErr } = await supabase
          .from("guestbook_entries")
          .select(
            "id, created_at, author_key, author_name, content, content_type, parent_id, deleted_at"
          )
          .eq("parent_id", currentId)
          .order("created_at", { ascending: true });

        if (cErr) {
          return NextResponse.json({ success: false, error: cErr.message }, { status: 500 });
        }

        const currentComments = (cs ?? []) as EntryRow[];
        allComments.push(...currentComments);
        queue.push(...currentComments.map(c => c.id));
      }

      comments = allComments;
    }

    const ids = [id, ...comments.map((c) => c.id)];
    const statsById = await loadStats(supabase, ids, visitorKey);

    return NextResponse.json({
      success: true,
      entry: {
        id: entryRow.id,
        createdAt: entryRow.created_at,
        parentId: entryRow.parent_id,
        authorName: entryRow.author_name,
        content: entryRow.deleted_at ? "" : entryRow.content,
        contentType: entryRow.content_type,
        deleted: Boolean(entryRow.deleted_at),
        mine: Boolean(visitorKey && entryRow.author_key === visitorKey),
        stats: {
          like: statsById[id]?.like ?? 0,
          dislike: statsById[id]?.dislike ?? 0,
          myReaction: statsById[id]?.my ?? 0,
        },
      },
      comments: comments.map((c) => ({
        id: c.id,
        createdAt: c.created_at,
        parentId: c.parent_id,
        authorName: c.author_name,
        content: c.deleted_at ? "" : c.content,
        contentType: c.content_type,
        deleted: Boolean(c.deleted_at),
        mine: Boolean(visitorKey && c.author_key === visitorKey),
        stats: {
          like: statsById[c.id]?.like ?? 0,
          dislike: statsById[c.id]?.dislike ?? 0,
          myReaction: statsById[c.id]?.my ?? 0,
        },
      })),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const visitorKey = requireVisitorKey(req);
    const { id } = await ctx.params;
    const supabase = createSupabaseServerClient();

    const { data: entry, error: loadErr } = await supabase
      .from("guestbook_entries")
      .select("id, author_key, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (loadErr) {
      return NextResponse.json({ success: false, error: loadErr.message }, { status: 500 });
    }
    if (!entry) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const row = entry as { author_key?: string; deleted_at?: string | null };
    if (row.author_key !== visitorKey) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    if (row.deleted_at) {
      return NextResponse.json({ success: true });
    }

    const { error: delErr } = await supabase
      .from("guestbook_entries")
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        content: "",
      })
      .eq("id", id);

    if (delErr) {
      return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("x-visitor-id") ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
