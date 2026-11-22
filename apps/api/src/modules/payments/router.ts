// Payments module. Z2: GET /x402-test proves x402 on Stellar testnet with @x402/express.
// Z8's GET /questions/:id/answer lives in the questions router and uses a manual x402 flow
// (answer-x402.ts, questions/answers.ts): the answer is only read after settlement succeeds.
//
// GET /x402-test (only when X402_TEST_ROUTE=true, never in production)
//   - 0.01 USDC to X402_PAY_TO_ADDRESS (the treasury).
//   - ?ready=false simulates "answer not ready": the guard returns 409 QUESTION_NOT_ANSWERED and no
//     payment is requested.
import { paymentMiddleware } from '@x402/express';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { payOnDeliveryGuard } from './guard.js';
import { createX402Server, x402TestRoute } from './x402.js';

export function createPaymentsRouter(deps: AppDeps): Router {
  const router = Router();
  const { config, facilitator, logger } = deps;

  if (config.x402.testRouteEnabled) {
    if (!facilitator) throw new Error('X402_TEST_ROUTE is on but no x402 facilitator was provided');

    router.use(
      '/x402-test',
      payOnDeliveryGuard(
        (req) => req.query.ready !== 'false',
        () =>
          new AppError(409, 'QUESTION_NOT_ANSWERED', 'Not ready yet. No payment was requested.'),
      ),
    );
    router.use(
      paymentMiddleware(
        { 'GET /x402-test': x402TestRoute(config.x402) },
        createX402Server(facilitator, config.x402.network),
        undefined,
        undefined,
        // Must stay true: the server learns the facilitator's supported schemes from /supported
        // (lazily, on the first protected request). With false it cannot build a 402 at all.
        true,
      ),
    );
    router.get('/x402-test', (_req, res) => {
      logger.info('x402_test_paid');
      res.json({
        ok: true,
        message: 'Paid over x402 on Stellar testnet.',
        paidAt: new Date().toISOString(),
      });
    });
  }

  return router;
}
