// Stellar side of custodial wallets. Everything goes through WalletChain so tests use a fake.
//
// Activation is ONE transaction, source = treasury, signed by the treasury and the new account:
//   1. beginSponsoringFutureReserves(new)        treasury pays every reserve below
//   2. createAccount(new, startingBalance 0)     the account exists with 0 XLM
//   3. changeTrust(USDC)        source = new     USDC trustline, reserve sponsored
//   4. endSponsoringFutureReserves() source = new
// The user never needs XLM: the treasury pays reserves and the fee. If any op fails, none apply.
import {
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { usdcStringToStroops } from '../../lib/money.js';
import { TESTNET_USDC, TESTNET_USDC_ISSUER } from '../payments/stellar-testnet.js';

export interface AccountState {
  exists: boolean;
  hasUsdcTrustline: boolean;
  /** 0n when there is no account or no trustline. */
  usdcStroops: bigint;
  /** Who pays this account's base reserve (null = itself, or no account). */
  sponsor: string | null;
}

export interface WalletChain {
  accountState(address: string): Promise<AccountState>;
  /** Creates the sponsored account with the USDC trustline. Returns the transaction hash. */
  activate(account: Keypair): Promise<{ txHash: string }>;
}

/** Thrown when Stellar says the account already exists (a previous attempt may have succeeded). */
export class AccountAlreadyExistsError extends Error {
  constructor() {
    super('account already exists');
    this.name = 'AccountAlreadyExistsError';
  }
}

/** Horizon's error result codes, without any secret material. */
function describeHorizonError(err: unknown): { message: string; opCodes: string[] } {
  const extras = (
    err as {
      response?: {
        data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
      };
    }
  ).response?.data?.extras;
  const codes = extras?.result_codes;
  if (codes) {
    return {
      message: `stellar: ${codes.transaction ?? 'tx_failed'} [${(codes.operations ?? []).join(', ')}]`,
      opCodes: codes.operations ?? [],
    };
  }
  const name = err instanceof Error ? err.message : String(err);
  return { message: `stellar request failed: ${name}`, opCodes: [] };
}

export function createHorizonWalletChain(opts: {
  horizonUrl: string;
  treasurySecret: string;
}): WalletChain {
  const horizon = new Horizon.Server(opts.horizonUrl);
  const treasury = Keypair.fromSecret(opts.treasurySecret);

  return {
    async accountState(address) {
      try {
        const account = await horizon.loadAccount(address);
        const usdc = account.balances.find(
          (b) =>
            'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === TESTNET_USDC_ISSUER,
        );
        return {
          exists: true,
          hasUsdcTrustline: Boolean(usdc),
          usdcStroops: usdc ? usdcStringToStroops(usdc.balance) : 0n,
          sponsor: (account as unknown as { sponsor?: string }).sponsor ?? null,
        };
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 404) {
          return { exists: false, hasUsdcTrustline: false, usdcStroops: 0n, sponsor: null };
        }
        throw new Error(describeHorizonError(err).message, { cause: err });
      }
    },

    async activate(account) {
      const source = await horizon.loadAccount(treasury.publicKey());
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: account.publicKey() }))
        .addOperation(
          Operation.createAccount({ destination: account.publicKey(), startingBalance: '0' }),
        )
        .addOperation(Operation.changeTrust({ asset: TESTNET_USDC, source: account.publicKey() }))
        .addOperation(Operation.endSponsoringFutureReserves({ source: account.publicKey() }))
        .setTimeout(60)
        .build();
      tx.sign(treasury, account);
      try {
        const res = await horizon.submitTransaction(tx);
        return { txHash: res.hash };
      } catch (err) {
        const { message, opCodes } = describeHorizonError(err);
        if (opCodes.includes('op_already_exists')) throw new AccountAlreadyExistsError();
        throw new Error(message, { cause: err });
      }
    },
  };
}
