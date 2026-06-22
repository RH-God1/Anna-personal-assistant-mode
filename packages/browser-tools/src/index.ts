import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import type { ToolDefinition } from "@anna/tool-registry";

const openInputSchema = z.object({
  url: z.string().url(),
  sessionId: z.string().default("default")
});

const selectorInputSchema = z.object({
  selector: z.string().min(1),
  sessionId: z.string().default("default"),
  timeoutMs: z.number().int().positive().max(30_000).default(10_000)
});

const typeInputSchema = selectorInputSchema.extend({
  text: z.string().max(10_000)
});

const screenshotInputSchema = z.object({
  sessionId: z.string().default("default"),
  fullPage: z.boolean().default(false)
});

export class BrowserSessionManager {
  private browser?: Browser;
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly pages = new Map<string, Page>();

  async open(sessionId: string, url: string): Promise<{ sessionId: string; url: string; title: string }> {
    const page = await this.getPage(sessionId);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { sessionId, url: page.url(), title: await page.title() };
  }

  async click(sessionId: string, selector: string, timeoutMs: number): Promise<{ sessionId: string; url: string }> {
    const page = await this.getPage(sessionId);
    await page.locator(selector).click({ timeout: timeoutMs });
    return { sessionId, url: page.url() };
  }

  async type(sessionId: string, selector: string, text: string, timeoutMs: number): Promise<{ sessionId: string; url: string }> {
    const page = await this.getPage(sessionId);
    await page.locator(selector).fill(text, { timeout: timeoutMs });
    return { sessionId, url: page.url() };
  }

  async screenshot(sessionId: string, fullPage: boolean): Promise<{ sessionId: string; mimeType: "image/png"; base64: string }> {
    const page = await this.getPage(sessionId);
    const buffer = await page.screenshot({ fullPage });
    return { sessionId, mimeType: "image/png", base64: buffer.toString("base64") };
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.contexts.values(), (context) => context.close()));
    if (this.browser) {
      await this.browser.close();
    }
    this.contexts.clear();
    this.pages.clear();
    this.browser = undefined;
  }

  private async getPage(sessionId: string): Promise<Page> {
    const existing = this.pages.get(sessionId);
    if (existing && !existing.isClosed()) {
      return existing;
    }

    if (!this.browser) {
      this.browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== "false" });
    }

    const context = await this.browser.newContext();
    const page = await context.newPage();
    this.contexts.set(sessionId, context);
    this.pages.set(sessionId, page);
    return page;
  }
}

export function createBrowserTools(manager = new BrowserSessionManager()): ToolDefinition[] {
  return [
    {
      id: "browser.open",
      description: "Open a URL in a controlled Playwright browser session.",
      riskLevel: "low",
      inputSchema: openInputSchema,
      capabilities: ["browser.navigate"],
      handler: async (input) => manager.open(input.sessionId, input.url)
    },
    {
      id: "browser.click",
      description: "Click a CSS selector in a controlled Playwright browser session.",
      riskLevel: "medium",
      inputSchema: selectorInputSchema,
      capabilities: ["browser.click"],
      handler: async (input) => manager.click(input.sessionId, input.selector, input.timeoutMs)
    },
    {
      id: "browser.type",
      description: "Type text into a CSS selector in a controlled Playwright browser session.",
      riskLevel: "medium",
      inputSchema: typeInputSchema,
      capabilities: ["browser.type"],
      handler: async (input) => manager.type(input.sessionId, input.selector, input.text, input.timeoutMs)
    },
    {
      id: "browser.screenshot",
      description: "Capture a screenshot from a controlled Playwright browser session.",
      riskLevel: "medium",
      inputSchema: screenshotInputSchema,
      capabilities: ["browser.screenshot"],
      handler: async (input) => manager.screenshot(input.sessionId, input.fullPage)
    }
  ];
}
