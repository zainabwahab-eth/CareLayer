// x402 CLIENT side: an agent that pays for a protected resource from a Stellar keypair.
// Used by scripts/pay-x402.ts and the testnet integration test now; Z8's internal agent (paying
// from a woman's custodial wallet) will use the same function with her decrypted secret.
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import type { X402Config } from '../../config.js';

/** A fetch that answers a 402 by signing an x402 Stellar payment with `secret` and retrying. */
export function createPayingFetch(
  secret: string,
  network: X402Config['network'],
  fetchImpl = fetch,
) {
  const signer = createEd25519Signer(secret, network);
  const client = new x402Client().register(network, new ExactStellarScheme(signer));
  return wrapFetchWithPayment(fetchImpl, client);
}

/** Settlement result from the PAYMENT-RESPONSE header of a paid response (null if none). */
export function readSettlement(
  res: Response,
): { transaction: string; payer?: string; network: string } | null {
  const header = res.headers.get('PAYMENT-RESPONSE') ?? res.headers.get('X-PAYMENT-RESPONSE');
  if (!header) return null;
  const decoded = decodePaymentResponseHeader(header);
  return { transaction: decoded.transaction, payer: decoded.payer, network: decoded.network };
}

export const testnetExplorerTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;
