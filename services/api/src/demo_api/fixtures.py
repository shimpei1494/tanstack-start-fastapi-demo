"""Deterministic dummy responses. No network, model, or external credentials."""

SEED_TODOS = (
    ("93ad62c0-c095-4862-a93a-c7181fd765bf", "TanStack Startのサーバー関数を読む", False),
    ("9eb6d1f5-208e-4eba-b6cf-3c117ba9dc10", "AI候補をプレビューして追加する", False),
    ("59168199-7dd1-4539-8a9c-91c82bf70712", "デモの構成図を確認する", True),
)

SUGGESTIONS = ("テーマを決める", "資料を作る", "参加者に案内する")
CHAT_DELTAS = (
    "まず、目的を小さな作業に分けましょう。\n\n",
    "1. テーマとゴールを決める\n",
    "2. 必要な資料を準備する\n",
    "3. 関係者に案内する\n\n",
    "TODO画面で候補を確認し、必要なものから追加できます。",
    "これは固定ルールで返すダミーAIの回答です。",
)

UNAVAILABLE_MESSAGE = "ダミーAIのエラーを再現しました。もう一度お試しください。"
STREAM_ERROR_MESSAGE = "回答の途中でダミーAIが停止しました。再生成をお試しください。"
