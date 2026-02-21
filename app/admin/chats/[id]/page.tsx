"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Msg = {
  id: string;
  created_at: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model: string | null;
};

export default function AdminChatDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<Msg[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!sessionId) return;

      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) {
        router.replace("/admin/login");
        return;
      }

      const res = await fetch(`/api/admin/chat-messages?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setErr(data?.error || `加载失败（${res.status}）`);
        return;
      }

      setRows(data.data || []);
    })();
  }, [router, sessionId, supabase]);

  return (
    <main style={{ padding: 24, maxWidth: 980 }}>
      <h1>Admin - Chat Detail</h1>
      <p>
        <Link href="/admin/chats">← 返回会话列表</Link>
      </p>

      <p style={{ fontSize: 12, color: "#666" }}>sessionId: {sessionId}</p>

      {err && <p>错误：{err}</p>}
      {!err && rows.length === 0 && <p>暂无消息</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {rows.map((m) => (
          <div
            key={m.id}
            style={{
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: m.role === "user" ? "#f7f7f7" : "white",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{m.role}</strong>
              <span style={{ fontSize: 12, color: "#666" }}>
                {new Date(m.created_at).toLocaleString()}
              </span>
            </div>
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{m.content}</div>
            {m.model && <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>model: {m.model}</div>}
          </div>
        ))}
      </div>
    </main>
  );
}
