"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setNotice(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setNotice(`登录失败：${j.error ?? "unknown error"}`);
        return;
      }

      const meRes = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      const me = await meRes.json();
      if (!meRes.ok || !me.isAuthed) {
        setNotice("登录失败：未获取到有效会话");
        return;
      }

      setNotice("登录成功，跳转中...");
      if (me.isAdmin) {
        router.replace("/admin/posts");
      } else {
        router.replace("/");
      }
    } catch (e: any) {
      setNotice(`登录异常：${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>登录 / 注册</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" style={{ padding: 10 }} autoComplete="email" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" type="password" style={{ padding: 10 }} autoComplete="current-password" />

        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={signIn} disabled={loading} style={{ padding: "10px 12px" }}>
            {loading ? "处理中..." : "登录"}
          </button>
          <button type="button" onClick={() => router.push("/register")} disabled={loading} style={{ padding: "10px 12px" }}>
            注册
          </button>
        </div>

        {notice && <p style={{ color: "#c00" }}>{notice}</p>}
      </div>
    </main>
  );
}
