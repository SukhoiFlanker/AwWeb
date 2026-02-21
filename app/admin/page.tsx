"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";



type FeedbackRow = {
  id: string;
  created_at: string;
  name: string | null;
  email: string | null;
  message: string;
  page_path: string | null;
  user_agent: string | null;
  ip: string | null;
};

export default function AdminPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/admin/login");
        return;
      }

      const res = await fetch("/api/admin/feedback", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          await supabase.auth.signOut();
          router.replace("/admin/login");
          return;
        }
        setErrorMsg(data?.error || `加载失败（${res.status}）`);
        setLoading(false);
        return;
      }

      setRows(data.data || []);
      setLoading(false);
    })();
  }, [router, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1>Admin - Feedback</h1>
        <button onClick={logout}>退出登录</button>
      </div>

      {/* ✅ 导航要放在组件 return 内 */}
      <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
        <a href="/admin">留言</a>
        <a href="/admin/chats">Chats</a>
      </div>

      {loading && <p>加载中...</p>}
      {errorMsg && <p>错误：{errorMsg}</p>}

      {!loading && !errorMsg && rows.length === 0 && <p>暂无留言</p>}

      <ul style={{ marginTop: 20 }}>
        {rows.map((item) => (
          <li key={item.id} style={{ marginBottom: 16 }}>
            <div><strong>{item.name || "匿名"}</strong></div>
            <div>{item.email}</div>
            <div>{item.message}</div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {new Date(item.created_at).toLocaleString()} · {item.page_path || "-"}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
