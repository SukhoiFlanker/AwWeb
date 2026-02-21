"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export default function FeedbackPage() {
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);

    const msg = message.trim();
    if (!msg) {
      setNotice("请输入留言内容");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          message: msg,
          pagePath: pathname,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || `提交失败（${res.status}）`);
        return;
      }

      setNotice("提交成功，感谢你的反馈！");
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Feedback</h1>
      <p>欢迎留言反馈（测试版）。</p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          placeholder="昵称（可选）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="邮箱（可选）"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <textarea
          placeholder="留言内容（必填）"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
        />
        <button type="submit" disabled={loading}>
          {loading ? "提交中..." : "提交留言"}
        </button>
      </form>

      {notice && <p style={{ marginTop: 12 }}>{notice}</p>}
    </main>
  );
}
