import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { HomePage } from './pages/HomePage';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '*', element: <NotFound /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}

function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <Link to="/">Back to CareLayer HW</Link>
    </main>
  );
}
