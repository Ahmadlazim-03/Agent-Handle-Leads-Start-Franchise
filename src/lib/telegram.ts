import { LeadData } from './openai';
import { getRuntimeEnvValues } from './runtime-env';
import { buildTelegramChatCandidates, parseTelegramChatIds } from './telegram-chat-id';
import { appendDashboardLog } from './dashboard-logs';

async function getTelegramConfig(): Promise<{
  botToken: string;
  chatIds: string[];
} | null> {
  const runtimeValues = await getRuntimeEnvValues([
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ]);

  const botToken = runtimeValues.TELEGRAM_BOT_TOKEN.trim();
  const chatIds = parseTelegramChatIds(runtimeValues.TELEGRAM_CHAT_ID);

  if (!botToken || chatIds.length === 0) {
    console.error(
      'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID (supports comma/newline-separated values) in runtime config/dashboard or environment variables.'
    );
    void appendDashboardLog({
      level: 'warn',
      source: 'telegram',
      message: 'Konfigurasi Telegram belum lengkap.',
      details: 'TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID tidak tersedia.',
    });
    return null;
  }

  return { botToken, chatIds };
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
  let deliveredCount = 0;
  const failedTargets: string[] = [];

  try {
    for (const configuredChatId of config.chatIds) {
      const chatCandidates = buildTelegramChatCandidates(configuredChatId);
      let targetDelivered = false;
      let targetError = '';

      for (let index = 0; index < chatCandidates.length; index += 1) {
        const chatId = chatCandidates[index];
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
          if (chatId !== configuredChatId) {
            console.warn(
              `Telegram notification delivered using fallback chat_id=${chatId}. Consider updating TELEGRAM_CHAT_ID.`
            );
          }

          deliveredCount += 1;
          targetDelivered = true;
          break;
        }

        const errorBody = await response.text().catch(() => '');
        const isChatNotFound = /chat not found/i.test(errorBody);
        const hasMoreCandidates = index < chatCandidates.length - 1;

        if (isChatNotFound && hasMoreCandidates) {
          console.warn(`Telegram chat_id=${chatId} not found, trying fallback...`);
          continue;
        }

        targetError = `${response.status} ${response.statusText} ${errorBody.slice(0, 200)}`;
        break;
      }

      if (!targetDelivered) {
        failedTargets.push(
          targetError
            ? `${configuredChatId} (${targetError})`
            : configuredChatId
        );
      }
    }

    if (deliveredCount === 0) {
      console.error('Failed to send Telegram notification to all configured chat IDs.');
      void appendDashboardLog({
        level: 'error',
        source: 'telegram',
        message: 'Notifikasi Telegram gagal dikirim ke semua target.',
        details: {
          configuredTargets: config.chatIds.length,
          failedTargets,
        },
      });
      return false;
    }

    if (failedTargets.length > 0) {
      console.error(
        `Telegram notification partially sent (${deliveredCount}/${config.chatIds.length}). Failed targets: ${failedTargets.join(', ')}`
      );
      void appendDashboardLog({
        level: 'warn',
        source: 'telegram',
        message: 'Notifikasi Telegram terkirim sebagian.',
        details: {
          deliveredCount,
          configuredTargets: config.chatIds.length,
          failedTargets,
        },
      });
      return false;
    }

    console.log(
      `Telegram notification sent successfully to ${deliveredCount} chat ID(s).`
    );
    void appendDashboardLog({
      level: 'info',
      source: 'telegram',
      message: 'Notifikasi Telegram berhasil dikirim ke semua target.',
      details: {
        deliveredCount,
      },
    });
    return true;
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    void appendDashboardLog({
      level: 'error',
      source: 'telegram',
      message: 'Terjadi exception saat mengirim Telegram.',
      details: error,
    });
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
