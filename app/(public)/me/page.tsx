"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice(null);
    })();
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.assign("/login");
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>我的账号</h1>
      <p>email: {email ?? "-"}</p>
      <p>user_id: {uid ?? "-"}</p>
      {notice && <p style={{ color: "#c00" }}>{notice}</p>}
      <button type="button" onClick={logout} style={{ padding: "10px 12px", marginTop: 10 }}>
        退出登录
      </button>
    </main>
  );
}
