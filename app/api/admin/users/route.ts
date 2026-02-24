import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  posts: { active: number; deleted: number };
  chat_sessions: { count: number };
};

type PostGroupRow = {
  group_key: string;
  active_count: number;
  deleted_count: number;
};

type ChatSessionCountRow = {
  user_id: string;
  session_count: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickNameFromMeta(meta: unknown): string | null {
  if (!isRecord(meta)) return null;
  const name = typeof meta.name === "string" ? meta.name : null;
  const full = typeof meta.full_name === "string" ? meta.full_name : null;
  return name || full;
}

async function requireAdminFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    return { ok: false as const, status: 401 as const, error: "Missing Authorization Bearer token" };
  }

  const url = requireEnv("SUPABASE_URL");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, status: 401 as const, error: "Invalid token" };

  const email = (userData.user.email || "").toLowerCase();
  if (email !== adminEmail) return { ok: false as const, status: 403 as const, error: "Forbidden (not admin)" };

  return { ok: true as const };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminFromBearer(req);
    if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

    const adminDb = createSupabaseServiceRoleClient();

    // ✅ 用 Supabase Admin API 拉 auth.users（不要用 schema("auth")）
    const users: { id: string; email: string | null; user_metadata: unknown; created_at?: string }[] = [];
    const perPage = 1000;
    let page = 1;

    for (;;) {
      const { data, error } = await adminDb.auth.admin.listUsers({ page, perPage });
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

      const batch = data?.users || [];
      for (const u of batch) {
        users.push({
          id: u.id,
          email: u.email ?? null,
          user_metadata: (u.user_metadata ?? null) as unknown,
          created_at: (u.created_at ?? null) as unknown as string | undefined,
        });
      }

      if (batch.length < perPage) break;
      page += 1;
      if (page > 50) break; // 防御：最多 50k 用户
    }

    // 发言计数（来自 public view）
    const { data: postGroups, error: groupErr } = await adminDb
      .from("admin_post_user_groups")
      .select("group_key, active_count, deleted_count")
      .limit(5000);

    if (groupErr) return NextResponse.json({ success: false, error: groupErr.message }, { status: 500 });

    // 会话计数（来自 public view）
    const { data: chatCounts, error: chatCountErr } = await adminDb
      .from("admin_chat_session_counts")
      .select("user_id, session_count")
      .limit(5000);

    if (chatCountErr) return NextResponse.json({ success: false, error: chatCountErr.message }, { status: 500 });

    const postCountMap = new Map<string, { active: number; deleted: number }>();
    for (const r of (postGroups || []) as PostGroupRow[]) {
      postCountMap.set(r.group_key, {
        active: typeof r.active_count === "number" ? r.active_count : 0,
        deleted: typeof r.deleted_count === "number" ? r.deleted_count : 0,
      });
    }

    const chatCountMap = new Map<string, number>();
    for (const r of (chatCounts || []) as ChatSessionCountRow[]) {
      chatCountMap.set(r.user_id, typeof r.session_count === "number" ? r.session_count : 0);
    }

    // 按创建时间倒序（如果拿不到 created_at，就按 id 稳定排序）
    users.sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      if (tb !== ta) return tb - ta;
      return (b.id || "").localeCompare(a.id || "");
    });

    const out: AdminUser[] = users.map((u) => {
      const name = pickNameFromMeta(u.user_metadata);
      const posts = postCountMap.get(u.id) || { active: 0, deleted: 0 };
      const chatCount = chatCountMap.get(u.id) || 0;
      return {
        id: u.id,
        email: u.email,
        name,
        posts,
        chat_sessions: { count: chatCount },
      };
    });

    return NextResponse.json({ success: true, users: out });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
