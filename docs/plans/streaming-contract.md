# DS APIのストリーミング共通契約案

案1と案2のチャットは、TanStack AIを初期から導入し、Python APIとの通信にAG-UIの基本イベントを使う。案件でチャットや途中配信が不要なら、関連画面と依存を削除できるようにする。通常のTODO CRUDやJSONの候補提案は、この仕組みに依存させない。

これは途中配信が必要な新規案件向けの共通ルール案であり、すべての案件やAPIへの適用を前提にしない。通常のCRUDやAI候補提案のJSON応答にはAG-UIを使わない。今回のデモでは、ストリーミングするチャットに適用する。

## 標準化する範囲

| 項目 | 共通方針 |
| --- | --- |
| 接続 | StartからPythonへHTTP POST、レスポンスはSSEのtext/event-stream |
| 入力 | AG-UIのRunAgentInputを使い、初期に受け付ける範囲を限定する |
| 出力 | AG-UIの実行、テキスト、工程の基本イベント |
| 実装 | Python SDKのイベント型とEventEncoder、TypeScript側の対応型と検証を利用する |
| 互換性 | Python SDK、AG-UIスキーマ、TanStack AIの組み合わせを契約テストで確認し、固定する |
| 案件ごとの定義 | 工程名、追加の業務入力、必要な場合だけ構造化結果のスキーマ |

AG-UIの全機能を初期に実装する必要はない。標準の基本イベントを用い、対応する機能範囲を明示する。未対応のツール実行、添付、再接続による途中再開等まで動くとは扱わない。[AG-UIのイベント](https://docs.ag-ui.com/concepts/events)、[TanStack AIのイベント](https://tanstack.com/ai/latest/docs/chat/stream-events)

## 入力と実行の識別

PythonのチャットAPIはRunAgentInputを受け取る。初期はテキストのuserとassistantメッセージだけを対応範囲とし、空のstate、tools、context等も採用スキーマに従って送る。TanStack AIのUIMessageをそのままPythonへ送らず、Startの境界で標準のメッセージ形式へ整える。

- threadIdは会話の識別子として継続利用する。DB保存や永続化を保証するIDではない。
- runIdは一回の実行の識別子とし、新しい送信や明示的な再生成で新しくする。自動の重複排除や再開は保証しない。
- messageIdは返答メッセージの識別子とし、同じ返答の開始、差分、終了で揃える。
- 案件固有の追加入力はforwardedProps等の標準の拡張箇所を使い、受け付けるキーとスキーマを契約へ記録する。

StartとPythonの両境界で入力を検証する。ブラウザから来た追加値をモデル設定やプロンプトへ一括展開しない。モデル、プロンプト、履歴の整形、検索、前後処理はDSが検証するPython側へ集約し、同じ関数を検証とAPIから利用する。Startが渡す業務データの形や、会話のどの範囲を入力に含めるかも合意する。[Pythonの型](https://docs.ag-ui.com/sdk/python/core/types)、[TanStack AIのAG-UI入力](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)

## 初期に使うイベント

| イベント | 必須と条件 | 目的 |
| --- | --- | --- |
| RUN_STARTED | 配信が始まった実行で必須 | 実行開始とthreadId、runId |
| STEP_STARTED / STEP_FINISHED | 工程を表示するとき | stepNameで処理段階を通知 |
| TEXT_MESSAGE_START | 返答テキストがあるとき | assistantの返答開始とmessageId |
| TEXT_MESSAGE_CONTENT | 返答テキストがあるとき | 同じmessageIdのdeltaを到着順に追加 |
| TEXT_MESSAGE_END | 返答を正常に閉じるとき | 返答メッセージの終了 |
| RUN_FINISHED | 実行が正常終了したとき | 実行全体の完了 |
| RUN_ERROR | 配信開始後に処理失敗したとき | 利用者へ示すmessageと分類用code |

稼働中の一つの実行はRUN_FINISHEDかRUN_ERRORのどちらか一つで終了する。切断や利用者の停止では終端イベントが届かない場合があり、成功として補完しない。TEXT_MESSAGE_ENDだけで実行全体を成功扱いにしない。配信開始前の入力不備等は通常のHTTPエラーとして返す。

工程名の初期例はretrieve、generate、validateとし、UI側で「関連情報を検索中」「回答を生成中」「回答を確認中」へ対応付ける。各案件で必要な工程だけを使い、実処理の開始と終了に合わせて送る。モデルの内部思考を出力することは求めず、利用者に説明できる業務上の段階を通知する。

### 正常な配信例

以下はHTTP本文のSSE例である。採用したSDKのエンコーダーで生成し、JSON文字列や区切りを各案件で手組みしない。

```text
data: {"type":"RUN_STARTED","threadId":"thread-1","runId":"run-1"}

data: {"type":"STEP_STARTED","stepName":"retrieve"}

data: {"type":"STEP_FINISHED","stepName":"retrieve"}

data: {"type":"STEP_STARTED","stepName":"generate"}

data: {"type":"TEXT_MESSAGE_START","messageId":"message-1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"message-1","delta":"まず、"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"message-1","delta":"テーマを決めましょう。"}

data: {"type":"TEXT_MESSAGE_END","messageId":"message-1"}

data: {"type":"STEP_FINISHED","stepName":"generate"}

data: {"type":"RUN_FINISHED","threadId":"thread-1","runId":"run-1"}

```

これはイベント順序の一例である。精度上、回答全体の検証を終えてから表示したい場合は、処理中は工程だけを送り、検証後に回答を返す。検証前の回答をすべて逐次公開することは共通ルールにしない。途中表示した文字列が後で失敗した場合も、自動で確定結果やDB保存の対象にしない。

## 構造化データと表示

工程とテキスト以外のデータが必要になったら、STATE_SNAPSHOT等の標準イベント、または名前とJSONスキーマを決めたCUSTOMを検討する。検索結果やグラフ用データの中身までAG-UIが自動で統一するわけではない。独自イベントを増やす前に用途、版、スキーマ、表示先を契約へ追加する。

初期のデモは工程とテキストに限定し、構造化イベントやツール実行の基盤を先に実装しない。AIのTODO候補は既存のJSON APIで返し、利用者の採用操作だけで保存する。

TanStack AIがテキストと会話状態を扱い、アプリ側の小さな共通フックと表示部品が工程名を進捗表示へ変える。工程イベントの受信だけで目的に合う画面が自動生成されるとは扱わない。採用版でonChunk等の受信口を確認し、会話状態をJotaiへ複製せず、工程の表示に必要な状態だけ持つ。[クライアントAPI](https://tanstack.com/ai/latest/docs/api/ai-client)

## PythonとStartの実装の分担

PythonはFastAPIの薄いルートと、ag_ui.coreのイベント型、ag_ui.encoderのEventEncoderを使う。SWEが開始、終了、エラー、切断の共通処理をひな形として用意し、DSは検証したPython関数や生成器を接続する。AG-UIを使うためにDSの推論や検索をTypeScriptへ移す必要はない。[Pythonサーバーの公式例](https://docs.ag-ui.com/quickstart/server)

Startは実行IDと入力を整え、PythonのAG-UIストリームを読み、検証してUIへ中継する。独自イベントへいったん変換してから同じ標準へ戻す処理は増やさない。TanStack AIの型との違いや配信方法の違いだけをchat-adapterへ閉じる。

案2のmockも同じAG-UIイベント列をサーバー内のasync generatorから返す。httpだけがSSEの読取りを行い、両方のDsClient.streamChatは同じ対応イベントのAsyncIterableを返す。Pythonなしでも、工程表示、部分回答、失敗、停止を再現できるようにする。

## 標準に加えて合意する運用

- 正常、配信前エラー、配信中エラー、終端なしの切断、利用者停止を区別する。
- RUN_ERRORのcodeと画面メッセージを共通化し、内部例外やログ全文を配信しない。
- 停止要求はブラウザ、Start、Python、推論処理まで可能な範囲で伝える。通信切断だけでGPU計算が必ず止まるとは扱わず、止められる範囲を確認する。
- 全体と無応答のタイムアウト、必要なSSEのkeep-alive、プロキシのバッファリングを配置環境に合わせて設定する。
- 一つのリクエストでの順序を守り、通信チャンクとイベント境界の違い、UTF-8の分割を処理する。
- 初期は自動再試行、途中再開、永続ジョブを提供しない。再生成は新しい実行とする。

標準化するのは送受信の形式と上記の挙動であり、AG-UIを導入するだけでこれらの運用が自動完成するわけではない。

## アプリ実装時に用意するもの

1. 対応イベントと入力、SDKバージョンを記録した契約ファイル。
2. Pythonの配信ひな形と、差し替えるダミー生成関数。
3. TypeScriptのDSクライアント、SSE読取り、工程表示フックとチャットUI。
4. 正常、工程付き、途中失敗、切断、停止の共通fixtureと契約テスト。
5. Pythonを起動しないモックと、HTTP接続での同じシナリオ。
6. チャットが不要な案件向けの削除箇所と、通常のJSON APIへの影響がないことの説明。

契約テストではスキーマだけでなくイベント順序、IDの対応、完了前のイベント到着、終端、停止伝播を確認する。AG-UI全体の適合性認証や、未実装機能を含む互換性を主張するものにはしない。
