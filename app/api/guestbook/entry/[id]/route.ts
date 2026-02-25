import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { parseVisitorKey } from "@/lib/guestbook/visitor";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const params = await ctx.params;
    const p = ParamsSchema.safeParse(params);
    if (!p.success) return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return NextResponse.json({ success: false, error: "ADMIN_EMAIL not set" }, { status: 500 });

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const email = u.user?.email ?? "";
    const visitorKey = parseVisitorKey(req);
    if (!userId && !visitorKey) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const svc = createSupabaseServiceRoleClient();
    const { data: row, error: rowErr } = await svc
      .from("guestbook_entries")
      .select("id, author_user_id, author_key")
      .eq("id", p.data.id)
      .maybeSingle();

    if (rowErr) return NextResponse.json({ success: false, error: rowErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

    const isAdmin = email && email === adminEmail;
    const isOwnerByUser = userId && row.author_user_id === userId;
    const isOwnerByVisitor = visitorKey && row.author_key === visitorKey;
    if (!isAdmin && !isOwnerByUser && !isOwnerByVisitor) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { error } = await svc
      .from("guestbook_entries")
      .update({ status: "deleted", deleted_at: new Date().toISOString() })
      .eq("id", p.data.id);

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
