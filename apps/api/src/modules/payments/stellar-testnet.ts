// Thin wrapper over Horizon for TESTNET wallet chores: Friendbot funding, the USDC trustline,
// buying test USDC with XLM on the testnet DEX, and reading balances. Every Stellar call the setup
// script and tests make goes through here, so tests can replace it.
import type { Keypair } from '@stellar/stellar-sdk';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import { stroopsToUsdcString, usdcStringToStroops } from '../../lib/money.js';

/** Circle's testnet USDC (classic asset; its SAC is USDC_TESTNET_ADDRESS). */
export const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const TESTNET_USDC = new Asset('USDC', TESTNET_USDC_ISSUER);
export const DEFAULT_TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';

export function createStellarTestnet(horizonUrl = DEFAULT_TESTNET_HORIZON) {
  const horizon = new Horizon.Server(horizonUrl);

  async function accountExists(address: string) {
    try {
      await horizon.loadAccount(address);
      return true;
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 404) return false;
      throw err;
    }
  }

  async function submit(kp: Keypair, ...ops: xdr.Operation[]) {
    const account = await horizon.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    }).setTimeout(60);
    for (const op of ops) tx.addOperation(op);
    const built = tx.build();
    built.sign(kp);
    const res = await horizon.submitTransaction(built);
    return res.hash;
  }

  return {
    accountExists,

    /** Creates and funds the account with 10,000 test XLM. No-op if it already exists. */
    async fundWithFriendbot(address: string): Promise<'funded' | 'exists'> {
      if (await accountExists(address)) return 'exists';
      const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error(`Friendbot failed (${res.status}): ${await res.text()}`);
      return 'funded';
    },

    /** Adds the USDC trustline if missing. Returns the tx hash, or null if it already existed. */
    async ensureUsdcTrustline(kp: Keypair): Promise<string | null> {
      const account = await horizon.loadAccount(kp.publicKey());
      const has = account.balances.some(
        (b) =>
          'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === TESTNET_USDC_ISSUER,
      );
      if (has) return null;
      return submit(kp, Operation.changeTrust({ asset: TESTNET_USDC }));
    },

    /** Swaps exactly `sendXlm` XLM for at least `minUsdcStroops` USDC on the testnet DEX. */
    async buyUsdcWithXlm(kp: Keypair, sendXlm: string, minUsdcStroops: bigint): Promise<string> {
      return submit(
        kp,
        Operation.pathPaymentStrictSend({
          sendAsset: Asset.native(),
          sendAmount: sendXlm,
          destination: kp.publicKey(),
          destAsset: TESTNET_USDC,
          destMin: stroopsToUsdcString(minUsdcStroops),
          path: [],
        }),
      );
    },

    /** USDC balance in stroops (0n if no trustline or no account). */
    async usdcBalanceStroops(address: string): Promise<bigint> {
      if (!(await accountExists(address))) return 0n;
      const account = await horizon.loadAccount(address);
      const usdc = account.balances.find(
        (b) =>
          'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === TESTNET_USDC_ISSUER,
      );
      return usdc ? usdcStringToStroops(usdc.balance) : 0n;
    },

    /** Looks up a transaction; throws if Horizon does not know it. */
    async transaction(hash: string) {
      const tx = await horizon.transactions().transaction(hash).call();
      return {
        hash: tx.hash,
        successful: tx.successful,
        ledger: tx.ledger_attr,
        createdAt: tx.created_at,
      };
    },
  };
}

export type StellarTestnet = ReturnType<typeof createStellarTestnet>;
