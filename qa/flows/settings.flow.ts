import type { Page } from "@playwright/test";
import { expect, test } from "../lib/proof.ts";

test("let visitors send voice messages from a chat widget", async ({ page, proof }) => {
  await proof.open("/settings/brands");
  await page.getByRole("link", { name: /^Margin Default/ }).click();
  await page.getByRole("tab", { name: /Chat widgets/ }).click();
  await page.getByRole("tabpanel").getByRole("link").first().click();
  const voice = page.getByRole("switch", { name: "Let visitors send voice messages" });
  await expect(voice).toBeVisible();
  await voice.scrollIntoViewIfNeeded();
  await proof.chapter("Voice messages", "Turn them on for a widget and set the longest recording");
  await proof.shot("voice-off", { caption: "Voice messages, off by default" });

  await voice.click();
  const length = page.getByLabel("Longest voice message");
  await expect(length).toBeVisible();
  await proof.shot("voice-on", { caption: "On, with the longest voice message in seconds" });

  await length.fill("90");
  await length.blur();
  await expect(length).toHaveValue("90");
  await proof.dwell();
  await proof.shot("voice-length", { caption: "The longest voice message set to 90 seconds" });
});

test("write a widget's chat intro and open new chats without a welcome", async ({ page, proof }) => {
  await proof.open("/settings/brands");
  await page.getByRole("link", { name: /^Margin Default/ }).click();
  await page.getByRole("tab", { name: /Chat widgets/ }).click();
  await page.getByRole("tabpanel").getByRole("link").first().click();
  const intro = page.getByLabel("Chat intro");
  await expect(intro).toBeVisible();
  // A new chat opens on the welcome when it asks for no email or topic first.
  await page.getByRole("switch", { name: "Ask for an email first" }).click();
  for (const name of ["Billing and plans", "Technical help", "Legal and privacy"]) await page.getByRole("button", { name: `Remove ${name}` }).click();
  await intro.scrollIntoViewIfNeeded();
  const nudge = page.getByRole("button", { name: "Not now" });
  if (await nudge.isVisible()) await nudge.click();
  await proof.chapter("Chat intro", "The line under the greeting when a visitor starts a new chat");
  await intro.click();
  await intro.pressSequentially("Ask about orders, delivery or returns.", { delay: 40 });
  const preview = page.locator("[data-opendesk-preview]").getByText("Ask about orders, delivery or returns.");
  await expect(preview).toBeVisible();
  await proof.dwell();
  await proof.shot("chat-intro", { caption: "The chat intro, and the preview on a new chat showing it under the greeting" });

  const welcome = page.getByRole("switch", { name: "Welcome text in a new chat" });
  await expect(welcome).toBeChecked();
  await welcome.click();
  await expect(welcome).not.toBeChecked();
  await intro.focus();
  await expect(preview).toBeHidden();
  await proof.dwell();
  await proof.shot("welcome-off", { caption: "Welcome text off: a new chat opens empty" });
});

test("pick Azerbaijani and show customer pages in it for everyone", async ({ page, proof }) => {
  await proof.open("/settings/workspace");
  const language = page.getByRole("button", { name: "English" });
  await expect(language).toBeVisible();
  const nudge = page.getByRole("button", { name: "Not now" });
  if (await nudge.isVisible()) await nudge.click();
  await language.scrollIntoViewIfNeeded();
  await proof.chapter("Customer language", "Azerbaijani joins the list, and one language can go to every visitor");
  const search = page.getByPlaceholder("Search languages");
  await expect(async () => {
    if (!(await search.isVisible())) await language.click();
    await expect(search).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await search.pressSequentially("Az", { delay: 80 });
  const az = page.getByRole("option", { name: /Azərbaycan dili/ });
  await expect(az).toBeVisible();
  await proof.shot("languages", { caption: "Azərbaycan dili in the customer languages, found by searching" });

  await az.click();
  const fixed = page.getByRole("switch", { name: "Use for everyone" });
  await expect(page.getByText(/in Azərbaycan dili for every visitor/)).toBeVisible();
  await fixed.click();
  await expect(fixed).toBeChecked();
  await proof.dwell();
  await proof.shot("fixed", { caption: "Azərbaycan dili, used for every visitor whatever their browser language" });
});

test("a survey in the workspace's fixed language", async ({ page, proof }) => {
  await proof.open("/csat", { mock_locale: "az" });
  await page.evaluate(() => (location.hash = "t=demo"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Söhbətiniz necə keçdi?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dil" })).toBeHidden();
  await proof.chapter("Satisfaction survey", "In the workspace's language for everyone, with no language menu");
  await proof.dwell();
  await proof.shot("csat-fixed", { caption: "The survey in Azerbaijani on an English browser, without the language menu" });
});

// Ollie's tips (paused here, as "Pause for a week" would) sit over the page header.
async function openSupportChannels(page: Page, proof: { open: (path: string) => Promise<unknown> }) {
  await page.addInitScript(() => localStorage.setItem("od-ollie-tips", JSON.stringify({ paused: Number.MAX_SAFE_INTEGER })));
  await proof.open("/settings/support-channels");
}

test("connect Discord, pick its server and route a channel in one go", async ({ page, proof }) => {
  await openSupportChannels(page, proof);
  await expect(page.getByRole("heading", { name: "Support channels", exact: true })).toBeVisible();
  await expect(page.getByText("No support channels yet")).toBeVisible();
  await proof.chapter("Support channels", "Connect a bot and choose where tickets appear");
  await proof.shot("empty", { caption: "Support channels before a provider is connected, with the new tip about creating tickets" });

  await page.getByRole("button", { name: "Discord" }).click();
  const connect = page.getByRole("dialog", { name: "Connect Discord" });
  await expect(connect).toBeVisible();
  await connect.getByLabel("Bot token").pressSequentially("demo-discord-token", { delay: 20 });
  await connect.getByLabel("Interactions public key").fill("demo-public-key");
  await connect.getByRole("button", { name: "Find servers" }).click();
  await expect(connect.getByText("Margin community")).toBeVisible();
  await proof.shot("connect-discord", { caption: "The bot's only server is chosen for you", target: connect });
  await connect.getByRole("button", { name: "Connect", exact: true }).click();

  const destination = page.getByRole("dialog", { name: "Add destination" });
  await expect(destination).toBeVisible();
  await destination.getByLabel("Provider channel").click();
  await page.getByRole("option", { name: "#support" }).click();
  await proof.shot("destination", { caption: "Right after connecting, the channel picker opens with the bot's text channels", target: destination });
  await destination.getByRole("button", { name: "Add destination" }).click();

  await expect(page.getByRole("button", { name: "Remove support" })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await proof.dwell();
  await proof.shot("connected", { caption: "One status for the connection, and no webhook address to copy: opendesk set Discord up" });
});

test("finish Slack's setup and route Telegram by channel ID", async ({ page, proof }) => {
  await openSupportChannels(page, proof);
  await expect(page.getByText("No support channels yet")).toBeVisible();
  await proof.chapter("Slack", "The steps opendesk can't take for you, with the address to paste");
  await page.getByRole("button", { name: "Slack" }).click();
  const connect = page.getByRole("dialog", { name: "Connect Slack" });
  await connect.getByLabel("Bot token").fill("xoxb-demo");
  await connect.getByLabel("Signing secret").fill("demo-signing-secret");
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  const destination = page.getByRole("dialog", { name: "Add destination" });
  await destination.getByLabel("Provider channel").click();
  await page.getByRole("option", { name: "#support" }).click();
  await destination.getByRole("button", { name: "Add destination" }).click();
  await expect(page.getByText("Finish setting up the app")).toBeVisible();
  await expect(page.getByText("Finish setup", { exact: true })).toBeVisible();
  await proof.shot("slack-setup", { caption: "Slack shows the event, interactivity and command settings that share its signed callback address" });

  await proof.chapter("Telegram", "A new bot lists no groups yet, so enter the group's ID");
  await page.getByRole("button", { name: "Telegram" }).click();
  const telegram = page.getByRole("dialog", { name: "Connect Telegram" });
  await telegram.getByLabel("Bot token").fill("demo-telegram-token");
  await telegram.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(destination).toBeVisible();
  await expect(destination.getByText("No forum groups yet.", { exact: false })).toBeVisible();
  await proof.shot("telegram-none", { caption: "What to do in Telegram when the bot hasn't seen a group yet", target: destination });
  await destination.getByRole("button", { name: "Enter a channel ID instead" }).click();
  await destination.getByLabel("Channel ID").pressSequentially("-1001234567890", { delay: 40 });
  await proof.shot("telegram-id", { caption: "Or route the group by its ID", target: destination });
  await destination.getByRole("button", { name: "Add destination" }).click();

  await expect(page.getByRole("button", { name: "Remove -1001234567890" })).toBeVisible();
  await expect(page.getByText("@margin_support_bot", { exact: false })).toBeVisible();
  await proof.dwell();
  await proof.shot("connections", { caption: "Slack still needs its steps; Telegram shows the bot's handle and its routed group" });
});
