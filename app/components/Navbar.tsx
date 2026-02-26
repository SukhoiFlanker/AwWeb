"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Me = { isAuthed: boolean; isAdmin: boolean; email: string | null };

export default function Navbar() {
  const [me, setMe] = useState<Me>({ isAuthed: false, isAdmin: false, email: null });
  const pathname = usePathname();
  const isHome = pathname === "/";

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
    <nav
      style={
        isHome
          ? {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(15, 23, 42, 0.55)",
              backdropFilter: "blur(10px)",
              color: "#f8fafc",
              zIndex: 20,
            }
          : {
              display: "flex",
              justifyContent: "space-between",
              padding: "12px 24px",
              borderBottom: "1px solid rgba(148,163,184,0.15)",
              background: "rgba(2,6,23,0.9)",
              color: "#f8fafc",
            }
      }
    >
      <div>
        <Link href="/" style={isHome ? { textDecoration: "none" } : undefined}>
          <span
            style={
              isHome
                ? {
                    fontWeight: 600,
                    fontSize: 18,
                    backgroundImage: "linear-gradient(90deg, #ffffff, #fecaca, #ef4444)",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }
                : undefined
            }
          >
            Awliver · 个人控制台
          </span>
        </Link>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Link href="/feedback" style={isHome ? { color: "#f8fafc" } : undefined}>
          反馈中心
        </Link>
        <Link href="/chat" style={isHome ? { color: "#f8fafc" } : undefined}>
          智能对话
        </Link>

        {!me.isAuthed ? (
          <Link href="/login" style={isHome ? { color: "#f8fafc" } : undefined}>
            身份入口
          </Link>
        ) : (
          <>
            <Link href="/me" style={isHome ? { color: "#f8fafc" } : undefined}>
              个人中心
            </Link>
            {me.isAdmin && (
              <Link href="/admin/posts" style={isHome ? { color: "#f8fafc" } : undefined}>
                管理中枢
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              style={
                isHome
                  ? {
                      padding: "6px 10px",
                      border: "1px solid rgba(148,163,184,0.4)",
                      color: "#f8fafc",
                      background: "transparent",
                    }
                  : { padding: "6px 10px", border: "1px solid #ddd" }
              }
            >
              退出
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
