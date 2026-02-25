import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const res = NextResponse.json({ isAuthed: false, isAdmin: false, email: null, userId: null, name: null });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ isAuthed: false, isAdmin: false, email: null, userId: null, name: null }, { status: 200 });
  }

  const email = (data.user.email ?? "").trim().toLowerCase();
  const isAdmin = !!adminEmail && email === adminEmail;
  const userId = data.user.id ?? null;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.name === "string" && meta.name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    null;

  return NextResponse.json({ isAuthed: true, isAdmin, email, userId, name }, { status: 200 });
}
