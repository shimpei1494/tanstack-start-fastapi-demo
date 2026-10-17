import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.log("BROWSER ERROR", error.message));
});

test("TODO CRUD, URL filters, persistence, suggestions adopted only once", async ({ page }) => {
  await page.goto("/todos");
  const title = `ブラウザ検証 ${Date.now()}`;
  await page.getByLabel("新しいTODO").fill(title);
  await page.getByRole("button", { name: "TODOを追加", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${title}を編集`, exact: true }).click();
  await page.getByLabel("タイトルを編集").fill(`${title} 更新`);
  await page.getByRole("button", { name: "編集を保存" }).click();
  await expect(page.getByText(`${title} 更新`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${title} 更新を完了にする` }).click();
  await page.getByRole("link", { name: "未完了", exact: true }).click();
  await expect(page).toHaveURL(/filter=active/);
  await expect(page.getByText(`${title} 更新`, { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "完了", exact: true }).click();
  await expect(page.getByText(`${title} 更新`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${title} 更新を削除` }).click();
  await expect(page.getByText(`${title} 更新`, { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "すべて", exact: true }).click();
  await expect(page.getByText(`${title} 更新`, { exact: true })).toHaveCount(0);
  const count = await page.locator('section[aria-labelledby="todo-heading"] li').count();
  await page.getByLabel("達成したいこと").fill("勉強会を企画する");
  await page.getByRole("button", { name: "TODOを提案する" }).click();
  await expect(page.getByRole("button", { name: "TODOに追加" }).first()).toBeVisible();
  await expect(page.locator('section[aria-labelledby="todo-heading"] li')).toHaveCount(count);
  await page.getByRole("button", { name: "TODOに追加" }).first().click();
  await expect(page.getByRole("button", { name: "追加済み" })).toBeDisabled();
  await expect(page.locator('section[aria-labelledby="todo-heading"] li')).toHaveCount(count + 1);
  await page.getByLabel("デモの応答").selectOption("error");
  await page.getByRole("button", { name: "TODOを提案する" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("chat streams partial text before completion, regenerates with a fresh run", async ({
  page,
}) => {
  await page.goto("/chat");
  await page.getByLabel("次の応答").selectOption("slow");
  await page.getByLabel("メッセージ", { exact: true }).fill("勉強会の準備を手伝って");
  await page.getByRole("button", { name: "メッセージを送信" }).click();
  await expect(page.getByTestId("assistant-message")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await expect(page.getByTestId("chat-status")).toHaveText("回答が完了しました", {
    timeout: 20_000,
  });
  const text = await page.getByTestId("assistant-message").textContent();
  expect(text?.length).toBeGreaterThan(20);
  await page.getByLabel("次の応答").selectOption("normal");
  await page.getByRole("button", { name: "返答を再生成" }).click();
  await expect(page.getByTestId("chat-status")).toHaveText("回答が完了しました");
});

test("stop keeps partial response incomplete and TODO stays usable", async ({ page }) => {
  await page.goto("/chat");
  await page.getByLabel("次の応答").selectOption("slow");
  await page.getByLabel("メッセージ", { exact: true }).fill("停止を確認する");
  await page.getByRole("button", { name: "メッセージを送信" }).click();
  await expect(page.getByTestId("assistant-message")).not.toBeEmpty();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByTestId("chat-status")).toHaveText("生成を停止しました（未完了）");
  const partial = await page.getByTestId("assistant-message").textContent();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("assistant-message")).toHaveText(partial ?? "");
  await page.getByRole("link", { name: "TODO", exact: true }).click();
  await page.getByLabel("新しいTODO").fill(`停止後のTODO ${Date.now()}`);
  await page.getByRole("button", { name: "TODOを追加", exact: true }).click();
  await expect(page.getByText(/停止後のTODO/).last()).toBeVisible();
});

for (const scenario of ["error", "disconnect", "before-error"]) {
  test(`chat ${scenario} remains an error, never a successful result`, async ({ page }) => {
    await page.goto("/chat");
    await page.getByLabel("次の応答").selectOption(scenario);
    await page.getByLabel("メッセージ", { exact: true }).fill("失敗の動作を確認する");
    await page.getByRole("button", { name: "メッセージを送信" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("chat-status")).toHaveText("回答は完了していません");
    await expect(page.getByRole("button", { name: "返答を再生成" })).toBeVisible();
  });
}

test("stopping before first text allows the next message in the same conversation", async ({
  page,
}) => {
  await page.goto("/chat");
  await page.getByLabel("次の応答").selectOption("slow");
  await page.getByLabel("メッセージ", { exact: true }).fill("最初の文字が届く前に止める");
  await page.getByRole("button", { name: "メッセージを送信" }).click();
  await expect(page.getByTestId("assistant-message")).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByTestId("chat-status")).toHaveText("生成を停止しました（未完了）");
  await page.getByLabel("次の応答").selectOption("normal");
  await page.getByLabel("メッセージ", { exact: true }).fill("続けて相談したい");
  await page.getByRole("button", { name: "メッセージを送信" }).click();
  await expect(page.getByTestId("chat-status")).toHaveText("回答が完了しました");
  await expect(page.getByTestId("assistant-message").last()).not.toBeEmpty();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
