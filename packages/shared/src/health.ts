// GET /health on apps/api.

export interface HealthResponse {
  status: 'ok';
  service: 'carelayer-api';
  contractVersion: string;
  time: string;
}
