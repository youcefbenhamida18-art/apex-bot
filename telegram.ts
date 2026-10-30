/**
 * Telegram delivery (server-side only — token never reaches the browser).
 * Ordered queue + Markdown fallback + 429 handling.
 */

const queue: { text: string; resolve: (v: boolean) => void }[] = [];
let busy = false;

export function telegramConfigured() {
  return Boolean(token() && chatId());
}

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || "";
}
function chatId() {
  return process.env.TELEGRAM_CHAT_ID || "";
}

export function sendTelegram(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ text, resolve });
    if (!busy) void pump();
  });
}

async function pump() {
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    if (job) {
      try {
        await deliver(job.text);
      } catch {
        /* never break the engine because of a chat hiccup */
      }
      job.resolve(true);
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  busy = false;
}

async function deliver(text: string) {
  const t = token();
  const c = chatId();
  if (!t || !c) return;
  const url = `https://api.telegram.org/bot${t}/sendMessage`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: c,
          text: String(text).slice(0, 4000),
          parse_mode: attempt === 0 ? "Markdown" : undefined,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) return;
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
        await new Promise((r) => setTimeout(r, ((body.parameters?.retry_after ?? 5) + 1) * 1000));
        continue;
      }
      if (res.status === 400) continue; // retry without Markdown
      if (res.status === 401 || res.status === 404) return;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    } catch {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}
