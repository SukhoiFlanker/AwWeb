import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const p = ParamsSchema.safeParse(ctx.params);
    if (!p.success) return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return NextResponse.json({ success: false, error: "ADMIN_EMAIL not set" }, { status: 500 });

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const email = u.user?.email ?? "";
    if (!email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (email !== adminEmail) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    const svc = createSupabaseServiceRoleClient();
    const { error } = await svc.from("guestbook_entries").delete().eq("id", p.data.id);

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}