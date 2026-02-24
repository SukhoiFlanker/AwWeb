"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Me = { isAuthed: boolean; isAdmin: boolean; email: string | null };

export default function Navbar() {
  const [me, setMe] = useState<Me>({ isAuthed: false, isAdmin: false, email: null });
  const pathname = usePathname();

  async function refreshMe() {
    try {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      const j = await r.json();
      if (!r.ok) {
        setMe({ isAuthed: false, isAdmin: false, email: null });
        return;
      }
      setMe({ isAuthed: !!j.isAuthed, isAdmin: !!j.isAdmin, email: j.email ?? null });
    } catch {
      setMe({ isAuthed: false, isAdmin: false, email: null });
    }
  }

  useEffect(() => {
    refreshMe();
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setMe({ isAuthed: false, isAdmin: false, email: null });
    window.location.href = "/";
  }

  return (
    <nav style={{ display: "flex", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #eee" }}>
      <div><Link href="/">Awliver</Link></div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Link href="/feedback">留言</Link>
        <Link href="/chat">AI聊天</Link>

        {!me.isAuthed ? (
          <Link href="/login">登录</Link>
        ) : (
          <>
            <Link href="/me">我的账号</Link>
            {me.isAdmin && <Link href="/admin/posts">管理后台</Link>}
            <button type="button" onClick={logout} style={{ padding: "6px 10px", border: "1px solid #ddd" }}>
              退出
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
