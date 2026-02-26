"use client";

import { useEffect, useMemo, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type ModelItem = { id: string; label: string; provider: string };
type SessionItem = {
  id: string;
  created_at: string;
  title: string | null;
  last_message_at: string | null;
  message_count: number;
};

function getSid(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get("sid") || localStorage.getItem("chat_session_id");
}

function getOrCreateChatKey(): string {
  const key = "chat_session_key";
  const existing = localStorage.getItem(key);
  if (existing && existing.length >= 8) return existing;
  const next = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
}

export default function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const chatKey = useMemo(() => (typeof window !== "undefined" ? getOrCreateChatKey() : ""), []);

  async function loadHistory(sid: string) {
    const res = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sid)}`, {
      headers: chatKey ? { "x-chat-key": chatKey } : {},
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      const msg = data?.error || res.status;
      if (res.status === 401 || res.status === 403) {
        setSessionId(null);
        localStorage.removeItem("chat_session_id");
        const u = new URL(window.location.href);
        u.searchParams.delete("sid");
        window.history.replaceState({}, "", u.toString());
      }
      setMsgs([{ role: "assistant", content: `❌ 加载历史失败：${msg}` }]);
      return;
    }

        const historyRaw: unknown = (data as { history?: unknown }).history;

    const isMsgLike = (x: unknown): x is Msg => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      const role = o.role;
      const content = o.content;
      return (
        (role === "user" || role === "assistant") &&
        typeof content === "string"
      );
    };

    const history = Array.isArray(historyRaw) ? historyRaw.filter(isMsgLike) : [];
    setMsgs(history);
  }

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    const res = await fetch("/api/chat/sessions", {
      cache: "no-store",
      headers: chatKey ? { "x-chat-key": chatKey } : {},
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setSessionsError(data?.error || `加载失败（${res.status}）`);
      setSessions([]);
      setSessionsLoading(false);
      return;
    }
    setSessions(Array.isArray(data.items) ? data.items : []);
    setSessionsLoading(false);
  }

  async function loadModels() {
    const res = await fetch("/api/chat/models", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !Array.isArray(data?.models)) return;
    setModels(data.models);
    if (!modelId && data.models.length) setModelId(data.models[0].id);
  }

  // 初次加载：从 URL sid 或 localStorage 取 sessionId
  useEffect(() => {
    loadModels();
    loadSessions();
    const sid = getSid();
    if (!sid) return;

    setSessionId(sid);
    localStorage.setItem("chat_session_id", sid);
    loadHistory(sid);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const payload: Record<string, unknown> = { message: text, stream: true };
      if (sessionId) payload.sessionId = sessionId;
      if (modelId) payload.model = modelId;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(chatKey ? { "x-chat-key": chatKey } : {}),
        },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        const appendDelta = (delta: string) => {
          setMsgs((m) => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i -= 1) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], content: copy[i].content + delta };
                break;
              }
            }
            return copy;
          });
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            try {
              const json = JSON.parse(payload);
              if (json.type === "meta" && json.sessionId) {
                setSessionId(json.sessionId);
                localStorage.setItem("chat_session_id", json.sessionId);
                loadSessions();
                const u = new URL(window.location.href);
                if (!u.searchParams.get("sid")) {
                  u.searchParams.set("sid", json.sessionId);
                  window.history.replaceState({}, "", u.toString());
                }
              } else if (json.type === "delta") {
                appendDelta(json.delta || "");
              } else if (json.type === "error") {
                appendDelta(`\n❌ 出错：${json.error || "unknown"}`);
              }
            } catch {
              continue;
            }
          }
        }
      } else {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          setMsgs((m) => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i -= 1) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], content: `❌ 出错：${data?.error || res.status}` };
                break;
              }
            }
            return copy;
          });
          return;
        }
        if (data.sessionId) {
          setSessionId(data.sessionId);
          localStorage.setItem("chat_session_id", data.sessionId);
          const u = new URL(window.location.href);
          if (!u.searchParams.get("sid")) {
            u.searchParams.set("sid", data.sessionId);
            window.history.replaceState({}, "", u.toString());
          }
        }
        setMsgs((m) => {
          const copy = m.slice();
          for (let i = copy.length - 1; i >= 0; i -= 1) {
            if (copy[i].role === "assistant") {
              copy[i] = { ...copy[i], content: data.reply || "" };
              break;
            }
          }
          return copy;
        });
      }
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
    <main style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1>智能对话</h1>
        <button onClick={newChat}>新对话</button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        <aside style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 12, background: "#0f172a" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>对话记录</strong>
            <button onClick={loadSessions} style={{ fontSize: 12 }}>
              刷新
            </button>
          </div>
          {sessionsLoading && <p style={{ fontSize: 12, color: "#94a3b8" }}>加载中...</p>}
          {sessionsError && <p style={{ fontSize: 12, color: "#ef4444" }}>{sessionsError}</p>}
          {!sessionsLoading && !sessionsError && sessions.length === 0 && (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>暂无会话</p>
          )}
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSessionId(s.id);
                  localStorage.setItem("chat_session_id", s.id);
                  const u = new URL(window.location.href);
                  u.searchParams.set("sid", s.id);
                  window.history.replaceState({}, "", u.toString());
                  loadHistory(s.id);
                }}
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: s.id === sessionId ? "#ef4444" : "#111827",
                  color: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {s.title || "(无标题)"}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, color: "#cbd5f5" }}>
                  {s.last_message_at ? new Date(s.last_message_at).toLocaleString() : "-"}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section style={{ minWidth: 0 }}>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>模型选择</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              style={{ padding: "6px 8px" }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Session: {sessionId ?? "(new)"}
            </span>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            {msgs.length === 0 && <p>暂无消息（你可以开始对话）</p>}
            {msgs.map((m, i) => (
              <div
                key={i}
                style={{
                  padding: 12,
                  border: "1px solid #1f2937",
                  borderRadius: 8,
                  background: m.role === "user" ? "#111827" : "#0f172a",
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
              placeholder="输入消息..."
              style={{ flex: 1, padding: 10 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button onClick={send} disabled={loading}>
              {loading ? "发送中..." : "发送"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
