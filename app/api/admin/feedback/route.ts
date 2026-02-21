import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing Authorization Bearer token" },
        { status: 401 }
      );
    }

    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();

    // 用 anon client 校验 token 对应用户是谁
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await authClient.auth.getUser(token);

    if (userErr || !userData?.user) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const email = (userData.user.email || "").toLowerCase();
    if (email !== adminEmail) {
      return NextResponse.json(
        { success: false, error: "Forbidden (not admin)" },
        { status: 403 }
      );
    }

    // 通过校验后，用 service role 读取留言
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
