import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { CompleteTicketResponse, DriverRouteTicket } from '@overflowgo/shared';
import CameraCapture, { type CameraError } from '../components/CameraCapture';
import {
  DriverApiError,
  completeDriverTicket,
  getDriverRoute,
  isUnauthorized,
} from '../lib/driver-api';
import { clearDriverSession, loadDriverSession } from '../lib/driver-session';
import { GeoError, getCurrentPosition } from '../lib/geo';

type Step = 'loading' | 'details' | 'camera' | 'preview' | 'result';

export default function DriverComplete() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [session] = useState(() => loadDriverSession());
  const [step, setStep] = useState<Step>('loading');
  const [ticket, setTicket] = useState<DriverRouteTicket | null>(null);
  const [localityName, setLocalityName] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [result, setResult] = useState<CompleteTicketResponse | null>(null);

  useEffect(() => {
    if (!session || !ticketId) return;
    let active = true;
    getDriverRoute(session.token)
      .then((route) => {
        if (!active) return;
        for (const stop of route.stops) {
          const found = stop.tickets.find((item) => item.ticketId === ticketId);
          if (found) {
            setTicket(found);
            setLocalityName(stop.localityName);
            setStep('details');
            return;
          }
        }
        setError('This job is no longer open. It may have been completed already.');
        setStep('details');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (isUnauthorized(cause)) {
          clearDriverSession();
          setError('Session expired. Please sign in again.');
        } else {
          setError('Could not load this ticket.');
        }
        setStep('details');
      });
    return () => {
      active = false;
    };
  }, [session, ticketId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleCapture = useCallback((captured: Blob) => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(captured);
    });
    setPhoto(captured);
    setCameraError(null);
    setError(null);
    setStep('preview');
  }, []);

  const handleCameraError = useCallback((reason: CameraError) => {
    // Keep the camera step visible. Returning to the details step here made a
    // denied or unsupported camera look like the button did nothing.
    setCameraError(reason);
  }, []);

  const openCamera = useCallback(() => {
    setError(null);
    setCameraError(null);
    setCameraAttempt((attempt) => attempt + 1);
    setStep('camera');
  }, []);

  const retryCamera = useCallback(() => {
    setCameraError(null);
    setCameraAttempt((attempt) => attempt + 1);
  }, []);

  const handleSubmit = async () => {
    if (!session || !ticket || !photo) return;
    setSubmitting(true);
    setError(null);
    try {
      const position = await getCurrentPosition();
      const response = await completeDriverTicket(
        session.token,
        ticket.ticketId,
        photo,
        position.lat,
        position.lng,
      );
      setResult(response);
      setStep('result');
    } catch (cause) {
      if (cause instanceof GeoError) {
        setError(
          cause.code === 'denied'
            ? 'Allow location access to complete this job.'
            : "We couldn't get your location. Try again.",
        );
      } else if (isUnauthorized(cause)) {
        clearDriverSession();
        setError('Session expired. Please sign in again.');
      } else {
        setError(
          cause instanceof DriverApiError
            ? cause.message
            : 'Could not submit the after photo.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) {
    return <Navigate to="/driver" replace />;
  }

  const backToRoute = (
    <Link
      to="/driver/route"
      className="mt-4 block rounded-2xl bg-brand-700 px-5 py-4 text-center text-lg font-semibold text-white"
    >
      Back to route
    </Link>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-4">
        <Link
          to="/driver/route"
          className="text-xs font-semibold uppercase tracking-widest text-brand-700"
        >
          ← My route
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Complete job</h1>
        <p className="text-sm text-gray-500">
          {localityName ? `${localityName} · after photo` : 'After photo'}
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}

      {step === 'loading' && (
        <p className="mt-10 text-center text-sm text-gray-500">Loading job…</p>
      )}

      {step === 'details' && (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
          {ticket ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold uppercase tracking-wide text-amber-900">
                  {ticket.reportCount} report{ticket.reportCount === 1 ? '' : 's'}
                </span>
                <span className="text-gray-500">
                  {ticket.status === 'assigned' ? 'Assigned to you' : 'Open stop'}
                </span>
              </div>
              {ticket.photoUrl && (
                <img
                  src={ticket.photoUrl}
                  alt="Citizen report"
                  className="mt-3 h-48 w-full rounded-2xl object-cover"
                />
              )}
              {ticket.note ? (
                <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  “{ticket.note}”
                </p>
              ) : (
                <p className="mt-3 text-sm italic text-gray-400">
                  No note from the citizen.
                </p>
              )}
              <p className="mt-4 text-sm text-gray-600">
                Clean the spot, then take a live after photo that clearly shows
                the bin. The AI verifies that no overflow or garbage remains.
              </p>
              <button
                type="button"
                onClick={openCamera}
                className="mt-5 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white"
              >
                Take after photo
              </button>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${ticket.lat},${ticket.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-2xl border border-gray-300 bg-white px-5 py-3 text-center text-base font-semibold text-gray-700"
              >
                Navigate to bin
              </a>
            </>
          ) : (
            <p className="text-sm text-gray-600">
              Return to your route to see the latest jobs.
            </p>
          )}
          {backToRoute}
        </section>
      )}

      {step === 'camera' &&
        (cameraError ? (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
            <h2 className="text-lg font-bold text-gray-900">
              Camera not available
            </h2>
            <p
              role="alert"
              className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            >
              {cameraError === 'denied'
                ? 'Camera access was blocked. Allow camera access for this site in your browser settings, then press Try again.'
                : cameraError === 'unsupported'
                  ? "This browser can't access a camera on this address. Open the app at http://localhost:5173 or use HTTPS, then try again."
                  : cameraError === 'notfound'
                    ? 'No camera was found on this device. Connect or enable a webcam, then press Try again.'
                    : "We couldn't save the photo. Hold the camera steady and try again."}
            </p>
            <button
              type="button"
              onClick={retryCamera}
              className="mt-4 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                setCameraError(null);
                setStep('details');
              }}
              className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-gray-600"
            >
              Back to job
            </button>
          </section>
        ) : (
          <CameraCapture
            key={cameraAttempt}
            title="Take the after photo"
            hint="Show the bin clearly after cleaning. Overflow or garbage must be gone."
            captureLabel="Take after photo"
            onCapture={handleCapture}
            onError={handleCameraError}
            onCancel={() => setStep('details')}
          />
        ))}

      {step === 'preview' && previewUrl && (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
          <h2 className="text-lg font-bold text-gray-900">
            Does the after photo show the clean bin?
          </h2>
          <img
            src={previewUrl}
            alt="After cleaning"
            className="mt-3 aspect-[3/4] w-full rounded-2xl object-cover"
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="mt-4 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Checking photo…' : 'Submit after photo'}
          </button>
          <button
            type="button"
            onClick={openCamera}
            disabled={submitting}
            className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-gray-600"
          >
            Retake photo
          </button>
        </section>
      )}

      {step === 'result' && result && (
        <section
          className={`rounded-3xl p-6 shadow-sm ring-1 ${
            result.verified
              ? 'bg-brand-50 ring-brand-200'
              : 'bg-amber-50 ring-amber-200'
          }`}
        >
          <h2 className="text-xl font-bold text-gray-900">
            {result.verified ? 'Job verified. Nice work.' : 'Not verified yet'}
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            {result.verified
              ? 'The after photo passed the AI check and the ticket is now completed.'
              : result.reason ??
                'The AI still sees overflow or garbage. Please clean the spot and retake the photo.'}
          </p>
          {result.verified && (result.reward ?? 0) > 0 && (
            <p className="mt-3 rounded-xl bg-white px-3 py-2 text-base font-bold text-brand-700">
              ₹{result.reward} added to your wallet.
            </p>
          )}
          {!result.verified && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setStep('camera');
              }}
              className="mt-5 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white"
            >
              Retake after photo
            </button>
          )}
          {backToRoute}
        </section>
      )}
    </main>
  );
}
