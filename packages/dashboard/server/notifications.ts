import { nanoid } from "nanoid";
import { Config } from "./config.js";
import { appendNotification } from "./storage.js";
import type { AlertChannel, NotificationRecord, TransactionMatch, WatchRule } from "./types.js";
import { SOURCE_LIMIT_NOTICE } from "./constants.js";
import { getUserSettings } from "@myhome/shared";

type SendResult = {
  channel: AlertChannel;
  status: NotificationRecord["status"];
  message: string;
};

function formatAlert(rule: WatchRule, matches: TransactionMatch[]) {
  const displayMatches = matches.slice(0, 5);
  const extraCount = matches.length - 5;
  const matchLines = displayMatches.map((match, index) => {
    const area = match.areaM2 ? ` / ${match.areaM2}㎡` : "";
    const floor = match.floor ? ` / ${match.floor}층` : "";
    return `${index + 1}. ${match.apartmentName} ${match.priceEok.toFixed(2)}억 (${match.dealDate}${area}${floor})`;
  });

  const lines = [
    `[아파트 알림] ${rule.name}`,
    `지역: ${rule.regionName}${rule.apartmentKeywords?.length ? ` / 단지: ${rule.apartmentKeywords.join(", ")}` : ""}`,
    `조건: ${rule.minPriceEok ?? "-"}억 ~ ${rule.maxPriceEok ?? "-"}억 (최근 거래 자동 추적)`,
    "",
    ...matchLines,
    ...(extraCount > 0 ? [`... 외 ${extraCount}건 더 있음`] : []),
    "",
    SOURCE_LIMIT_NOTICE
  ];
  return lines.join("\n");
}

async function sendTelegram(rule: WatchRule, matches: TransactionMatch[], email: string): Promise<SendResult> {
  const settings = getUserSettings(email);
  const token = settings?.telegramBotToken || Config.TELEGRAM_BOT_TOKEN;
  const chatId = settings?.telegramChatId || Config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { channel: "telegram", status: "skipped", message: "Telegram credentials are not configured for this user." };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatAlert(rule, matches),
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const body = await response.text();
    return { channel: "telegram", status: "failed", message: `Telegram failed: ${response.status} ${body}` };
  }
  return { channel: "telegram", status: "sent", message: "Telegram alert sent." };
}

async function sendKakao(): Promise<SendResult> {
  return { channel: "kakao", status: "skipped", message: "Kakao send-to-me is reserved for phase 2." };
}

export async function sendNotifications(rule: WatchRule, matches: TransactionMatch[], email: string = "bootstrap-admin@myhome.local") {
  if (matches.length === 0) return [];

  const results: NotificationRecord[] = [];
  for (const channel of rule.channels) {
    const result = channel === "telegram" ? await sendTelegram(rule, matches, email) : await sendKakao();
    const record: NotificationRecord = {
      id: nanoid(),
      ruleId: rule.id,
      channel: result.channel,
      status: result.status,
      message: result.message,
      dedupeKeys: matches.map((match) => match.dedupeKey),
      createdAt: new Date().toISOString()
    };
    await appendNotification(record, email);
    results.push(record);
  }
  return results;
}

export function isTelegramConfigured() {
  return Boolean(Config.TELEGRAM_BOT_TOKEN && Config.TELEGRAM_CHAT_ID);
}
