import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, history: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
