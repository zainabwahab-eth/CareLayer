// Stellar lookups for answer payments (Z8). Behind AnswerPaymentChain so tests use a fake.
//
// Why this exists: a facilitator settle() that times out (or answers 5xx) is INDETERMINATE: the
// payment may have reached the chain anyway. Before asking her to pay again we look for it.
//
// An x402 "exact" payment on Stellar is a Soroban SAC transfer(payer -> payTo, amount). Horizon lists
// it under the payer's operations as invoke_host_function with asset_balance_changes. We match
// from = payer, to = payTo, the USDC asset, the exact amount, created after the attempt started.
// A woman's custodial wallet only pays through our own agent, one question at a time, so that match
// identifies the settlement.
import { Horizon } from '@stellar/stellar-sdk';
import { usdcStringToStroops } from '../../lib/money.js';
import { TESTNET_USDC_ISSUER } from './stellar-testnet.js';

export interface AnswerPaymentChain {
  /** Hash of a successful USDC transfer payer -> payTo of exactly `stroops` since `since`, or null. */
  findTransfer(opts: {
    payer: string;
    payTo: string;
    stroops: bigint;
    since: Date;
  }): Promise<string | null>;
}

interface BalanceChange {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  type: string;
  from?: string;
  to?: string;
  amount: string;
}

export function createHorizonAnswerPaymentChain(opts: { horizonUrl: string }): AnswerPaymentChain {
  const horizon = new Horizon.Server(opts.horizonUrl);
  return {
    async findTransfer({ payer, payTo, stroops, since }) {
      const page = await horizon.operations().forAccount(payer).order('desc').limit(50).call();
      for (const op of page.records) {
        if (new Date(op.created_at).getTime() < since.getTime()) break;
        if (op.type !== 'invoke_host_function' || !op.transaction_successful) continue;
        const changes = (op as unknown as { asset_balance_changes?: BalanceChange[] })
          .asset_balance_changes;
        const hit = changes?.some(
          (c) =>
            c.type === 'transfer' &&
            c.asset_code === 'USDC' &&
            c.asset_issuer === TESTNET_USDC_ISSUER &&
            c.from === payer &&
            c.to === payTo &&
            usdcStringToStroops(c.amount) === stroops,
        );
        if (hit) return op.transaction_hash;
      }
      return null;
    },
  };
}
