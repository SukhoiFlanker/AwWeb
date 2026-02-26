import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const UuidSchema = z.string().uuid();

function pickSessionKey(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>).session_key;
  return typeof v === "string" && v ? v : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "sessionId is required" },
        { status: 400 }
      );
    }

    const parsed = UuidSchema.safeParse(sessionId);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid sessionId (uuid required)" },
        { status: 400 }
      );
    }

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const sessionKey = (req.headers.get("x-chat-key") || "").trim() || null;

    const supabase = createSupabaseServiceRoleClient();

    const { data: session, error: sessionErr } = await supabase
      .from("chat_sessions")
      .select("id, user_id, metadata")
      .eq("id", parsed.data)
      .maybeSingle();

    if (sessionErr) {
      return NextResponse.json({ success: false, error: sessionErr.message }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    if (session.user_id) {
      if (!userId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      if (session.user_id !== userId) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    } else {
      const key = pickSessionKey(session.metadata);
      if (!sessionKey) return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
      if (!key) {
        await supabase
          .from("chat_sessions")
          .update({ metadata: { session_key: sessionKey } })
          .eq("id", parsed.data);
      }
      if (key && key !== sessionKey) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", parsed.data)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, history: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
