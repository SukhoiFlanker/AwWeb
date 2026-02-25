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
    })();
  }, [router]);

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
    </main>
  );
}
