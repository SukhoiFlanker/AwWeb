"use client";

import { useEffect, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

function getSid(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get("sid") || localStorage.getItem("chat_session_id");
}

export default function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadHistory(sid: string) {
    const res = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sid)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setMsgs([{ role: "assistant", content: `❌ 加载历史失败：${data?.error || res.status}` }]);
      return;
    }

    const history = (data.history || [])
      .filter((x: any) => x.role === "user" || x.role === "assistant")
      .map((x: any) => ({ role: x.role, content: x.content })) as Msg[];

    setMsgs(history);
  }

  // 初次加载：从 URL sid 或 localStorage 取 sessionId
  useEffect(() => {
    const sid = getSid();
    if (!sid) return;

    setSessionId(sid);
    localStorage.setItem("chat_session_id", sid);
    loadHistory(sid);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMsgs((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        setMsgs((m) => [
          ...m,
          { role: "assistant", content: `❌ 出错：${data?.error || res.status}` },
        ]);
        return;
      }

      if (data.sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem("chat_session_id", data.sessionId);

        // 如果 URL 没有 sid，就把 sid 写到 URL，方便复制分享/刷新
        const u = new URL(window.location.href);
        if (!u.searchParams.get("sid")) {
          u.searchParams.set("sid", data.sessionId);
          window.history.replaceState({}, "", u.toString());
        }
      }

      setMsgs((m) => [...m, { role: "assistant", content: data.reply || "" }]);
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setSessionId(null);
    setMsgs([]);
    localStorage.removeItem("chat_session_id");
    const u = new URL(window.location.href);
    u.searchParams.delete("sid");
    window.history.replaceState({}, "", u.toString());
  }

  return (
    <main style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1>Chat</h1>
        <button onClick={newChat}>新会话</button>
      </div>

      <p style={{ fontSize: 12, color: "#666" }}>
        Session: {sessionId ?? "(new)"}
      </p>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {msgs.length === 0 && <p>暂无消息（你可以开始聊天）</p>}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: m.role === "user" ? "#f7f7f7" : "white",
            }}
          >
            <strong>{m.role === "user" ? "你" : "AI"}：</strong>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入一句话..."
          style={{ flex: 1, padding: 10 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button onClick={send} disabled={loading}>
          {loading ? "发送中..." : "发送"}
        </button>
      </div>
    </main>
  );
}
