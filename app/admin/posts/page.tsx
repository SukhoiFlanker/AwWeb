"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  posts: { active: number; deleted: number };
  chat_sessions: { count: number };
};

type ChatSessionRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  title: string | null;
  metadata: unknown;
  message_count: number | null;
  last_message_at: string | null;
};

type ChatMessageRow = {
  id: string;
  created_at: string;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  token_count: number | null;
  metadata: unknown;
};

type ApiErr = { success: false; error: string };

type UsersOk = { success: true; users: AdminUser[] };
type PostsOk = { success: true; items: AdminPost[]; page: number; pageSize: number; total: number };
type ChatsOk = { success: true; data: ChatSessionRow[]; page: number; pageSize: number; total: number };
type ChatDetailOk = { success: true; session: ChatSessionRow; messages: ChatMessageRow[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isApiErr(v: unknown): v is ApiErr {
  return isRecord(v) && v.success === false && typeof v.error === "string";
}

function formatUser(u: AdminUser) {
  const name = u.name?.trim() || "";
  const email = u.email?.trim() || "";
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return u.id;
}

function snippet(s: string, n = 160) {
  const v = (s || "").replace(/\s+/g, " ").trim();
  if (v.length <= n) return v;
  return v.slice(0, n) + "…";
}

export default function AdminPostsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [panel, setPanel] = useState<"posts" | "chats">("posts");

  // posts
  const [q, setQ] = useState("");
  const [postPage, setPostPage] = useState(1);
  const postPageSize = 30;
  const [postTotal, setPostTotal] = useState(0);
  const [posts, setPosts] = useState<AdminPost[]>([]);

  // chats
  const [chatPage, setChatPage] = useState(1);
  const chatPageSize = 30;
  const [chatTotal, setChatTotal] = useState(0);
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    setPostPage(1);
  }, [q, selectedUserId]);

  useEffect(() => {
    setChatPage(1);
    setSelectedSessionId(null);
    setChatMessages([]);
  }, [selectedUserId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const meRes = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok || !me?.isAdmin) {
        router.replace("/admin/login");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const t = sessionData.session?.access_token || null;
      if (t) setToken(t);
      setLoading(false);
    })();
  }, [router, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.replace("/admin/login");
  }

  async function loadUsers(t: string | null) {
    setErrorMsg(null);
    const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
    const res = await fetch("/api/admin/users", {
      headers,
    });
    const payload: unknown = await res.json().catch(() => ({}));
    if (!res.ok || isApiErr(payload) || !isRecord(payload) || payload.success !== true || !Array.isArray(payload.users)) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }
      setErrorMsg(isApiErr(payload) ? payload.error : `加载失败（${res.status}）`);
      setUsers([]);
      setSelectedUserId(null);
      return;
    }

    const data = payload as UsersOk;
    setUsers(data.users);
    if (!selectedUserId && data.users.length) setSelectedUserId(data.users[0].id);
  }

  async function loadPosts(t: string | null, userId: string) {
    setErrorMsg(null);
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(postPage));
    params.set("pageSize", String(postPageSize));
    params.set("user", userId);
    if (q.trim()) params.set("q", q.trim());

    const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
    const res = await fetch(`/api/admin/posts?${params.toString()}`, {
      headers,
    });
    const payload: unknown = await res.json().catch(() => ({}));

    if (!res.ok || isApiErr(payload) || !isRecord(payload) || payload.success !== true || !Array.isArray(payload.items)) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }
      setErrorMsg(isApiErr(payload) ? payload.error : `加载失败（${res.status}）`);
      setPosts([]);
      setPostTotal(0);
      setLoading(false);
      return;
    }

    const data = payload as PostsOk;
    setPosts(data.items);
    setPostTotal(typeof data.total === "number" ? data.total : 0);
    setLoading(false);
  }

  async function loadSessions(t: string | null, userId: string) {
    setErrorMsg(null);
    setChatLoading(true);
    const params = new URLSearchParams();
    params.set("user_id", userId);
    params.set("page", String(chatPage));
    params.set("pageSize", String(chatPageSize));

    const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
    const res = await fetch(`/api/admin/chats?${params.toString()}`, {
      headers,
    });
    const payload: unknown = await res.json().catch(() => ({}));

    if (!res.ok || isApiErr(payload) || !isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }
      setErrorMsg(isApiErr(payload) ? payload.error : `加载失败（${res.status}）`);
      setSessions([]);
      setChatTotal(0);
      setChatLoading(false);
      return;
    }

    const data = payload as ChatsOk;
    setSessions(data.data);
    setChatTotal(typeof data.total === "number" ? data.total : 0);
    setChatLoading(false);
  }

  async function loadChatDetail(t: string | null, sessionId: string) {
    setErrorMsg(null);
    setChatLoading(true);
    const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
    const res = await fetch(`/api/admin/chats/${encodeURIComponent(sessionId)}`, {
      headers,
    });
    const payload: unknown = await res.json().catch(() => ({}));

    if (!res.ok || isApiErr(payload) || !isRecord(payload) || payload.success !== true || !Array.isArray(payload.messages)) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }
      setErrorMsg(isApiErr(payload) ? payload.error : `加载失败（${res.status}）`);
      setChatMessages([]);
      setChatLoading(false);
      return;
    }

    const data = payload as ChatDetailOk;
    setChatMessages(data.messages);
    setChatLoading(false);
  }

  async function setDeleted(postId: string, deleted: boolean) {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch("/api/admin/posts", {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: postId, deleted }),
    });
    const payload: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(isApiErr(payload) ? payload.error : `操作失败（${res.status}）`);
      return;
    }
    if (selectedUserId) {
      await loadPosts(token, selectedUserId);
      await loadUsers(token);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadUsers(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedUserId) return;
    if (panel === "posts") loadPosts(token, selectedUserId);
    if (panel === "chats") loadSessions(token, selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedUserId, panel, q, postPage, chatPage]);

  useEffect(() => {
    if (!token || !selectedSessionId) return;
    loadChatDetail(token, selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedSessionId]);

  const filteredUsers = users.filter((u) => {
    const kw = userSearch.trim().toLowerCase();
    if (!kw) return true;
    return (
      u.id.toLowerCase().includes(kw) ||
      (u.email || "").toLowerCase().includes(kw) ||
      (u.name || "").toLowerCase().includes(kw)
    );
  });

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;

  const postTotalPages = Math.max(1, Math.ceil(postTotal / postPageSize));
  const chatTotalPages = Math.max(1, Math.ceil(chatTotal / chatPageSize));

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1>Admin - Users</h1>
        <button onClick={logout}>退出登录</button>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
        <Link href="/admin/posts">用户（Users）</Link>
      </div>

      {errorMsg && (
        <p style={{ marginTop: 12, color: "red" }}>
          错误：{errorMsg}
        </p>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "stretch" }}>
        <aside
          style={{
            width: 360,
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 12,
            height: "calc(100vh - 170px)",
            overflow: "auto",
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>已注册用户</h2>
            <input
              placeholder="搜索用户（id/email/name）"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: selectedUserId === u.id ? "#111" : "#fff",
                  color: selectedUserId === u.id ? "#fff" : "#111",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatUser(u)}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    发言 {u.posts.active} · 对话 {u.chat_sessions.count}
                  </span>
                </div>
                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, opacity: 0.8 }}>
                  {u.id}
                </div>
              </button>
            ))}

            {!loading && filteredUsers.length === 0 && (
              <div style={{ fontSize: 12, color: "#666" }}>
                没有匹配的用户
              </div>
            )}
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          {!selectedUser ? (
            <p style={{ color: "#666" }}>请选择一个用户</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ display: "grid" }}>
                    <strong>{formatUser(selectedUser)}</strong>
                    <span style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12, color: "#666" }}>
                      {selectedUser.id}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setPanel("posts")}
                      style={{
                        padding: "6px 10px",
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        background: panel === "posts" ? "#111" : "#fff",
                        color: panel === "posts" ? "#fff" : "#111",
                      }}
                    >
                      发言
                    </button>
                    <button
                      onClick={() => setPanel("chats")}
                      style={{
                        padding: "6px 10px",
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        background: panel === "chats" ? "#111" : "#fff",
                        color: panel === "chats" ? "#fff" : "#111",
                      }}
                    >
                      对话记录
                    </button>
                  </div>
                </div>
              </div>

              {panel === "posts" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <input
                      placeholder="搜索发言内容（q）"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      style={{ flex: 1, minWidth: 220, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
                    />

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button disabled={postPage <= 1 || loading} onClick={() => setPostPage((p) => Math.max(1, p - 1))}>
                        上一页
                      </button>
                      <span style={{ fontSize: 12, color: "#666" }}>
                        第 {postPage} / {postTotalPages} 页（共 {postTotal} 条）
                      </span>
                      <button
                        disabled={postPage >= postTotalPages || loading}
                        onClick={() => setPostPage((p) => Math.min(postTotalPages, p + 1))}
                      >
                        下一页
                      </button>
                    </div>
                  </div>

                  {loading && <p>加载中...</p>}
                  {!loading && posts.length === 0 && <p>暂无发言</p>}

                  {!loading && posts.length > 0 && (
                    <ul style={{ marginTop: 0, display: "grid", gap: 12 }}>
                      {posts.map((p) => (
                        <li key={p.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: "1px solid #ddd",
                                  background: p.source === "feedback" ? "#f7f7ff" : "#f7fffb",
                                }}
                              >
                                {p.source}
                              </span>
                              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {selectedUser.name || selectedUser.email || selectedUser.id}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#666" }}>
                              {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                            </div>
                          </div>

                          <div style={{ marginTop: 10, color: "#111" }}>{snippet(p.content)}</div>

                          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div style={{ fontSize: 12, color: "#666" }}>
                              ID: <span style={{ fontFamily: "monospace" }}>{p.id}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => setDeleted(p.id, true)}>删除</button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button disabled={chatPage <= 1 || chatLoading} onClick={() => setChatPage((p) => Math.max(1, p - 1))}>
                        上一页
                      </button>
                      <span style={{ fontSize: 12, color: "#666" }}>
                        第 {chatPage} / {chatTotalPages} 页（共 {chatTotal} 个会话）
                      </span>
                      <button
                        disabled={chatPage >= chatTotalPages || chatLoading}
                        onClick={() => setChatPage((p) => Math.min(chatTotalPages, p + 1))}
                      >
                        下一页
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12, alignItems: "start" }}>
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                      <h2 style={{ fontSize: 14, margin: 0 }}>会话列表</h2>
                      {chatLoading && sessions.length === 0 ? <p>加载中...</p> : null}
                      {!chatLoading && sessions.length === 0 ? <p>暂无会话</p> : null}

                      {sessions.length > 0 ? (
                        <ul style={{ marginTop: 10, display: "grid", gap: 8 }}>
                          {sessions.map((s) => (
                            <li key={s.id}>
                              <button
                                onClick={() => setSelectedSessionId(s.id)}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  padding: 10,
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  background: selectedSessionId === s.id ? "#111" : "#fff",
                                  color: selectedSessionId === s.id ? "#fff" : "#111",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {s.title || "(无标题)"}
                                  </span>
                                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                                    {typeof s.message_count === "number" ? s.message_count : "-"}
                                  </span>
                                </div>
                                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                                  {s.last_message_at ? new Date(s.last_message_at).toLocaleString() : "-"}
                                </div>
                                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, opacity: 0.75 }}>
                                  {s.id}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, minHeight: 220 }}>
                      <h2 style={{ fontSize: 14, margin: 0 }}>消息</h2>
                      {!selectedSessionId ? (
                        <p style={{ color: "#666" }}>选择一个会话查看完整对话</p>
                      ) : chatLoading && chatMessages.length === 0 ? (
                        <p>加载中...</p>
                      ) : chatMessages.length === 0 ? (
                        <p>暂无消息</p>
                      ) : (
                        <ul style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          {chatMessages.map((m) => (
                            <li key={m.id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                <strong>{m.role}</strong>
                                <span style={{ fontSize: 12, color: "#666" }}>
                                  {m.created_at ? new Date(m.created_at).toLocaleString() : "-"}
                                </span>
                              </div>
                              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {m.content}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
