import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UuidSchema = z.string().uuid();

type Session = {
  id: string;
  created_at: string;
  user_id: string | null;
  title: string | null;
  metadata: unknown;
};

type Message = {
  id: string;
  created_at: string;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  token_count: number | null;
  metadata: unknown;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

async function requireAdminFromRequest(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    const sb = supabaseServer();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return { ok: false as const, status: 401 as const, error: "Unauthorized" };
    }
    const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();
    const email = (userData.user.email || "").toLowerCase();
    if (email !== adminEmail) {
      return { ok: false as const, status: 403 as const, error: "Forbidden (not admin)" };
    }
    return { ok: true as const };
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

// ✅ Next.js 16 兼容：context.params 是 Promise
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdminFromRequest(req);
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
    }

    const { id: sessionId } = await context.params;
    if (!sessionId) {
      return NextResponse.json({ success: false, error: "Missing session id" }, { status: 400 });
    }

    const sessionIdParsed = UuidSchema.safeParse(sessionId);
    if (!sessionIdParsed.success) {
      return NextResponse.json({ success: false, error: "Invalid session id (uuid required)" }, { status: 400 });
    }

    const adminDb = createSupabaseServiceRoleClient();

    const { data: session, error: sessErr } = await adminDb
      .from("chat_sessions")
      .select("id, created_at, user_id, title, metadata")
      .eq("id", sessionIdParsed.data)
      .maybeSingle();

    if (sessErr) {
      return NextResponse.json({ success: false, error: sessErr.message }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ success: false, error: "Session not found" }, { status: 404 });
    }

    const { data: messages, error: msgErr } = await adminDb
      .from("chat_messages")
      .select("id, created_at, session_id, role, content, model, token_count, metadata")
      .eq("session_id", sessionIdParsed.data)
      .order("created_at", { ascending: true })
      .limit(500);

    if (msgErr) {
      return NextResponse.json({ success: false, error: msgErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      session: session as Session,
      messages: (messages || []) as Message[],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
