"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setNotice(error.message);
        return;
      }

      router.replace("/admin");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>Admin Login</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          placeholder="管理员邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          placeholder="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button disabled={loading} type="submit">
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
      {notice && <p style={{ marginTop: 12 }}>{notice}</p>}
    </main>
  );
}
