import { API_CONTRACT_VERSION } from '@carelayer/shared';

export function HomePage() {
  return (
    <main>
      <h1>Hello CareLayer</h1>
      <p>Health worker app: answer questions, earn per answer.</p>
      <p>
        <small>API contract {API_CONTRACT_VERSION}</small>
      </p>
    </main>
  );
}
