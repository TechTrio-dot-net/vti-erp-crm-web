"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Loader2, Mic, Send, Sparkles, Square, Trash2, Volume2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/crm/ui";

type Query = { purpose: string; query: string; rows?: number; error?: string };
type Message = { role: "user" | "assistant"; content: string; queries?: Query[]; failed?: boolean };
type Status = { ai: { configured: boolean; model?: string }; speech: { configured: boolean; model?: string } };

const STORAGE_KEY = "vti-assistant-chat";

const SUGGESTIONS = [
  "How many leads came in today, and from which sources?",
  "इस हफ्ते किस BDM ने सबसे ज़्यादा calls कीं और कितने connect हुए?",
  "Aaj kaunse follow-ups pending hain?",
  "What did customers say about pricing on calls this week?",
  "આ મહિને કેટલા quotations accept થયા અને કુલ રકમ કેટલી?",
  "Which leads were lost this month and why?",
];

const loadChat = (): Message[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Message[]) : [];
  } catch {
    return [];
  }
};

/** Voice for reading an answer aloud, picked from the script it is written in */
function speechLang(text: string) {
  const scripts: Array<[RegExp, string]> = [
    [/[ऀ-ॿ]/, "hi-IN"], [/[઀-૿]/, "gu-IN"], [/[஀-௿]/, "ta-IN"], [/[ఀ-౿]/, "te-IN"],
    [/[ಀ-೿]/, "kn-IN"], [/[ഀ-ൿ]/, "ml-IN"], [/[ঀ-৿]/, "bn-IN"], [/[਀-੿]/, "pa-IN"],
  ];
  return scripts.find(([re]) => re.test(text))?.[1] ?? "en-IN";
}

export default function AssistantPage() {
  const role = useAuthStore((s) => s.user?.role);
  // The dashboard renders only in the browser (after sign-in state loads), so the saved chat can be read up front
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ["assistant", "status"], queryFn: () => api<Status>("/assistant/status"), enabled: role === "SUPER_ADMIN" });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
    } catch { /* storage unavailable */ }
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  if (role !== "SUPER_ADMIN") {
    return <div className="page"><PageHeader title="AI Assistant" subtitle="Only the super admin can use the assistant." /></div>;
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || thinking) return;
    const history = [...messages.filter((m) => !m.failed), { role: "user" as const, content: text }];
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setThinking(true);
    try {
      const reply = await api<{ answer: string; queries: Query[] }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      setMessages((m) => [...m, { role: "assistant", content: reply.answer, queries: reply.queries }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: (e as Error).message, failed: true }]);
    } finally {
      setThinking(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "question");
          const { text } = await api<{ text: string }>("/assistant/transcribe", { method: "POST", body: form });
          if (text) await ask(text);
          else toast.error("Couldn't hear anything — try again a little closer to the mic");
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      toast.error("Allow microphone access in the browser to ask by voice");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return toast.error("This browser can't read aloud");
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#|`]/g, " "));
    u.lang = speechLang(text);
    window.speechSynthesis.speak(u);
  }

  const notReady = status.data && !status.data.ai.configured;
  const busy = thinking || transcribing;

  return (
    <div className="page flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-10.5rem)] lg:h-[calc(100dvh-7.25rem)] min-h-[420px]">
      <PageHeader title="AI Assistant" subtitle="Ask anything about leads, calls, quotations, payments, projects or HR — in any language, typed or spoken">
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => { window.speechSynthesis?.cancel(); setMessages([]); }}>
            <Trash2 className="size-4" />New chat
          </Button>
        )}
      </PageHeader>

      {notReady && (
        <div className="card p-4 mb-3 text-sm border-amber-300 bg-amber-50 text-amber-900">
          The assistant needs a Claude API key: add <code>ANTHROPIC_API_KEY</code> to the environment variables (Vercel → Project → Settings) and redeploy.
        </div>
      )}

      <div className="card flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-8">
            <div className="size-12 rounded-full flex items-center justify-center" style={{ background: "var(--brand-yellow)" }}>
              <Sparkles className="size-6 text-black" />
            </div>
            <div>
              <p className="font-semibold">Ask about your business</p>
              <p className="text-sm text-muted-foreground">Answers come from the live CRM data, including what was said on recorded calls.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} disabled={busy || !!notReady} className="text-left text-sm rounded-full border px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
              m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : m.failed ? "bg-red-50 text-red-700 border border-red-200" : "bg-muted/60 rounded-bl-sm"
            }`}>
              {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown text={m.content} />}
              {m.role === "assistant" && !m.failed && (
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <button type="button" onClick={() => speak(m.content)} className="inline-flex items-center gap-1 hover:text-foreground"><Volume2 className="size-3.5" />Listen</button>
                  {!!m.queries?.length && (
                    <details className="w-full">
                      <summary className="cursor-pointer inline-flex items-center gap-1 hover:text-foreground"><Database className="size-3.5" />Looked up {m.queries.length} thing{m.queries.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {m.queries.map((q, j) => (
                          <li key={j}>
                            <span className="font-medium text-foreground">{q.purpose}</span> — {q.error ? <span className="text-red-600">{q.error}</span> : `${q.rows} row${q.rows === 1 ? "" : "s"}`}
                            <pre className="mt-0.5 whitespace-pre-wrap break-all text-[11px] bg-background/70 rounded p-1.5">{q.query}</pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />{transcribing ? "Listening to your question…" : "Looking it up…"}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder={recording ? "Recording… press stop when you're done" : "Type a question in any language, or press the mic"}
          rows={1}
          disabled={recording || !!notReady}
          className="flex-1 min-h-[44px] max-h-40 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {status.data?.speech.configured !== false && (
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "outline"}
            className={`size-11 rounded-xl ${recording ? "animate-pulse" : ""}`}
            disabled={busy || !!notReady}
            onClick={recording ? stopRecording : startRecording}
            title={recording ? "Stop and ask" : "Ask by voice"}
            aria-label={recording ? "Stop recording" : "Ask by voice"}
          >
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </Button>
        )}
        <Button type="submit" size="icon" className="size-11 rounded-xl" disabled={!input.trim() || busy || recording || !!notReady} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

// ─── A little markdown: headings, bullets, numbered lists, tables, **bold** ─────────────────────────────────────

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  );
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="text-xs border-collapse">
            <thead><tr>{head.map((h, j) => <th key={j} className="text-left font-semibold border-b px-2 py-1 whitespace-nowrap">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-border/50 px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={i} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 my-1 space-y-0.5`}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>);
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<p key={i} className="font-semibold mt-2">{inline(line.replace(/^#+\s/, ""))}</p>);
      i++;
    } else if (line.trim()) {
      blocks.push(<p key={i} className="my-1 whitespace-pre-wrap">{inline(line)}</p>);
      i++;
    } else {
      i++;
    }
  }
  return <div>{blocks}</div>;
}
