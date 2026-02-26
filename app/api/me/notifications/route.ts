import { NextResponse } from "next/server";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NotificationItem = {
  type: "comment" | "reaction";
  createdAt: string;
  entryId: string;
  content?: string;
  authorName?: string | null;
  value?: number;
  parentId?: string | null;
  rootId?: string | null;
};

export async function GET() {
  const sb = supabaseServer();
  const { data: u, error: uErr } = await sb.auth.getUser();
  const userId = u.user?.id;
  if (uErr || !userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const svc = createSupabaseServiceRoleClient();

  const { data: commentsRes } = await svc
    .from("guestbook_entries")
    .select("id, created_at, content, author_name, parent_id, root_id, author_user_id, status, deleted_at")
    .eq("reply_to_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  const comments: NotificationItem[] = (commentsRes ?? [])
    .filter((c: any) => c.author_user_id !== userId && !(c.status === "deleted" || c.deleted_at))
    .map((c: any) => ({
      type: "comment",
      createdAt: c.created_at,
      entryId: c.id,
      content: c.content,
      authorName: c.author_name ?? null,
      parentId: c.parent_id ?? null,
      rootId: c.root_id ?? null,
    }));

  const { data: myEntries } = await svc
    .from("guestbook_entries")
    .select("id")
    .eq("author_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  const ids = (myEntries ?? []).map((e: any) => e.id);
  let reactions: NotificationItem[] = [];
  if (ids.length) {
    const { data: reacts } = await svc
      .from("guestbook_reactions")
      .select("entry_id, value, created_at, visitor_id")
      .in("entry_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);

    reactions = (reacts ?? [])
      .filter((r: any) => r.visitor_id !== userId)
      .map((r: any) => ({
      type: "reaction",
      createdAt: r.created_at,
      entryId: r.entry_id,
      value: r.value,
    }));
  }

  const merged = [...comments, ...reactions].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }).slice(0, 50);

  return NextResponse.json({ ok: true, items: merged }, { status: 200 });
}
