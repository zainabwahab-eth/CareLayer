// x402 on Stellar: facilitator client, resource server and route helpers.
// Packages: @x402/core, @x402/express, @x402/stellar 2.31.0 (official). Facilitator: OpenZeppelin
// Channels on testnet (see the decisions log in docs/TASKS.md for why).
//
// Prices are always explicit USDC amounts in stroops (7 decimals), never "$0.01" strings, so no
// float or currency parsing happens on the money path.
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
} from '@x402/core/server';
import type { RouteConfig } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';
import type { X402Config } from '../../config.js';

export { USDC_TESTNET_ADDRESS };

/** 0.01 USDC: the Z2 proof price. */
export const X402_TEST_PRICE_STROOPS = 100_000n;

export function createFacilitatorClient(cfg: X402Config): FacilitatorClient {
  const apiKey = cfg.facilitatorApiKey;
  return new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl,
    // Settlement on testnet can take a few ledgers; 30 s keeps a request from hanging for 90 s.
    timeoutMs: 30_000,
    createAuthHeaders: async () => {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      return { verify: headers, settle: headers, supported: headers };
    },
  });
}

export function createX402Server(facilitator: FacilitatorClient, network: X402Config['network']) {
  return new x402ResourceServer(facilitator).register(network, new ExactStellarScheme());
}

/** A USDC price in stroops, in the shape x402 expects (amount is an integer string). */
export function usdcPrice(stroops: bigint) {
  if (stroops <= 0n) throw new Error('price must be positive');
  return { asset: USDC_TESTNET_ADDRESS, amount: stroops.toString() };
}

/** Route config for GET /x402-test: 0.01 USDC to the platform address. */
export function x402TestRoute(cfg: X402Config): RouteConfig {
  if (!cfg.payToAddress) throw new Error('X402_PAY_TO_ADDRESS is required for the x402 test route');
  return {
    accepts: {
      scheme: 'exact',
      network: cfg.network,
      payTo: cfg.payToAddress,
      price: usdcPrice(X402_TEST_PRICE_STROOPS),
      maxTimeoutSeconds: 120,
    },
    description: 'CareLayer x402 proof: 0.01 USDC on Stellar testnet',
    mimeType: 'application/json',
  };
}
