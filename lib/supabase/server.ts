import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function requireOneOfEnv(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new Error(`Missing environment variable: one of ${names.join(", ")}`);
}

export function supabaseServer() {
  const url = requireOneOfEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const anon = requireOneOfEnv(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  const cookieStore = cookies();

  return createServerClient(url, anon, {
    cookies: {
      async getAll() {
        return (await cookieStore).getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(async ({ name, value, options }) => {
            (await cookieStore).set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

// SSR（基于 cookie session）的服务端 client：适合 Server Components/读取当前登录用户
export function createSupabaseServerClient() {
  return supabaseServer();
}

// Service role（绕过 RLS）的服务端 client：适合 Route Handler 做后台读写
export function createSupabaseServiceRoleClient() {
  const url = requireOneOfEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}