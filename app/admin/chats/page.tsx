"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = { id: string; created_at: string; title: string | null };

export default function AdminChatsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) {
        router.replace("/admin/login");
        return;
      }

      const res = await fetch("/api/admin/chat-sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setErr(data?.error || `加载失败（${res.status}）`);
        return;
      }

      setRows(data.data || []);
    })();
  }, [router, supabase]);

  return (
    <main style={{ padding: 24, maxWidth: 980 }}>
      <h1>Admin - Chats</h1>
      <p>
        <Link href="/admin">← 返回留言</Link>
      </p>

      {err && <p>错误：{err}</p>}
      {!err && rows.length === 0 && <p>暂无会话</p>}

      <ul style={{ marginTop: 16 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ marginBottom: 12 }}>
            <Link href={`/admin/chats/${r.id}`}>
              {r.title || "(no title)"}{" "}
            </Link>
            <span style={{ fontSize: 12, color: "#666" }}>
              {" "}· {new Date(r.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
