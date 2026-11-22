// Stellar side of nurse withdrawals (Z10). Behind WithdrawalChain so tests use a fake.
//
// Her custodial account holds 0 XLM (the treasury sponsors its reserves, Z4), so it cannot pay a
// transaction fee. A withdrawal is a USDC payment FROM her account (signed with her custodial key)
// wrapped in a fee-bump transaction paid and signed by the treasury.
//
// Never sent twice: the transaction is built and signed first, and its hash (known before
// submitting) is stored. If the submit times out, that exact hash is looked up on Horizon. The memo
// is hers to use (exchanges need one to credit a deposit).
import {
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  type FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import { stroopsToUsdcString } from '../../lib/money.js';
import { TESTNET_USDC, TESTNET_USDC_ISSUER } from './stellar-testnet.js';

export interface DestinationState {
  exists: boolean;
  /** A USDC payment can only land on an account that trusts testnet USDC. */
  hasUsdcTrustline: boolean;
}

/** The memo an exchange (or anyone) asked her to put on the payment. */
export type DestinationMemo = { type: 'text'; value: string } | { type: 'id'; value: string };

/** Stellar answered and said no (bad sequence, underfunded, no trust...). Nothing moved. */
export class StellarRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarRejectedError';
  }
}

/** A signed transaction, not submitted yet. `hash` is final: it is what Horizon will report. */
export interface PreparedWithdrawal {
  hash: string;
  /** Signed envelope (base64 XDR). */
  xdr: string;
}

export interface WithdrawalChain {
  destinationState(address: string): Promise<DestinationState>;
  /** Builds and signs the fee-bumped payment. Nothing is sent. */
  prepare(opts: {
    from: Keypair;
    destination: string;
    stroops: bigint;
    memo: DestinationMemo | null;
  }): Promise<PreparedWithdrawal>;
  /**
   * Submits a prepared payment. Throws StellarRejectedError when Stellar refused it (nothing moved);
   * any other error is indeterminate (it may still land: look it up with transactionStatus).
   */
  submit(prepared: PreparedWithdrawal): Promise<void>;
  /** 'success' / 'failed' once Horizon knows the transaction, null if it does not (yet). */
  transactionStatus(hash: string): Promise<'success' | 'failed' | null>;
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

const httpStatus = (err: unknown) => (err as { response?: { status?: number } }).response?.status;

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
        if (httpStatus(err) === 404) return { exists: false, hasUsdcTrustline: false };
        throw err;
      }
    },

    async prepare({ from, destination, stroops, memo }) {
      if (stroops <= 0n) throw new Error('amount must be positive');
      const source = await horizon.loadAccount(from.publicKey());
      const builder = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      }).addOperation(
        Operation.payment({
          destination,
          asset: TESTNET_USDC,
          amount: stroopsToUsdcString(stroops),
        }),
      );
      if (memo) builder.addMemo(memo.type === 'id' ? Memo.id(memo.value) : Memo.text(memo.value));
      const inner = builder.setTimeout(60).build();
      inner.sign(from);
      // The treasury pays the fee (her account has no XLM). 10x base fee rides out busy ledgers.
      const bumped: FeeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
        treasury,
        String(Number(BASE_FEE) * 10),
        inner,
        Networks.TESTNET,
      );
      bumped.sign(treasury);
      return { hash: bumped.hash().toString('hex'), xdr: bumped.toXDR() };
    },

    async submit(prepared) {
      const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET);
      try {
        await horizon.submitTransaction(tx);
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

    async transactionStatus(hash) {
      try {
        const tx = await horizon.transactions().transaction(hash).call();
        return tx.successful ? 'success' : 'failed';
      } catch (err) {
        if (httpStatus(err) === 404) return null;
        throw err;
      }
    },
  };
}
