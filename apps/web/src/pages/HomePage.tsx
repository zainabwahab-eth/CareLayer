import { API_CONTRACT_VERSION } from '@carelayer/shared';

export function HomePage() {
  return (
    <main>
      <h1>Hello CareLayer</h1>
      <p>Private answers to your health questions, from verified health workers.</p>
      <p>
        <small>API contract {API_CONTRACT_VERSION}</small>
      </p>
    </main>
  );
}
