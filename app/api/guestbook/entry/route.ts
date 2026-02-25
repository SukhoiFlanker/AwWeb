import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  content: z.string().min(1).max(20000),
  contentType: z.string().min(1).max(32).optional().default("md"),
  parentId: z.string().uuid().optional().nullable(),
});
const MAX_LINKS = 3;
const MAX_PER_MINUTE = 5;

function countLinks(text: string) {
  const matches = text.match(/https?:\/\/|www\./gi);
  return matches ? matches.length : 0;
}

function getClientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || null;
}

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

    const { content, contentType, parentId } = parsed.data;
    if (countLinks(content) > MAX_LINKS) {
      return NextResponse.json({ success: false, error: "链接过多" }, { status: 400 });
    }
    const meta = (u.user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName =
      (typeof meta.name === "string" && meta.name.trim()) ||
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      null;
    const emailPrefix = (u.user?.email ?? "").split("@")[0] || null;
    const authorName = metaName || emailPrefix || "用户";
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    const isAdmin = !!adminEmail && (u.user?.email ?? "").trim().toLowerCase() === adminEmail;

    const visitorId = req.headers.get("x-visitor-id") || userId;
    const ip = getClientIp(req);
    const svc = createSupabaseServiceRoleClient();

    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const [userRate, ipRate] = await Promise.all([
      svc
        .from("guestbook_entries")
        .select("id", { count: "estimated", head: true })
        .eq("author_user_id", userId)
        .gte("created_at", since),
      ip
        ? svc
            .from("guestbook_entries")
            .select("id", { count: "estimated", head: true })
            .eq("ip", ip)
            .gte("created_at", since)
        : Promise.resolve({ count: 0 }),
    ]);

    if ((userRate.count ?? 0) >= MAX_PER_MINUTE) {
      return NextResponse.json({ success: false, error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }
    if (ip && (ipRate.count ?? 0) >= MAX_PER_MINUTE) {
      return NextResponse.json({ success: false, error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }

    let rootId: string | null = null;
    let depth = 0;
    let replyToUserId: string | null = null;
    let replyToName: string | null = null;

    if (parentId) {
      const { data: parent, error: pErr } = await svc
        .from("guestbook_entries")
        .select("id, parent_id, root_id, depth, author_user_id, author_name, status, deleted_at")
        .eq("id", parentId)
        .maybeSingle();

      if (pErr) return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
      if (!parent) return NextResponse.json({ success: false, error: "Parent not found" }, { status: 404 });
      if ((parent as { deleted_at: string | null }).deleted_at || (parent as any).status === "deleted") {
        return NextResponse.json({ success: false, error: "Cannot comment on deleted entry" }, { status: 400 });
      }

      rootId = (parent as any).root_id ?? (parent as any).id;
      depth = Math.min(((parent as any).depth ?? 0) + 1, 5);
      replyToUserId = (parent as any).author_user_id ?? null;
      replyToName = (parent as any).author_name ?? null;
    }

    const { data, error } = await sb
      .from("guestbook_entries")
      .insert({
        parent_id: parentId ?? null,
        root_id: rootId,
        depth,
        reply_to_user_id: replyToUserId,
        reply_to_name: replyToName,
        status: "active",
        ip,
        visitor_id: visitorId,
        author_user_id: userId,
        // 兼容字段：保留你原来的 author_key/author_name
        author_key: visitorId,
        author_name: authorName,
        author_is_admin: isAdmin,
        content,
        content_type: contentType,
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    const id = data.id as string;

    if (!rootId) {
      await svc.from("guestbook_entries").update({ root_id: id }).eq("id", id);
    }
    return NextResponse.json({ success: true, id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
