// CareLayer MCP server (Z12): a woman asks a verified Nigerian nurse or midwife from inside Claude,
// and pays per answer from her CareLayer wallet (x402 on Stellar). Contract: docs/API_CONTRACT.md §13.
//
// Tools:
//   ask_health_worker  two steps: (1) a draft = the price and exactly what the nurse will see;
//                      (2) with confirm: true, sends it. Emergencies: the same free guidance as the
//                      web app, nothing is sent.
//   get_answer         status; when answered, collects it (free, or paid from her wallet over x402).
//                      If she asked to approve each payment, it asks first.
//   get_balance        her balance and free answers left.
//
// The API enforces the rules (agent token allow-list, Claude's spending limit, "ask before each
// payment"); these tools explain them to Claude in plain language.
import {
  API_CONTRACT_VERSION,
  type EmergencyResponse,
  type Money,
  type QuestionDraft,
  type SharedField,
} from '@carelayer/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CareLayerApiError, type CareLayerApi } from './api.js';

export const SERVER_NAME = 'carelayer';
export const SERVER_VERSION = '1.0.0';

/** What a confirmed question shares with the nurse (the signed draft pins the values). Never her name, email or phone; never her raw words. */
const SHARED_FIELDS: SharedField[] = [
  'cleaned_text',
  'category',
  'assistant_notes',
  'age_range',
  'pregnancy_weeks',
];

const naira = (m: Money) =>
  `₦${(m.kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const AGE_LABEL: Record<string, string> = {
  under_18: 'under 18',
  age_18_24: '18–24',
  age_25_34: '25–34',
  age_35_44: '35–44',
  age_45_plus: '45 or older',
};

function text(body: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: body }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function emergencyText(e: EmergencyResponse): CallToolResult {
  const contacts = e.contacts
    .map((c) => `- ${c.label}: ${c.number}${c.verified ? '' : ' (number not yet verified)'}`)
    .join('\n');
  return text(
    [
      'EMERGENCY. This may need urgent care: nothing was sent to a nurse and she has NOT been charged.',
      'Show her this right away, word for word:',
      '',
      e.message,
      '',
      'Who to call:',
      contacts,
      `Find a hospital near her: ${e.findHospitalUrl}`,
    ].join('\n'),
    { ...e },
  );
}

/** Plain-language errors Claude can relay. */
function errorResult(err: unknown): CallToolResult {
  if (!(err instanceof CareLayerApiError)) throw err;
  const d = err.details;
  const messages: Record<string, string> = {
    UNAUTHENTICATED:
      'This Claude connection to CareLayer is not valid any more (it may have been removed). She can create a new one in the CareLayer app: Account > Use CareLayer in Claude.',
    FORBIDDEN: 'CareLayer does not allow this through Claude. She can do it in the CareLayer app.',
    SPENDING_LIMIT_EXCEEDED: `This costs more than her Claude spending limit per answer${
      typeof d.spendingLimitKobo === 'number' ? ` (₦${d.spendingLimitKobo / 100})` : ''
    }. Claude cannot go past that limit: she can raise it in the CareLayer app (Account), or do this in the app.`,
    INSUFFICIENT_BALANCE:
      'There is not enough money in her CareLayer wallet for this answer. She can top up in the CareLayer app (Wallet > Top up), then ask again.',
    QUESTION_NOT_ANSWERED: 'No nurse has answered yet. Nothing has been charged.',
    QUESTION_EXPIRED:
      'No nurse picked this question up in time, so it expired. She was not charged. She can ask again.',
    RATE_LIMITED: 'Too many requests in a short time. Wait a minute and try again.',
    SERVICE_UNAVAILABLE: `CareLayer is busy right now; nothing was charged. Try again in a moment.${
      d.paymentPending ? ' (A payment is being confirmed: do not ask her to pay again.)' : ''
    }`,
    NOT_FOUND: 'CareLayer has no question with that id for her.',
    VALIDATION_FAILED: `CareLayer could not accept this: ${err.message}`,
  };
  return {
    isError: true,
    content: [{ type: 'text', text: messages[err.code] ?? `CareLayer: ${err.message}` }],
    structuredContent: { error: { code: err.code, message: err.message, details: d } },
  };
}

function describeDraft(draft: QuestionDraft): string {
  const lines = [`Question (spelling and grammar fixed, nothing removed): "${draft.cleanedText}"`];
  lines.push(`Topic: ${draft.category.replace('_', ' ')}`);
  if (draft.ageRange) lines.push(`Age range: ${AGE_LABEL[draft.ageRange] ?? draft.ageRange}`);
  if (draft.pregnancyWeeks !== null) lines.push(`Pregnancy: ${draft.pregnancyWeeks} weeks`);
  if (draft.assistantNotes) lines.push(`Note for the nurse: ${draft.assistantNotes}`);
  return lines.map((l) => `- ${l}`).join('\n');
}

export function createServer(api: CareLayerApi): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        'CareLayer connects her to a verified Nigerian nurse or midwife who answers her health question in writing, paid per answer from her CareLayer wallet (her first 3 answers are free).',
        'Always show her the price and exactly what will be shared, and get a clear yes before sending a question or paying for an answer.',
        'If a tool reports an EMERGENCY, show its guidance immediately and do not send anything.',
        'Nurses give general guidance, not a diagnosis or prescription.',
      ].join(' '),
    },
  );

  server.registerTool(
    'ask_health_worker',
    {
      title: 'Ask a verified nurse or midwife',
      description: [
        'Sends her health question to a verified Nigerian nurse or midwife through CareLayer. Pay on delivery: nothing is charged until a nurse answers; if nobody picks it up within 30 minutes she pays nothing.',
        'TWO STEPS. Step 1: call with her question in her own words (confirm omitted). You get the price (or "free") and exactly what the nurse will see, plus a draftToken. Show her both and ask if she wants to send it.',
        'Step 2: ONLY after she clearly says yes, call again with the SAME question, confirm: true and the draftToken. Never confirm on her behalf.',
        'If the result is an EMERGENCY, show the guidance at once; nothing is sent.',
      ].join(' '),
      inputSchema: {
        question: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe('Her question, in her own words (do not summarise or rewrite it).'),
        confirm: z
          .boolean()
          .optional()
          .describe('true ONLY after she agreed to the price and what is shared (step 2).'),
        draftToken: z.string().optional().describe('From step 1. Required with confirm: true.'),
        femaleOnly: z
          .boolean()
          .optional()
          .describe('true if she wants only female health workers to see it.'),
      },
    },
    async ({ question, confirm, draftToken, femaleOnly }) => {
      try {
        if (!confirm) {
          const drafted = await api.draft(question);
          if (drafted.kind === 'emergency') return emergencyText(drafted);
          const { draft, offer } = drafted;
          const price = offer.isFree
            ? `FREE (one of her first 3 free answers; ${offer.freeAnswersRemaining} left including this one)`
            : `${naira(offer.price)} (about ${offer.price.usdc} USDC), paid from her CareLayer wallet only when the answer arrives`;
          const limit = offer.exceedsSpendingLimit
            ? '\nWARNING: this is above her Claude spending limit per answer, so CareLayer will refuse to send it from Claude. She can raise the limit in the CareLayer app or ask there.'
            : '';
          return text(
            [
              'Not sent yet. Show her this and ask whether to send it:',
              '',
              `Price: ${price}`,
              'What the nurse will see (never her name, email or phone):',
              describeDraft(draft),
              '',
              'A verified nurse or midwife answers in writing, usually within 30 minutes. If nobody picks it up in 30 minutes, it is cancelled and she pays nothing. Nurses give general guidance, not a diagnosis or a prescription.',
              limit,
              `If she says yes: call ask_health_worker again with the same question, confirm: true and draftToken: "${drafted.draftToken}" (valid until ${drafted.draftExpiresAt}).`,
            ]
              .filter((l) => l !== '')
              .join('\n'),
            {
              kind: 'draft',
              draftToken: drafted.draftToken,
              draftExpiresAt: drafted.draftExpiresAt,
              price: offer.price,
              isFree: offer.isFree,
              exceedsSpendingLimit: offer.exceedsSpendingLimit,
              draft,
            },
          );
        }

        if (!draftToken) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'confirm: true needs the draftToken from step 1. Call ask_health_worker without confirm first and show her the price and what will be shared.',
              },
            ],
          };
        }
        const sent = await api.sendQuestion({
          question,
          draftToken,
          sharedFields: SHARED_FIELDS,
          femaleOnly,
        });
        if (sent.kind === 'emergency') return emergencyText(sent);
        return text(
          [
            `Sent to CareLayer's verified nurses and midwives. Question id: ${sent.id}.`,
            sent.isFree
              ? 'This answer is free for her.'
              : `She will pay ${naira(sent.price)} only when the answer arrives.`,
            `If nobody picks it up by ${sent.claimsCloseAt}, it is cancelled and she pays nothing.`,
            `Check for the answer later with get_answer (questionId: "${sent.id}").`,
          ].join('\n'),
          { ...sent },
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_answer',
    {
      title: "Get the nurse's answer",
      description: [
        'Checks a question sent with ask_health_worker and, once a nurse has answered, gets the answer.',
        'Free answers come straight away. A paid answer is paid from her CareLayer wallet (x402 on Stellar).',
        'If she asked to approve each payment, the first call tells you the price: ask her, and ONLY if she says yes call again with confirmPayment: true.',
        'Calling again after it is paid never charges twice.',
      ].join(' '),
      inputSchema: {
        questionId: z.string().min(1).max(64).describe('The id from ask_health_worker.'),
        confirmPayment: z
          .boolean()
          .optional()
          .describe('true ONLY after she agreed to pay for this answer.'),
      },
      annotations: { idempotentHint: true },
    },
    async ({ questionId, confirmPayment }) => {
      try {
        const status = await api.status(questionId);
        if (status.status === 'open') {
          return text(
            `Still waiting for a nurse to pick it up. Nothing charged. If nobody does by ${status.claimsCloseAt}, it is cancelled and she pays nothing.`,
            { kind: 'status', ...status },
          );
        }
        if (status.status === 'claimed') {
          return text(
            'A nurse is writing the answer now. Check again in a few minutes. Nothing charged yet.',
            { kind: 'status', ...status },
          );
        }
        if (status.status === 'expired' || status.status === 'cancelled') {
          return text(
            `This question was ${status.status}: no nurse answered it, and she was not charged. She can ask again.`,
            { kind: 'status', ...status },
          );
        }
        try {
          const res = await api.collect(questionId, confirmPayment ?? false);
          const { answer, payment } = res;
          const paid = payment.paidFromTreasury
            ? 'This answer was free for her.'
            : `Paid ${naira(payment.amount)} from her CareLayer wallet${
                payment.stellarTxHash
                  ? ` (Stellar transaction: https://stellar.expert/explorer/testnet/tx/${payment.stellarTxHash})`
                  : ''
              }.`;
          return text(
            [
              `Answer from ${answer.nurse.displayName}, verified ${answer.nurse.role}:`,
              '',
              answer.text,
              '',
              answer.recommendSeeSomeoneToday
                ? 'IMPORTANT: the nurse recommends she sees a health worker in person TODAY.'
                : '',
              paid,
              'This is general guidance from a nurse, not a diagnosis.',
            ]
              .filter((l) => l !== '')
              .join('\n'),
            { kind: 'answer', ...res },
          );
        } catch (err) {
          if (err instanceof CareLayerApiError && err.code === 'PAYMENT_CONFIRMATION_REQUIRED') {
            const price = err.details.price as Money | undefined;
            return text(
              `A nurse has answered. It costs ${price ? naira(price) : 'the agreed price'}, paid from her CareLayer wallet. She asked to approve each payment: ask her, and only if she says yes call get_answer again with confirmPayment: true.`,
              { kind: 'payment_required', price },
            );
          }
          throw err;
        }
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_balance',
    {
      title: 'CareLayer balance',
      description:
        'Her CareLayer wallet balance (in naira, held as USDC on Stellar) and how many free nurse answers she has left.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const w = await api.wallet();
        return text(
          [
            `Balance: ${naira(w.balance)} (${w.balance.usdc} USDC on Stellar testnet).`,
            `Free answers left: ${w.freeAnswersRemaining ?? 0}.`,
            w.status === 'pending' ? 'Her wallet is still being set up on Stellar.' : '',
            'She can top up in the CareLayer app (Wallet > Top up).',
          ]
            .filter((l) => l !== '')
            .join('\n'),
          { kind: 'wallet', ...w, contractVersion: API_CONTRACT_VERSION },
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
