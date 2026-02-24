import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // 只保护 /admin
  if (!req.nextUrl.pathname.startsWith("/admin")) return res;

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
    res.cookies.set(name, value, {
      ...options,
      secure: process.env.NODE_ENV === "production" ? options.secure : false,
      sameSite: process.env.NODE_ENV === "production" ? options.sameSite : "lax",
    });
  });
},
    },
  });

  const { data, error } = await supabase.auth.getUser();

  // 未登录：去 /login，并带回跳参数
  if (error || !data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 已登录但非管理员：踢回首页
  const email = (data.user.email ?? "").trim().toLowerCase();
  if (!adminEmail || email !== adminEmail) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*"],
};
