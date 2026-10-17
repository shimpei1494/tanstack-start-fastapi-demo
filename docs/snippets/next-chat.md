# チャット: Route Handler + 同じTanStack AI

**概念例 / 未ビルド・未型チェック・未実行。** Next.js用のHTTP接続に変える部分を示すJS/JSXです。ここではUI・AG-UI契約を揃え、通信入口だけを比較します。

Start実装は`useChat`のfetcher → `chatFn` → `openChatStream` → FastAPIです。Next.jsなら同じ`useChat`をHTTP接続し、Route Handler → FastAPIという経路にできます。

```jsx
// app/chat/chat.jsx
'use client'
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'

export function Chat() {
  const chat = useChat({ connection: fetchServerSentEvents('/api/chat') })
  // message.partsの表示、フォーム、工程イベントの表示はStartと同じ考え方。
  // ボタンからchat.sendMessage(text)、chat.stop()、chat.reload()を呼ぶ。
  return <ChatView chat={chat} /> // 表示部品の実装は省略
}
```

```js
// app/api/chat/route.js
import { toServerSentEventsResponse } from '@tanstack/ai'
import { readChatEvents, relayChatEvents, runAgentInputSchema } from '@demo/chat-adapter'

export const runtime = 'nodejs'

export async function POST(request) {
  let input
  try {
    const { data: legacyData, ...body } = await request.json()
    // SDK 0.69.0のHTTP接続が送る後方互換用dataは捨てる。
    // AG-UIのforwardedPropsだけを検証し、未対応の値は拒否する。
    input = runAgentInputSchema.parse(body)
  } catch {
    return Response.json({ error: 'チャット入力を確認してください' }, { status: 400 })
  }
  const downstream = new AbortController()
  const signal = AbortSignal.any([
    request.signal, downstream.signal, AbortSignal.timeout(60_000),
  ])
  try {
    const upstream = await fetch(`${process.env.API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    })
    if (!upstream.ok || !upstream.body ||
        !upstream.headers.get('content-type')?.startsWith('text/event-stream')) {
      await upstream.body?.cancel()
      return Response.json({ error: '配信を開始できませんでした' }, { status: 502 })
    }
    const events = readChatEvents(upstream.body, input, signal)
    return toServerSentEventsResponse(relayChatEvents(events, signal), {
      abortController: downstream,
      headers: { 'X-Accel-Buffering': 'no' },
    })
  } catch {
    // SSEのヘッダー送信前の失敗。配信開始後はrelayChatEventsが扱う。
    return Response.json({ error: '配信を開始できませんでした' }, { status: 502 })
  }
}
```

`ChatView`は表示を省略した説明用名で、実在するexportではありません。Route Handlerはこのリポジトリの`readChatEvents`と`relayChatEvents`を使い、イベント、順序、ID、終端、途中切断、配信エラーをStartと同じ契約で扱う想定です。上流接続設定や停止の到達には移植後の実機検証が必要です。

`fetchServerSentEvents`の採用版は、`forwardedProps`に加えて後方互換用の`data`もHTTP本文へ含めます。この例では`data`を明示的に捨ててから、デモのstrictなRunAgentInputへ検証します。任意フィールドをPythonへ一括転送しません。SDKの最新版に合わせる場合は、入力形式を再確認してください。

Startの実装では、上流fetchを[chat.server.ts](../../apps/web/src/server/api-client/chat.server.ts)、キャンセルとレスポンスを[chat.ts](../../apps/web/src/server/functions/chat.ts)へ分けています。ストリームを`text()`や`json()`で全件読み取ってから返す処理はありません。内部接続先の`API_BASE_URL`はサーバー専用設定に置きます。

StartのfetcherはUIMessageを受け、`chatInputSchema`でこのデモのRunAgentInputへ整形します。一方、HTTP接続の例ではSDKがRunAgentInputを組み立てるため、Route Handlerでは`runAgentInputSchema`を使います。SDKや契約の版が変わればこの入力対応も確認が必要です。

工程表示・エラー表示・再生成等のUI部品はここでは省略しています。同じAPIのダミー配信と同じTanStack AIを使うため、SDKの便利さをStart固有の優位とは扱いません。停止の到達、最初のチャンクが完了前に届くこと、途中切断の扱いはNext.js側でも別途実機検証が必要です。

出典: [Next.js Route Handler](https://nextjs.org/docs/app/api-reference/file-conventions/route)、[TanStack AI Transports](https://tanstack.com/ai/latest/docs/transports/overview)、[Server Functions](https://tanstack.com/ai/latest/docs/transports/server-functions)。
