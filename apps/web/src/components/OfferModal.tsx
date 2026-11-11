import { useEffect, useState } from 'react';
import { useDriverRealtime } from '../lib/driver-realtime';

function secondsLeft(expiresAt: string): number {
  const remaining = Date.parse(expiresAt) - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

export default function OfferModal() {
  const {
    offer,
    offerBusy,
    offerError,
    acceptOffer,
    rejectOffer,
    dismissOffer,
  } = useDriverRealtime();
  const [remaining, setRemaining] = useState(() =>
    offer ? secondsLeft(offer.expiresAt) : 0,
  );

  useEffect(() => {
    if (!offer) return;
    setRemaining(secondsLeft(offer.expiresAt));
    const timer = window.setInterval(() => {
      const next = secondsLeft(offer.expiresAt);
      setRemaining(next);
      if (next <= 0) dismissOffer();
    }, 500);
    return () => window.clearInterval(timer);
  }, [offer, dismissOffer]);

  if (!offer) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New job offer"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700">
            New job · {offer.localityName}
          </p>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
            {remaining}s
          </span>
        </div>

        {offer.photoUrl && (
          <img
            src={offer.photoUrl}
            alt="Citizen report"
            className="mt-3 h-44 w-full rounded-2xl object-cover"
          />
        )}

        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-brand-50 px-3 py-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Distance
            </p>
            <p className="text-lg font-bold text-gray-900">
              {offer.distanceMeters < 1000
                ? `${offer.distanceMeters} m`
                : `${(offer.distanceMeters / 1000).toFixed(1)} km`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Reward
            </p>
            <p className="text-lg font-bold text-brand-700">
              {offer.reward > 0 ? `₹${offer.reward}` : 'No reward'}
            </p>
          </div>
        </div>

        {offer.note ? (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
            “{offer.note}”
          </p>
        ) : (
          <p className="mt-3 text-sm italic text-gray-400">
            No note from the citizen.
          </p>
        )}

        {offerError && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
          >
            {offerError}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void rejectOffer()}
            disabled={offerBusy}
            className="flex-1 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-700 disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void acceptOffer()}
            disabled={offerBusy}
            className="flex-[1.4] rounded-2xl bg-brand-700 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {offerBusy ? 'Accepting…' : 'Accept job'}
          </button>
        </div>
        <button
          type="button"
          onClick={dismissOffer}
          disabled={offerBusy}
          className="mt-2 w-full rounded-xl px-4 py-2 text-sm font-medium text-gray-500 disabled:opacity-60"
        >
          Ignore for now
        </button>
      </div>
    </div>
  );
}
