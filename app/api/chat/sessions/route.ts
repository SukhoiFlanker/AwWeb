import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  title: string | null;
  metadata: unknown;
};

function pickSessionKey(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>).session_key;
  return typeof v === "string" && v ? v : null;
}

export async function GET(req: Request) {
  try {
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const sessionKey = (req.headers.get("x-chat-key") || "").trim() || null;

    if (!userId && !sessionKey) {
      return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
    }

    const svc = createSupabaseServiceRoleClient();
    let query = svc
      .from("chat_sessions")
      .select("id, created_at, user_id, title, metadata")
      .order("created_at", { ascending: false })
      .limit(50);

    if (userId) {
      query = query.eq("user_id", userId);
    } else if (sessionKey) {
      query = query.contains("metadata", { session_key: sessionKey });
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const sessions = (data ?? []) as SessionRow[];
    const items = await Promise.all(
      sessions.map(async (s) => {
        const { data: lastMsg } = await svc
          .from("chat_messages")
          .select("created_at")
          .eq("session_id", s.id)
          .order("created_at", { ascending: false })
          .limit(1);
        const { count } = await svc
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("session_id", s.id);

        return {
          id: s.id,
          created_at: s.created_at,
          title: s.title,
          last_message_at: lastMsg?.[0]?.created_at ?? null,
          message_count: typeof count === "number" ? count : 0,
          session_key: pickSessionKey(s.metadata),
        };
      })
    );

    return NextResponse.json({ success: true, items });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
