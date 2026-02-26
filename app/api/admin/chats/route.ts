import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UuidSchema = z.string().uuid();

type ChatSessionRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  title: string | null;
  metadata: unknown;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function parseIntParam(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
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

export async function GET(req: Request) {
  try {
    const gate = await requireAdminFromRequest(req);
    if (!gate.ok) {
      return NextResponse.json(
        { success: false, error: gate.error },
        { status: gate.status }
      );
    }

    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id");
    const page = Math.max(1, parseIntParam(url.searchParams.get("page"), 1));
    const pageSize = Math.min(100, Math.max(1, parseIntParam(url.searchParams.get("pageSize"), 50)));
    const offset = (page - 1) * pageSize;

    const adminDb = createSupabaseServiceRoleClient();

    let qb = adminDb
      .from("chat_sessions")
      .select("id, created_at, user_id, title, metadata", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (userId) {
      const parsed = UuidSchema.safeParse(userId);
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Invalid user_id (uuid required)" }, { status: 400 });
      }
      qb = qb.eq("user_id", parsed.data);
    }

    const { data: sessions, error: sessErr, count } = await qb;

    if (sessErr) {
      return NextResponse.json({ success: false, error: sessErr.message }, { status: 500 });
    }

    const base = Array.isArray(sessions) ? (sessions as ChatSessionRow[]) : [];

    const enriched = await Promise.all(
      base.map(async (s) => {
        try {
          const { count: msgCount } = await adminDb
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("session_id", s.id);

          const { data: lastMsg } = await adminDb
            .from("chat_messages")
            .select("created_at")
            .eq("session_id", s.id)
            .order("created_at", { ascending: false })
            .limit(1);

          return {
            ...s,
            message_count: typeof msgCount === "number" ? msgCount : 0,
            last_message_at: lastMsg?.[0]?.created_at ?? null,
          };
        } catch {
          return { ...s, message_count: null, last_message_at: null };
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: enriched,
      page,
      pageSize,
      total: typeof count === "number" ? count : 0,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
