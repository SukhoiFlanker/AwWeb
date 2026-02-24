import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  content: z.string().min(1).max(20000),
  contentType: z.string().min(1).max(32).optional().default("md"),
  authorName: z.string().max(80).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const sb = supabaseServer();
    const { data: u, error: uErr } = await sb.auth.getUser();
    const userId = u.user?.id;
    if (uErr || !userId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const raw: unknown = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    const { content, contentType, authorName, parentId } = parsed.data;

    const { data, error } = await sb
      .from("guestbook_entries")
      .insert({
        parent_id: parentId ?? null,
        author_user_id: userId,
        // 兼容字段：保留你原来的 author_key/author_name
        author_key: userId, // text 字段的话 OK
        author_name: authorName ?? null,
        content,
        content_type: contentType,
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}