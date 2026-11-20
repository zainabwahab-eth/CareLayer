// Stellar side of top-ups: the treasury sends USDC to her wallet. Behind TopupChain so tests fake it.
//
// Every credit payment carries memo = the top-up id. Before (re)sending, the service asks Horizon for
// a treasury payment with that memo: a credit that was submitted but never recorded (crash, timeout)
// is found instead of being paid twice.
import {
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { stroopsToUsdcString } from '../../lib/money.js';
import { TESTNET_USDC } from '../payments/stellar-testnet.js';

export interface TopupChain {
  /** Treasury -> destination, amount in USDC stroops, text memo. Returns the transaction hash. */
  sendUsdc(destination: string, stroops: bigint, memo: string): Promise<{ txHash: string }>;
  /** Hash of a successful treasury transaction with this text memo, among recent ones, or null. */
  findTreasuryPaymentByMemo(memo: string): Promise<string | null>;
}

function horizonMessage(err: unknown) {
  const codes = (
    err as {
      response?: {
        data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
      };
    }
  ).response?.data?.extras?.result_codes;
  return codes
    ? `stellar: ${codes.transaction ?? 'tx_failed'} [${(codes.operations ?? []).join(', ')}]`
    : `stellar request failed: ${err instanceof Error ? err.message : String(err)}`;
}

export function createHorizonTopupChain(opts: {
  horizonUrl: string;
  treasurySecret: string;
}): TopupChain {
  const horizon = new Horizon.Server(opts.horizonUrl);
  const treasury = Keypair.fromSecret(opts.treasurySecret);

  return {
    async sendUsdc(destination, stroops, memo) {
      if (stroops <= 0n) throw new Error('amount must be positive');
      if (Buffer.byteLength(memo) > 28) throw new Error('memo too long (max 28 bytes)');
      try {
        const source = await horizon.loadAccount(treasury.publicKey());
        const tx = new TransactionBuilder(source, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination,
              asset: TESTNET_USDC,
              amount: stroopsToUsdcString(stroops),
            }),
          )
          .addMemo(Memo.text(memo))
          .setTimeout(60)
          .build();
        tx.sign(treasury);
        const res = await horizon.submitTransaction(tx);
        return { txHash: res.hash };
      } catch (err) {
        throw new Error(horizonMessage(err), { cause: err });
      }
    },

    async findTreasuryPaymentByMemo(memo) {
      try {
        const page = await horizon
          .transactions()
          .forAccount(treasury.publicKey())
          .order('desc')
          .limit(200)
          .call();
        const hit = page.records.find(
          (t) => t.successful && t.memo_type === 'text' && t.memo === memo,
        );
        return hit?.hash ?? null;
      } catch (err) {
        throw new Error(horizonMessage(err), { cause: err });
      }
    },
  };
}
