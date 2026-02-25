import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
  contentType: z.enum(["plain", "md"]).default("md"),
});

function isAdminEmail(email: string | null | undefined) {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const e = (email ?? "").trim().toLowerCase();
  return !!adminEmail && e === adminEmail;
}

export async function GET() {
  const svc = createSupabaseServiceRoleClient();
  const { data, error } = await svc
    .from("feedback_announcements")
    .select("id, created_at, author_name, author_is_admin, content, content_type")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, items: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(u.user.email)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
  }

  const meta = (u.user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName =
    (typeof meta.name === "string" && meta.name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    null;
  const emailPrefix = (u.user.email ?? "").split("@")[0] || null;
  const authorName = metaName || emailPrefix || "管理员";

  const svc = createSupabaseServiceRoleClient();
  const { error } = await svc.from("feedback_announcements").insert({
    author_user_id: u.user.id,
    author_name: authorName,
    author_is_admin: true,
    content: parsed.data.content,
    content_type: parsed.data.contentType,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
