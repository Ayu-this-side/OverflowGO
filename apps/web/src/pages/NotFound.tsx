import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Page not found</h1>
      <Link
        to="/"
        className="mt-6 rounded-2xl bg-brand-700 px-5 py-3 text-base font-semibold text-white"
      >
        Back to reporting
      </Link>
    </main>
  );
}
