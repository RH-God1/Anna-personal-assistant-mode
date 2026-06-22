from playwright.async_api import async_playwright


class BrowserTool:
    async def open(self, url: str) -> dict:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            title = await page.title()
            final_url = page.url
            await browser.close()
            return {"url": final_url, "title": title}

    async def screenshot(self, url: str) -> dict:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            image = await page.screenshot(full_page=False)
            await browser.close()
            return {"url": url, "mime_type": "image/png", "base64_length": len(image)}

    async def extract_text(self, url: str) -> dict:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            text = await page.locator("body").inner_text(timeout=10_000)
            await browser.close()
            return {"url": url, "text": text[:20_000]}

