"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function MePage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? null);
      setUid(data.user.id);
    })();
  }, [router, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>我的账号</h1>
      <p>email: {email ?? "-"}</p>
      <p>user_id: {uid ?? "-"}</p>
      <button onClick={logout} style={{ padding: "10px 12px", marginTop: 10 }}>
        退出登录
      </button>
      <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
        看到 user_id 说明你已经具备调试点赞/点踩/评论的前置条件。
      </p>
    </main>
  );
}
