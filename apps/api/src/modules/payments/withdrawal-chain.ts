// Stellar side of nurse withdrawals (Z10). Behind WithdrawalChain so tests use a fake.
//
// Her custodial account holds 0 XLM (the treasury sponsors its reserves, Z4), so it cannot pay a
// transaction fee. A withdrawal is a USDC payment FROM her account (signed with her custodial key)
// wrapped in a fee-bump transaction paid and signed by the treasury.
//
// Memo = the withdrawal id. Before (re)sending, her account's transactions are searched for it, so
// a payment that reached the chain but was never recorded (timeout, crash) is found, not repeated.
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
import { TESTNET_USDC, TESTNET_USDC_ISSUER } from './stellar-testnet.js';

export interface DestinationState {
  exists: boolean;
  /** A USDC payment can only land on an account that trusts testnet USDC. */
  hasUsdcTrustline: boolean;
}

/** Stellar answered and said no (bad sequence, underfunded, no trust...). Nothing moved. */
export class StellarRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarRejectedError';
  }
}

export interface WithdrawalChain {
  destinationState(address: string): Promise<DestinationState>;
  /**
   * USDC payment from `from` (custodial keypair) to `destination`, fee paid by the treasury.
   * Throws StellarRejectedError when Stellar refused it (nothing moved); any other error is
   * indeterminate (it may still land: look it up by memo).
   */
  send(
    from: Keypair,
    destination: string,
    stroops: bigint,
    memo: string,
  ): Promise<{ txHash: string }>;
  /** Hash of a successful transaction from `account` with this text memo, among recent ones. */
  findByMemo(account: string, memo: string): Promise<string | null>;
}

function resultCodes(err: unknown) {
  return (
    err as {
      response?: {
        data?: {
          extras?: { result_codes?: { transaction?: string; operations?: string[] } };
        };
      };
    }
  ).response?.data?.extras?.result_codes;
}

export function createHorizonWithdrawalChain(opts: {
  horizonUrl: string;
  treasurySecret: string;
}): WithdrawalChain {
  const horizon = new Horizon.Server(opts.horizonUrl);
  const treasury = Keypair.fromSecret(opts.treasurySecret);

  return {
    async destinationState(address) {
      try {
        const account = await horizon.loadAccount(address);
        return {
          exists: true,
          hasUsdcTrustline: account.balances.some(
            (b) =>
              'asset_code' in b &&
              b.asset_code === 'USDC' &&
              b.asset_issuer === TESTNET_USDC_ISSUER,
          ),
        };
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 404) {
          return { exists: false, hasUsdcTrustline: false };
        }
        throw err;
      }
    },

    async send(from, destination, stroops, memo) {
      if (stroops <= 0n) throw new Error('amount must be positive');
      if (Buffer.byteLength(memo) > 28) throw new Error('memo too long (max 28 bytes)');
      const source = await horizon.loadAccount(from.publicKey());
      const inner = new TransactionBuilder(source, {
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
      inner.sign(from);
      // The treasury pays the fee (her account has no XLM). 10x base fee rides out busy ledgers.
      const bumped = TransactionBuilder.buildFeeBumpTransaction(
        treasury,
        String(Number(BASE_FEE) * 10),
        inner,
        Networks.TESTNET,
      );
      bumped.sign(treasury);
      try {
        const res = await horizon.submitTransaction(bumped);
        return { txHash: res.hash };
      } catch (err) {
        const codes = resultCodes(err);
        if (codes) {
          throw new StellarRejectedError(
            `stellar: ${codes.transaction ?? 'tx_failed'} [${(codes.operations ?? []).join(', ')}]`,
          );
        }
        throw new Error(`stellar request failed: ${(err as Error).message}`, { cause: err });
      }
    },

    async findByMemo(account, memo) {
      const page = await horizon.transactions().forAccount(account).order('desc').limit(100).call();
      const hit = page.records.find(
        (t) => t.successful && t.memo_type === 'text' && t.memo === memo,
      );
      return hit?.hash ?? null;
    },
  };
}
