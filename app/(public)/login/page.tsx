"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
  setLoading(true);
  setNotice(null);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setLoading(false);
    setNotice(`登录失败：${error.message}`);
    return;
  }

  // 用“登录返回的 user/email”，不要用输入框 email（避免大小写/空格/不一致）
  const signedEmail = data.user?.email ?? null;

  // 再确认 session 是否真的存在（定位“成功但不持久化”的关键）
  const { data: sess } = await supabase.auth.getSession();
  const hasSession = !!sess.session?.access_token;

  setLoading(false);

  if (!hasSession) {
    setNotice("登录看起来成功了，但未获取到 session（可能是 Supabase client 配置/存储问题）");
    return;
  }

  setNotice("登录成功，正在跳转...");

  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const meEmail = (signedEmail ?? "").trim().toLowerCase();

  const target = adminEmail && meEmail === adminEmail ? "/admin/posts" : "/me";

  // 先尝试软跳转
  router.replace(target);
  router.refresh();

  // 兜底：200ms 后硬跳转（保证一定过去）
  setTimeout(() => {
    window.location.assign(target);
  }, 200);
}

  async function signUp() {
    setLoading(true);
    setNotice(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setNotice(error.message);

    setNotice("注册成功：如果你开启了邮箱确认，请先去邮箱点确认链接；否则可直接登录。");
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

<button type="button" onClick={signUp} disabled={loading} style={{ padding: "10px 12px" }}>
  {loading ? "处理中..." : "注册"}
</button>
        </div>

        {notice && <p style={{ color: "#c00" }}>{notice}</p>}
      </div>
    </main>
  );
}