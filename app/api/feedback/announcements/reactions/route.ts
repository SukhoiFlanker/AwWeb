import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { parseVisitorKey, requireVisitorKey } from "@/lib/guestbook/visitor";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  ids: z.string().optional(),
});

const BodySchema = z.object({
  announcementId: z.string().uuid(),
  value: z.string().min(1).max(16).optional().nullable(),
});

function parseIds(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({ ids: url.searchParams.get("ids") || undefined });
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid query" }, { status: 400 });

    const ids = parseIds(parsed.data.ids);
    if (ids.length === 0) return NextResponse.json({ ok: true, items: {} });

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const visitorKey = parseVisitorKey(req);
    const viewerKey = userId || visitorKey;

    const svc = createSupabaseServiceRoleClient();
    const { data, error } = await svc
      .from("feedback_announcement_reactions")
      .select("announcement_id, visitor_id, value")
      .in("announcement_id", ids);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const items: Record<string, { counts: Record<string, number>; my: string | null }> = {};
    for (const id of ids) items[id] = { counts: {}, my: null };

    for (const r of data || []) {
      const key = (r as any).announcement_id as string;
      const value = (r as any).value as string;
      const vId = (r as any).visitor_id as string;
      if (!items[key]) items[key] = { counts: {}, my: null };
      items[key].counts[value] = (items[key].counts[value] || 0) + 1;
      if (viewerKey && vId === viewerKey) {
        items[key].my = value;
      }
    }

    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const visitorKey = userId || requireVisitorKey(req);

    if (!parsed.data.value) {
      const svc = createSupabaseServiceRoleClient();
      const { error } = await svc
        .from("feedback_announcement_reactions")
        .delete()
        .eq("announcement_id", parsed.data.announcementId)
        .eq("visitor_id", visitorKey);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const svc = createSupabaseServiceRoleClient();
    const { error } = await svc
      .from("feedback_announcement_reactions")
      .upsert(
        {
          announcement_id: parsed.data.announcementId,
          visitor_id: visitorKey,
          user_id: userId,
          value: parsed.data.value,
        },
        { onConflict: "announcement_id,visitor_id" }
      );
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("x-visitor-id") ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
