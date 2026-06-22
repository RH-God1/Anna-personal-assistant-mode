const { test, expect } = require("@playwright/test");

test("用户可以在浏览器中完成本地 Agent 演示流程", async ({ page }) => {
  await page.goto("/demo");

  await expect(page).toHaveTitle("Travel Agent API Demo");
  await expect(page.getByRole("heading", { name: "Travel Agent API" })).toBeVisible();
  await expect(page.locator('#provider option[value="sandbox-flight"]')).toHaveCount(1);

  await page.getByRole("button", { name: "启动 Agent" }).click();
  await expect(page.locator("#status")).toHaveText("await_traveler_info");
  await expect(page.locator("#output")).toContainText('"state": "await_traveler_info"');

  await page.getByRole("button", { name: "用户已输入信息" }).click();
  await expect(page.locator("#status")).toHaveText("await_payment");

  await page.getByRole("button", { name: "用户已付款" }).click();
  await expect(page.locator("#status")).toHaveText("post_payment");
  await expect(page.locator("#output")).toContainText('"state": "post_payment"');
});
