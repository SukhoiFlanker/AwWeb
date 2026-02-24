import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ValueSchema = z.union([z.literal(1), z.literal(-1), z.literal(0), z.enum(["like", "dislike"])]);

const PostSchema = z.object({
  entryId: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
  value: ValueSchema,
});

const DeleteSchema = z.object({
  entryId: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
});

function normalizeEntryId(obj: { entryId?: string; id?: string }) {
  return obj.entryId ?? obj.id ?? null;
}

function normalizeValue(v: unknown): 1 | -1 | 0 {
  if (v === "like") return 1;
  if (v === "dislike") return -1;
  if (v === 1 || v === -1 || v === 0) return v;
  return 0;
}

async function assertEntryActive(svc: SupabaseClient, entryId: string) {
  const { data, error } = await svc
    .from("guestbook_entries")
    .select("id, deleted_at")
    .eq("id", entryId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500 as const, msg: error.message };
  if (!data) return { ok: false as const, status: 404 as const, msg: "Entry not found" };
  if ((data as { deleted_at: string | null }).deleted_at) {
    return { ok: false as const, status: 400 as const, msg: "Entry is deleted" };
  }
  return { ok: true as const };
}

async function requireUser(sb: ReturnType<typeof supabaseServer>) {
  const { data, error } = await sb.auth.getUser();
  if (error) return { ok: false as const, status: 401 as const, msg: error.message };
  const user = data.user;
  if (!user?.id) return { ok: false as const, status: 401 as const, msg: "Unauthorized" };
  return { ok: true as const, userId: user.id };
}

export async function POST(req: Request) {
  try {
    // 用 cookie session 取登录用户（未登录直接 401）
    const sb = supabaseServer();
    const auth = await requireUser(sb);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.msg }, { status: auth.status });

    const raw: unknown = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const entryId = normalizeEntryId(parsed.data);
    if (!entryId) {
      return NextResponse.json({ success: false, error: "entryId is required" }, { status: 400 });
    }

    const value = normalizeValue(parsed.data.value);
    const visitorId = auth.userId; // ✅ 方案A：visitor_id = auth.uid()::text

    // value=0 => 取消
    if (value === 0) {
      const { error } = await sb
        .from("guestbook_reactions")
        .delete()
        .eq("entry_id", entryId)
        .eq("visitor_id", visitorId);

      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // 仅允许对未删除 entry 点赞/点踩
    const check = await assertEntryActive(sb as unknown as SupabaseClient, entryId);
    if (!check.ok) {
      return NextResponse.json({ success: false, error: check.msg }, { status: check.status });
    }

    // ✅ upsert：依赖主键 (entry_id, visitor_id)
    const { error } = await sb.from("guestbook_reactions").upsert(
      {
        entry_id: entryId,
        visitor_id: visitorId,
        value,
        // 可选兼容字段：你表里 user_key 可空，写不写都行；写了方便排查
        user_key: visitorId,
      },
      { onConflict: "entry_id,visitor_id" }
    );

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const sb = supabaseServer();
    const auth = await requireUser(sb);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.msg }, { status: auth.status });

    const url = new URL(req.url);
    const entryIdFromQuery = url.searchParams.get("entryId") ?? url.searchParams.get("id");

    let entryId: string | null = entryIdFromQuery;
    if (!entryId) {
      const raw: unknown = await req.json().catch(() => null);
      const parsed = DeleteSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid body", issues: parsed.error.issues },
          { status: 400 }
        );
      }
      entryId = normalizeEntryId(parsed.data);
    }

    if (!entryId) {
      return NextResponse.json({ success: false, error: "entryId is required" }, { status: 400 });
    }

    const checkUuid = z.string().uuid().safeParse(entryId);
    if (!checkUuid.success) {
      return NextResponse.json({ success: false, error: "Invalid entryId" }, { status: 400 });
    }
    entryId = checkUuid.data;

    const visitorId = auth.userId;

    const { error } = await sb
      .from("guestbook_reactions")
      .delete()
      .eq("entry_id", entryId)
      .eq("visitor_id", visitorId);

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}