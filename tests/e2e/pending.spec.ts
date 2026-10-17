import { test, expect } from "@playwright/test";

test("report shell streams before the Python result completes", async ({ baseURL }) => {
  const started = Date.now();
  const response = await fetch(`${baseURL}/reports?scenario=slow`, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36" },
  });
  expect(response.ok).toBe(true);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let pendingAt: number | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (pendingAt === undefined && html.includes("作業レポートを集計しています"))
      pendingAt = Date.now();
  }
  html += decoder.decode();
  expect(html).toContain("ここまでの作業を、ひと目で。");
  expect(pendingAt).toBeDefined();
  expect(Date.now() - pendingAt!).toBeGreaterThan(2000);
  expect(Date.now() - started).toBeGreaterThanOrEqual(2800);
  expect(html).toContain("最新の集計結果です。");
});

test("report pending keeps the page available; refresh keeps previous data", async ({ page }) => {
  await page.goto("/todos");
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await expect(page.getByRole("region", { name: "レポートを集計中", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ここまでの作業を、ひと目で。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "待ち時間なし", exact: true })).toBeVisible();
  const report = page.getByRole("region", { name: "作業レポート", exact: true });
  await expect(report).toBeVisible();
  await page.getByRole("button", { name: "再集計", exact: true }).click();
  await expect(page.getByRole("button", { name: "再集計", exact: true })).toBeDisabled();
  await expect(report).toBeVisible();
  await expect(report.getByText("前回の結果を表示しながら再集計しています…")).toBeVisible();
  await expect(page.getByRole("region", { name: "レポートを集計中", exact: true })).toHaveCount(0);
  await expect(report.getByText("最新の集計結果です。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再集計", exact: true })).toBeEnabled();
});

test("report delayed failure stays local and can retry or change scenario", async ({ page }) => {
  await page.goto("/reports?scenario=error", { waitUntil: "commit" });
  await expect(page.getByRole("region", { name: "レポートを集計中", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("作業レポートを作成できませんでした", {
    timeout: 12_000,
  });
  await expect(page.getByRole("heading", { name: "ここまでの作業を、ひと目で。" })).toBeVisible();
  await page.getByRole("button", { name: "もう一度試す", exact: true }).click();
  await expect(page.getByRole("region", { name: "レポートを集計中", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("作業レポートを作成できませんでした", {
    timeout: 12_000,
  });
  await page.getByRole("link", { name: "待ち時間なし", exact: true }).click();
  await expect(page.getByRole("region", { name: "作業レポート", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("suggestion mutation owns pending through delayed success and failure", async ({ page }) => {
  await page.goto("/todos");
  await page.getByLabel("達成したいこと").fill("勉強会を企画する");
  await page.getByLabel("デモの応答", { exact: true }).selectOption("slow");
  await page.getByRole("button", { name: "TODOを提案する", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "候補を考えています…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("目的に合うTODO候補を作成しています…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("達成したいこと")).toBeDisabled();
  await expect(page.getByRole("button", { name: "TODOに追加", exact: true }).first()).toBeVisible();
  await page.getByLabel("デモの応答", { exact: true }).selectOption("error");
  await page.getByRole("button", { name: "TODOを提案する", exact: true }).click();
  await expect(
    page.getByText("目的に合うTODO候補を作成しています…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "TODOに追加", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("ダミーAIのエラー");
  await expect(page.getByRole("button", { name: "TODOを提案する", exact: true })).toBeEnabled();
  await expect(page.getByLabel("達成したいこと")).toBeEnabled();
  await expect(page.getByText("目的に合うTODO候補を作成しています…", { exact: true })).toHaveCount(
    0,
  );
});
