export default function UserHome() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
              OverflowGo
            </p>
            <h1 className="text-2xl font-bold leading-tight text-gray-900">
              Bin overflowing? Let us know.
            </h1>
          </div>
        </div>

        <button
          type="button"
          disabled
          className="w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          Report overflowing bin
        </button>

        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          Your location and photo will be used to send a cleaner. Reporting is
          camera-only and needs no sign-in.
        </p>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        Camera and location capture arrive in Phase 1.
      </p>
    </main>
  );
}
