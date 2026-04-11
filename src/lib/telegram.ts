import { LeadData } from './openai';
import { getRuntimeEnvValues } from './runtime-env';

async function getTelegramConfig(): Promise<{ botToken: string; chatId: string } | null> {
  const runtimeValues = await getRuntimeEnvValues([
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ]);

  const botToken = runtimeValues.TELEGRAM_BOT_TOKEN.trim();
  const chatId = runtimeValues.TELEGRAM_CHAT_ID.trim();

  if (!botToken || !chatId) {
    console.error(
      'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in runtime config/dashboard or environment variables.'
    );
    return null;
  }

  return { botToken, chatId };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLeadIdentifier(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  if (!trimmed) {
    return '';
  }

  if (/@lid$/i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/\D/g, '');
}

function buildWaLink(leadIdentifier: string): string {
  if (!leadIdentifier || /@lid$/i.test(leadIdentifier)) {
    return '-';
  }

  const phoneDigits = leadIdentifier.replace(/\D/g, '');
  if (!phoneDigits) {
    return '-';
  }

  return `https://wa.me/${phoneDigits}`;
}

async function sendTelegramHtmlMessage(message: string): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) {
    return false;
  }

  const telegramApiUrl = `https://api.telegram.org/bot${config.botToken}`;

  try {
    const chatCandidates = [config.chatId];
    if (config.chatId.startsWith('-') && !config.chatId.startsWith('-100')) {
      chatCandidates.push(`-100${config.chatId.slice(1)}`);
    }

    for (const chatId of chatCandidates) {
      const response = await fetch(`${telegramApiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (response.ok) {
        if (chatId !== config.chatId) {
          console.warn(
            `Telegram notification delivered using fallback chat_id=${chatId}. Consider updating TELEGRAM_CHAT_ID.`
          );
        }

        console.log('Telegram notification sent successfully');
        return true;
      }

      const errorBody = await response.text().catch(() => '');
      const isChatNotFound = /chat not found/i.test(errorBody);

      if (isChatNotFound && chatId !== chatCandidates[chatCandidates.length - 1]) {
        console.warn(
          `Telegram chat_id=${chatId} not found, trying next candidate...`
        );
        continue;
      }

      console.error(
        `Failed to send Telegram notification: status=${response.status} statusText=${response.statusText} body=${errorBody.slice(0, 500)}`
      );
      return false;
    }

    return false;
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    return false;
  }
}

function safeCollectedValue(collectedData: Record<string, string>, key: string): string {
  const value = collectedData[key]?.trim();
  if (!value) {
    return '-';
  }

  return value;
}

function formatDealMeetingMessage(
  phoneNumber: string,
  meetingSchedule: string,
  latestUserMessage: string,
  collectedData: Record<string, string>
): string {
  const safeBiodata = escapeHtml(safeCollectedValue(collectedData, 'biodata'));
  const safeBidangUsaha = escapeHtml(safeCollectedValue(collectedData, 'bidangUsaha'));
  const safeSumberInfo = escapeHtml(safeCollectedValue(collectedData, 'sumberInfo'));
  const safeBudget = escapeHtml(safeCollectedValue(collectedData, 'budget'));
  const safeRencanaMulai = escapeHtml(safeCollectedValue(collectedData, 'rencanaMulai'));
  const safeMeetingSchedule = escapeHtml(meetingSchedule || '-');
  const safeLatestUserMessage = escapeHtml(latestUserMessage || '-');
  const leadIdentifier = normalizeLeadIdentifier(phoneNumber);
  const safeLeadIdentifier = escapeHtml(leadIdentifier || '-');
  const waLink = buildWaLink(leadIdentifier);

  return `<b>Lead Deal + Meeting Confirmed</b> ✅

<b>Lead ID:</b> ${safeLeadIdentifier}

<b>Biodata:</b> ${safeBiodata}
<b>Usaha:</b> ${safeBidangUsaha}
<b>Sumber:</b> ${safeSumberInfo}
<b>Budget:</b> ${safeBudget}
<b>Rencana:</b> ${safeRencanaMulai}
<b>Jadwal Meeting:</b> ${safeMeetingSchedule}

<b>Pesan User:</b> ${safeLatestUserMessage}
<b>WA Link:</b> ${waLink}`;
}

export async function sendTelegramNotification(
  lead: LeadData,
  phoneNumber: string
): Promise<boolean> {
  const message = formatLeadMessage(lead, phoneNumber);
  return sendTelegramHtmlMessage(message);
}

export async function sendTelegramDealMeetingNotification(input: {
  phoneNumber: string;
  meetingSchedule: string;
  latestUserMessage: string;
  collectedData: Record<string, string>;
}): Promise<boolean> {
  const message = formatDealMeetingMessage(
    input.phoneNumber,
    input.meetingSchedule,
    input.latestUserMessage,
    input.collectedData
  );

  return sendTelegramHtmlMessage(message);
}

function formatLeadMessage(lead: LeadData, phoneNumber: string): string {
  const safeBiodata = escapeHtml(lead.biodata);
  const safeBidangUsaha = escapeHtml(lead.bidangUsaha);
  const safeSumberInfo = escapeHtml(lead.sumberInfo);
  const safeBudget = escapeHtml(lead.budget);
  const safeRencanaMulai = escapeHtml(lead.rencanaMulai);
  const leadIdentifier = normalizeLeadIdentifier(phoneNumber);
  const safeLeadIdentifier = escapeHtml(leadIdentifier || '-');
  const waLink = buildWaLink(leadIdentifier);

  return `<b>New Lead Alert!</b> 🔥

<b>Lead ID:</b> ${safeLeadIdentifier}

<b>Biodata:</b> ${safeBiodata}
<b>Usaha:</b> ${safeBidangUsaha}
<b>Sumber:</b> ${safeSumberInfo}
<b>Budget:</b> ${safeBudget}
<b>Rencana:</b> ${safeRencanaMulai}

<b>WA Link:</b> ${waLink}`;
}
