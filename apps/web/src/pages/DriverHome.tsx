export default function DriverHome() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
          Driver portal
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Sign in</h1>
        <p className="mt-2 text-sm text-gray-600">
          Driver login, duty toggle and routes arrive in Phase 2.
        </p>

        <form className="mt-6 space-y-4" aria-disabled="true">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              disabled
              placeholder="driver@example.com"
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base disabled:bg-gray-50"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Password</span>
            <input
              type="password"
              disabled
              placeholder="••••••••"
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base disabled:bg-gray-50"
            />
          </label>
          <button
            type="button"
            disabled
            className="w-full rounded-2xl bg-brand-700 px-5 py-3 text-base font-semibold text-white opacity-60"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
