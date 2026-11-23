import { isApiError } from '@web/api/errors';

/*
 * Plain-language messages for the workspace's actions. Codes come from
 * docs/API_CONTRACT.md §9 (claims, answers) and §12 (withdrawals).
 * Never shows internals.
 */

const UNREACHABLE = 'Could not reach CareLayer. Check your connection and try again.';

export function claimErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'We could not claim this question. Please try again.';
  if (error.status === 0) return UNREACHABLE;
  switch (error.code) {
    case 'QUESTION_ALREADY_CLAIMED':
      return 'Another health worker took this question first.';
    case 'ACTIVE_CLAIM_EXISTS':
      return 'You already have a question open. Finish or release it first.';
    case 'CLAIMS_CLOSED':
    case 'QUESTION_EXPIRED':
      return 'This question has closed. No one can claim it now.';
    case 'NOT_FOUND':
      return 'This question is no longer available to you.';
    case 'NURSE_NOT_APPROVED':
      return 'Your profile must be approved before you can claim questions.';
    default:
      return 'We could not claim this question. Please try again.';
  }
}

export function answerErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Your answer was not sent. Please try again.';
  if (error.status === 0) return `${UNREACHABLE} Your answer is still here.`;
  switch (error.code) {
    case 'CLAIM_EXPIRED':
      return 'Your 10 minutes ran out, so the answer was not sent. The question is open to others again.';
    case 'NOT_CLAIM_OWNER':
      return 'This question is no longer yours to answer.';
    case 'VALIDATION_FAILED':
      return error.message || 'Check your answer and try again.';
    default:
      return 'Your answer was not sent. Please try again.';
  }
}

export function releaseErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'We could not release this question. Please try again.';
  if (error.status === 0) return UNREACHABLE;
  if (error.code === 'CLAIM_EXPIRED') return 'Your time had already run out, so it is open again.';
  if (error.code === 'NOT_CLAIM_OWNER') return 'This question is no longer yours.';
  return 'We could not release this question. Please try again.';
}

export function withdrawErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Your withdrawal was not sent. Please try again.';
  if (error.status === 0) return UNREACHABLE;
  switch (error.code) {
    case 'STELLAR_ADDRESS_INVALID':
    case 'VALIDATION_FAILED':
      return error.message || 'Check the details and try again.';
    case 'INSUFFICIENT_BALANCE':
      return 'That is more than you have available to withdraw.';
    case 'CONFLICT':
      return 'A withdrawal is already on its way. Wait for it to finish.';
    case 'STEP_UP_REQUIRED':
      return 'For your safety, confirm it is you with a new code.';
    case 'STELLAR_SUBMIT_FAILED':
      return 'Stellar refused the payment. Nothing left your wallet.';
    case 'SERVICE_UNAVAILABLE':
      return 'Withdrawals are not available right now. Please try again shortly.';
    default:
      return 'Your withdrawal was not sent. Please try again.';
  }
}
