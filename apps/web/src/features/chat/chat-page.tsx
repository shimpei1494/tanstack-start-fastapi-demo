import { useState, useRef } from "react";
import { useChat } from "@tanstack/ai-react";
import { useHydrated } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import {
  Sparkles,
  Send,
  Square,
  RotateCcw,
  LoaderCircle,
  MessageSquare,
  Check,
  ArrowDown,
} from "lucide-react";
import { Button, ErrorNotice } from "@demo/ui";
import type { ChatScenario } from "@demo/chat-adapter";
import { chatFn } from "../../server/functions/chat";

const steps: Record<string, string> = {
  retrieve: "関連情報を検索中",
  generate: "回答を生成中",
  validate: "回答を確認中",
};
export function ChatPage() {
  const hydrated = useHydrated();
  const [scenario, setScenario] = useState<ChatScenario>("normal");
  const scenarioRef = useRef<ChatScenario>("normal");
  const [step, setStep] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"idle" | "running" | "complete" | "stopped" | "error">(
    "idle",
  );
  const bottom = useRef<HTMLDivElement>(null);
  const chat = useChat({
    fetcher: ({ messages, threadId, runId }, { signal }) => {
      setStep(null);
      setOutcome("running");
      return chatFn({ data: { messages, threadId, runId, scenario: scenarioRef.current }, signal });
    },
    onChunk: (chunk) => {
      if (chunk.type === "STEP_STARTED") setStep(chunk.stepName);
      if (chunk.type === "STEP_FINISHED") setStep(null);
      if (chunk.type === "RUN_FINISHED") setOutcome("complete");
      if (chunk.type === "RUN_ERROR") {
        setOutcome("error");
        setStep(null);
      }
    },
    onError: () => {
      setOutcome("error");
      setStep(null);
    },
  });
  const form = useForm({
    defaultValues: { message: "" },
    onSubmit: async ({ value, formApi }) => {
      const text = value.message.trim();
      if (!text || chat.isLoading) return;
      formApi.reset();
      await chat.sendMessage(text);
    },
  });
  const label =
    outcome === "complete"
      ? "回答が完了しました"
      : outcome === "stopped"
        ? "生成を停止しました（未完了）"
        : outcome === "error"
          ? "回答は完了していません"
          : chat.isLoading
            ? step
              ? (steps[step] ?? step)
              : "接続しています…"
            : "メッセージを送信できます";
  return (
    <main className="mx-auto max-w-6xl px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="mb-8">
        <p className="eyebrow mb-3">Room for your next idea</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          次の一歩を、話してみる。
        </h1>
        <p className="mt-3 text-sm leading-7 text-stone-500">
          作業の進め方を相談する、小さなチャットルーム。
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_280px]">
        <section className="panel overflow-hidden" aria-label="チャット">
          <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="rounded-lg bg-teal-50 p-1.5 text-teal-700">
                <Sparkles size={16} />
              </span>
              作業アシスタント
            </span>
            <span className="text-xs text-stone-400">ダミーAI</span>
          </div>
          <div
            className="max-h-[560px] min-h-[340px] space-y-5 overflow-y-auto p-6"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {chat.messages.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare className="mx-auto mb-5 text-teal-600" size={30} />
                <p className="font-medium">考えを整理するところから。</p>
                <p className="mx-auto mt-3 max-w-xs text-xs leading-6 text-stone-400">
                  「勉強会の準備を手伝って」など、取り組みたいことを教えてください。
                </p>
              </div>
            ) : (
              chat.messages.map((message) => (
                <article
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "rounded-br-sm bg-teal-800 text-white" : "rounded-bl-sm border border-stone-200 bg-stone-50 text-stone-700"}`}
                  >
                    <p
                      className={`mb-1 text-[10px] font-medium ${message.role === "user" ? "text-teal-200" : "text-stone-400"}`}
                    >
                      {message.role === "user" ? "あなた" : "アシスタント"}
                    </p>
                    <div
                      className="whitespace-pre-wrap break-words"
                      data-testid={`${message.role}-message`}
                    >
                      {message.parts.map((part, index) =>
                        part.type === "text" ? <span key={index}>{part.content}</span> : null,
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
            <div ref={bottom} />
          </div>
          <div className="flex items-center justify-between gap-2 px-6 pb-3">
            <output
              data-testid="chat-status"
              className="flex items-center gap-2 text-xs text-stone-500"
            >
              {chat.isLoading ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : outcome === "complete" ? (
                <Check size={13} className="text-teal-600" />
              ) : null}
              {label}
            </output>
            {chat.messages.length > 0 && (
              <Button
                variant="ghost"
                aria-label="最新のメッセージへ"
                onClick={() =>
                  bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                }
              >
                <ArrowDown size={14} />
              </Button>
            )}
          </div>
          <div className="space-y-3 border-t border-stone-100 p-5">
            <ErrorNotice error={chat.error} />
            {outcome === "stopped" && (
              <p className="text-xs text-amber-800">
                途中までの返答です。再生成すると新しい実行を開始します。
              </p>
            )}
            <form
              method="post"
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <form.Field
                name="message"
                validators={{
                  onChange: z
                    .string()
                    .trim()
                    .min(1, "メッセージを入力してください")
                    .max(4000, "4000文字以内で入力してください"),
                }}
              >
                {(field) => (
                  <div className="flex-1">
                    <label htmlFor="chat-message" className="sr-only">
                      メッセージ
                    </label>
                    <textarea
                      rows={2}
                      id="chat-message"
                      className="field resize-y"
                      placeholder="相談したいことを入力…"
                      value={field.state.value}
                      maxLength={4000}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={!hydrated || chat.isLoading}
                    />
                    {field.state.meta.errors.map((e, i) => (
                      <p key={i} className="mt-1 text-xs text-red-700">
                        {e?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
              {chat.isLoading ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    chat.stop();
                    setOutcome("stopped");
                    setStep(null);
                  }}
                >
                  <Square size={15} />
                  停止
                </Button>
              ) : (
                <Button type="submit" disabled={!hydrated} aria-label="メッセージを送信">
                  <Send size={17} />
                </Button>
              )}
            </form>
            {chat.messages.length > 0 && !chat.isLoading && (
              <Button variant="ghost" className="text-xs" onClick={() => void chat.reload()}>
                <RotateCcw size={13} />
                返答を再生成
              </Button>
            )}
          </div>
        </section>
        <aside className="space-y-5">
          <div className="panel p-5">
            <h2 className="text-sm font-medium">配信の動作を試す</h2>
            <label htmlFor="chat-scenario" className="mb-2 mt-4 block text-xs text-stone-500">
              次の応答
            </label>
            <select
              id="chat-scenario"
              className="field"
              value={scenario}
              disabled={!hydrated || chat.isLoading}
              onChange={(e) => {
                scenarioRef.current = e.target.value as ChatScenario;
                setScenario(e.target.value as ChatScenario);
              }}
            >
              <option value="normal">通常の配信</option>
              <option value="slow">ゆっくり配信（停止を試す）</option>
              <option value="error">配信途中のエラー</option>
              <option value="disconnect">途中切断（終了なし）</option>
              <option value="before-error">配信開始前のエラー</option>
            </select>
            <p className="mt-4 text-xs leading-6 text-stone-500">
              処理工程と返答が順に届きます。生成中は停止でき、未完了の返答は完了として扱いません。
            </p>
          </div>
          <div className="px-2 text-xs leading-6 text-stone-400">
            <p>
              外部のAIサービスには接続しません。会話はこの画面のメモリ内にあり、再読み込みすると消えます。
            </p>
            <p className="mt-3">AI候補の採用とTODOの保存は、TODO画面から操作できます。</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
