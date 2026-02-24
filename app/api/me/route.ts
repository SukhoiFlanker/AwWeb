import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    return NextResponse.json({ isAuthed: false, isAdmin: false, email: null }, { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  const supabase = createClient(url, anon, {
    auth: { persistSession: false }, // 这里不需要持久化
  });

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return NextResponse.json({ isAuthed: false, isAdmin: false, email: null }, { status: 200 });
  }

  const email = (data.user.email ?? "").trim().toLowerCase();
  const isAdmin = !!adminEmail && email === adminEmail;

  return NextResponse.json({ isAuthed: true, isAdmin, email }, { status: 200 });
}