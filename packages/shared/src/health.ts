// GET /health on apps/api. 200 when the database answers, 503 when it does not.

export interface HealthResponse {
  status: 'ok' | 'unavailable';
  database: 'ok' | 'down';
  service: 'carelayer-api';
  contractVersion: string;
  time: string;
}
