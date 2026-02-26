import { NextResponse } from "next/server";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseServer();
  const { data: u, error: uErr } = await sb.auth.getUser();
  const userId = u.user?.id;
  if (uErr || !userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const svc = createSupabaseServiceRoleClient();
  const { data, error } = await svc
    .from("guestbook_entries")
    .select("id, created_at, content, parent_id, root_id, reply_to_name, status, deleted_at")
    .eq("author_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    content: r.content,
    parentId: r.parent_id,
    rootId: r.root_id,
    replyToName: r.reply_to_name,
    deleted: r.status === "deleted" || Boolean(r.deleted_at),
  }));

  return NextResponse.json({ ok: true, items }, { status: 200 });
}
