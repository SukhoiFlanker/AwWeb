"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [adminContact, setAdminContact] = useState<{ email: string | null; contact: string | null } | null>(null);
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [myPostsLoading, setMyPostsLoading] = useState(false);
  const [myPostsError, setMyPostsError] = useState<string | null>(null);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [notifsError, setNotifsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      const j = await r.json();

      if (!r.ok || !j.isAuthed) {
        router.replace("/login");
        return;
      }

      setEmail(j.email ?? null);
      setUid(j.userId ?? null);
      setName(j.name ?? null);
      setNameInput(j.name ?? "");
      setNotice(null);
      await Promise.all([loadMyPosts(), loadNotifs()]);
    })();
  }, [router]);

  function formatTime(v?: string) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleString();
  }

  async function loadMyPosts() {
    setMyPostsLoading(true);
    setMyPostsError(null);
    const res = await fetch("/api/me/posts", { cache: "no-store", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setMyPostsError(data?.error || `加载失败（${res.status}）`);
      setMyPosts([]);
      setMyPostsLoading(false);
      return;
    }
    setMyPosts(Array.isArray(data.items) ? data.items : []);
    setMyPostsLoading(false);
  }

  async function loadNotifs() {
    setNotifsLoading(true);
    setNotifsError(null);
    const res = await fetch("/api/me/notifications", { cache: "no-store", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setNotifsError(data?.error || `加载失败（${res.status}）`);
      setNotifs([]);
      setNotifsLoading(false);
      return;
    }
    setNotifs(Array.isArray(data.items) ? data.items : []);
    setNotifsLoading(false);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.assign("/login");
  }

  async function saveName() {
    setNotice(null);
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setNotice(data?.error || "保存失败");
      return;
    }
    setName(data.name ?? nameInput);
    setEditing(false);
  }

  async function toggleContact() {
    if (adminContact) {
      setAdminContact(null);
      return;
    }
    const res = await fetch("/api/admin/contact");
    const data = await res.json().catch(() => ({}));
    setAdminContact({ email: data.email ?? null, contact: data.contact ?? null });
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>我的账号</h1>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <p>name: {name ?? "-"}</p>
        <button type="button" onClick={() => setEditing((v) => !v)} style={{ padding: "6px 10px" }}>
          {editing ? "取消" : "修改名称"}
        </button>
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="名称（字母/数字/下划线，2-20）"
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, flex: 1 }}
          />
          <button type="button" onClick={saveName} style={{ padding: "6px 10px" }}>
            保存
          </button>
        </div>
      )}
      <p>email: {email ?? "-"}</p>
      <p>user_id: {uid ?? "-"}</p>
      {notice && <p style={{ color: "#c00" }}>{notice}</p>}
      <button type="button" onClick={toggleContact} style={{ padding: "10px 12px", marginTop: 10 }}>
        联系管理员
      </button>
      {adminContact && (
        <div style={{ marginTop: 8 }}>
          <p>管理员邮箱: {adminContact.email ?? "-"}</p>
          <p>联系方式: {adminContact.contact ?? "-"}</p>
        </div>
      )}
      <button type="button" onClick={logout} style={{ padding: "10px 12px", marginTop: 10 }}>
        退出登录
      </button>

      <div style={{ marginTop: 28 }}>
        <h2 style={{ marginBottom: 8 }}>我的发言</h2>
        {myPostsLoading && <p>加载中...</p>}
        {myPostsError && <p style={{ color: "#c00" }}>{myPostsError}</p>}
        {!myPostsLoading && !myPostsError && myPosts.length === 0 && <p>暂无发言</p>}
        {myPosts.map((p) => (
          <div key={p.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ color: "#666", fontSize: 12 }}>{formatTime(p.createdAt)}</div>
            <div style={{ fontSize: 13, color: "#666" }}>
              {p.replyToName ? `回复 @${p.replyToName}` : p.parentId ? "回复评论" : "顶层评论"}
            </div>
            <div style={{ marginTop: 6 }}>{p.deleted ? "该评论已删除" : p.content}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 8 }}>通知</h2>
        {notifsLoading && <p>加载中...</p>}
        {notifsError && <p style={{ color: "#c00" }}>{notifsError}</p>}
        {!notifsLoading && !notifsError && notifs.length === 0 && <p>暂无通知</p>}
        {notifs.map((n, idx) => (
          <div key={`${n.entryId}-${idx}`} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ color: "#666", fontSize: 12 }}>{formatTime(n.createdAt)}</div>
            {n.type === "comment" ? (
              <>
                <div style={{ fontSize: 13, color: "#666" }}>
                  {(n.authorName || "有人") + " 回复了你"}
                </div>
                <div style={{ marginTop: 6 }}>{n.content}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "#666" }}>有人对你的发言作出反应</div>
                <div style={{ marginTop: 6 }}>{n.value === 1 ? "👍 点赞" : "👎 点踩"}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
