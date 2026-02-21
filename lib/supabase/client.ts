import { createClient } from "@supabase/supabase-js";

export function createSupabaseBrowserClient() {
  // 注意：客户端必须用静态字段访问，不能用 process.env[name]
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (client)"
    );
  }

  return createClient(url, anonKey);
}
