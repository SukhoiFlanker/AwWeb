"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AdminPost = {
  id: string;
  created_at: string;
  author: { user_id?: string | null; name?: string | null; email?: string | null };
  content: string;
  source: "feedback" | "chat";
  source_ref_id: string;
  parent_id: string | null;
  deleted: boolean;
};

type ApiOk = {
  success: true;
  post: AdminPost;
  feedback?: unknown;
  chat_message?: unknown;
};

type ApiErr = { success: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isApiOk(v: unknown): v is ApiOk {
  if (!isRecord(v)) return false;
  return v.success === true && isRecord(v.post);
}

function isApiErr(v: unknown): v is ApiErr {
  if (!isRecord(v)) return false;
  return v.success === false && typeof v.error === "string";
}

function formatAuthor(a: AdminPost["author"]) {
  const name = a?.name?.trim() || "";
  const email = a?.email?.trim() || "";
  const userId = a?.user_id?.trim() || "";
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  if (userId) return userId;
  return "Anonymous";
}

export default function AdminPostDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [post, setPost] = useState<AdminPost | null>(null);
  const [extra, setExtra] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const t = sessionData.session?.access_token || null;
      if (!t) {
        router.replace("/admin/login");
        return;
      }
      setToken(t);

      const res = await fetch(`/api/admin/posts/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok || isApiErr(payload) || !isApiOk(payload)) {
        if (res.status === 401 || res.status === 403) {
          await supabase.auth.signOut();
          router.replace("/admin/login");
          return;
        }
        setErrorMsg(isApiErr(payload) ? payload.error : `加载失败（${res.status}）`);
        setPost(null);
        setExtra(null);
        setLoading(false);
        return;
      }

      setPost(payload.post);
      setExtra(payload.feedback ?? payload.chat_message ?? null);
      setLoading(false);
    })();
  }, [id, router, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  async function setDeleted(deleted: boolean) {
    if (!token || !post) return;
    const res = await fetch("/api/admin/posts", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: post.id, deleted }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data?.error || `操作失败（${res.status}）`);
      return;
    }
    router.refresh();
  }

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1>Admin - Post</h1>
        <button onClick={logout}>退出登录</button>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
        <Link href="/admin/posts">发言（Posts）</Link>
      </div>

      <button onClick={() => router.push("/admin/posts")} style={{ margin: "8px 0" }}>
        ← 返回列表
      </button>

      {loading && <p>加载中...</p>}
      {errorMsg && <p style={{ color: "red" }}>错误：{errorMsg}</p>}

      {!loading && !errorMsg && post && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    background: post.source === "feedback" ? "#f7f7ff" : "#f7fffb",
                  }}
                >
                  {post.source}
                </span>
                <strong>{formatAuthor(post.author)}</strong>
                {post.author?.user_id ? (
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{post.author.user_id}</span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                {post.created_at ? new Date(post.created_at).toLocaleString() : "-"}
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              全局ID：<span style={{ fontFamily: "monospace" }}>{post.id}</span>
              {post.deleted ? <span style={{ marginLeft: 8, color: "#b00020" }}>（已删除）</span> : null}
            </div>

            <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.content}</pre>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {post.deleted ? (
                <button onClick={() => setDeleted(false)}>恢复</button>
              ) : (
                <button onClick={() => setDeleted(true)}>软删除</button>
              )}
            </div>
          </div>

          <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>原始记录（调试）</h2>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
              {JSON.stringify(extra, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}
