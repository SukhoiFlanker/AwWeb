import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

async function assertAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false as const, status: 401, error: "Missing token" };

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();

  const supa = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const email = (data.user.email || "").toLowerCase();
  if (email !== adminEmail) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, email };
}

export async function GET(req: Request) {
  try {
    const auth = await assertAdmin(req);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ success: false, error: "sessionId is required" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, created_at, role, content, model")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
