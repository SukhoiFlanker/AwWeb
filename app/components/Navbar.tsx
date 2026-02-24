"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function Navbar() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  async function refreshAdminFlag() {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!token) {
      setIsAdmin(false);
      return;
    }

    const r = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const j = await r.json();
    setIsAdmin(!!j.isAdmin);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    refreshAdminFlag();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      await refreshAdminFlag();
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  return (
    <nav style={{ display: "flex", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #eee" }}>
      <div><Link href="/">Awliver</Link></div>

      <div style={{ display: "flex", gap: 16 }}>
        <Link href="/feedback">留言</Link>
        <Link href="/chat">AI聊天</Link>

        {!user ? (
          <Link href="/login">登录</Link>
        ) : (
          <>
            <Link href="/me">我的账号</Link>
            {isAdmin && <Link href="/admin/posts">管理后台</Link>}
          </>
        )}
      </div>
    </nav>
  );
}