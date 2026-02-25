import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  name: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_]+$/),
});

export async function PATCH(req: Request) {
  const sb = supabaseServer();
  const { data: u, error: uErr } = await sb.auth.getUser();
  const userId = u.user?.id;
  if (uErr || !userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "名称仅支持字母/数字/下划线，长度2-20" }, { status: 400 });
  }

  const name = parsed.data.name;
  const nameLower = name.toLowerCase();
  const admin = createSupabaseServiceRoleClient();

  const { data: existing } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("username_lower", nameLower)
    .maybeSingle();

  if (existing?.user_id && existing.user_id !== userId) {
    return NextResponse.json({ ok: false, error: "名称已被占用" }, { status: 409 });
  }

  const { error: metaErr } = await sb.auth.updateUser({ data: { name } });
  if (metaErr) {
    return NextResponse.json({ ok: false, error: metaErr.message }, { status: 500 });
  }

  const { error: profileErr } = await admin.from("user_profiles").upsert({
    user_id: userId,
    username: name,
    username_lower: nameLower,
  });

  if (profileErr) {
    return NextResponse.json({ ok: false, error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name }, { status: 200 });
}
