import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AdminPost } from "@/app/api/admin/posts/route";

export const dynamic = "force-dynamic";

type PostSource = "feedback" | "chat";

type ChatRow = {
  id: string;
  created_at: string;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  token_count: number | null;
  metadata: unknown;
  chat_sessions: { user_id: string | null } | null;
};

type AuthUserRow = {
  id: string;
  email: string | null;
  raw_user_meta_data: unknown;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function parseGlobalId(id: string): { source: PostSource; source_ref_id: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const source = id.slice(0, idx) as PostSource;
  const source_ref_id = id.slice(idx + 1);
  if (source !== "feedback" && source !== "chat") return null;
  if (!isUuidLike(source_ref_id)) return null;
  return { source, source_ref_id };
}

async function requireAdminFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    return {
      ok: false as const,
      status: 401 as const,
      error: "Missing Authorization Bearer token",
    };
  }

  const url = requireEnv("SUPABASE_URL");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401 as const, error: "Invalid token" };
  }

  const email = (userData.user.email || "").toLowerCase();
  if (email !== adminEmail) {
    return { ok: false as const, status: 403 as const, error: "Forbidden (not admin)" };
  }

  return { ok: true as const };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdminFromBearer(req);
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
    }

    const { id } = await context.params; // ✅ Next.js 16: params 是 Promise
    const parsed = parseGlobalId(id);
    if (!parsed) {
      return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
    }

    const adminDb = createSupabaseServiceRoleClient();

    const { data: tomb } = await adminDb
      .from("admin_post_tombstones")
      .select("source_ref_id")
      .eq("source", parsed.source)
      .eq("source_ref_id", parsed.source_ref_id)
      .maybeSingle();

    const deleted = Boolean(tomb?.source_ref_id);

    if (parsed.source === "feedback") {
      const { data, error } = await adminDb
        .from("feedback")
        .select("id, created_at, name, email, message, page_path, user_agent, ip")
        .eq("id", parsed.source_ref_id)
        .maybeSingle();

      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

      const post: AdminPost = {
        id: `feedback:${data.id}`,
        created_at: data.created_at,
        author: { user_id: null, name: data.name, email: data.email },
        content: data.message,
        source: "feedback",
        source_ref_id: data.id,
        parent_id: null,
        deleted,
      };

      return NextResponse.json({ success: true, post, feedback: data });
    }

    const { data, error } = await adminDb
      .from("chat_messages")
      .select("id, created_at, session_id, role, content, model, token_count, metadata, chat_sessions!inner(user_id)")
      .eq("id", parsed.source_ref_id)
      .maybeSingle();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    const chat = data as unknown as ChatRow;
    const user_id = chat.chat_sessions?.user_id ?? null;
    let email: string | null = null;
    let name: string | null = null;
    if (user_id) {
      const { data: u } = await adminDb
        .schema("auth")
        .from("users")
        .select("id, email, raw_user_meta_data")
        .eq("id", user_id)
        .maybeSingle();
      const user = (u || null) as unknown as AuthUserRow | null;
      email = user?.email ?? null;
      const meta = user?.raw_user_meta_data;
      name =
        isRecord(meta)
          ? (typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : null)
          : null;
    }

    const post: AdminPost = {
      id: `chat:${chat.id}`,
      created_at: chat.created_at,
      author: { user_id, name, email },
      content: chat.content,
      source: "chat",
      source_ref_id: chat.id,
      parent_id: null,
      deleted,
    };

    return NextResponse.json({ success: true, post, chat_message: data });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
