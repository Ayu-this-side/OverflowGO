import { useCallback, useEffect, useState } from 'react';
import type { TicketStatus } from '@overflowgo/shared';
import CameraCapture, { type CameraError } from '../components/CameraCapture';
import { useI18n, type TranslationKey } from '../i18n';
import {
  ApiError,
  ServiceUnavailableError,
  getReportStatus,
  submitReport,
  type SubmitReportInput,
} from '../lib/api';
import { createClientReportId, getDeviceId } from '../lib/device';
import { GeoError, getCurrentPosition } from '../lib/geo';
import {
  enqueueReport,
  processQueue,
  queuedReportCount,
} from '../lib/queue';

type Screen = 'home' | 'camera' | 'preview' | 'result';

type PermissionIssue =
  | 'location_denied'
  | 'location_unavailable'
  | 'camera_denied'
  | 'camera_unsupported'
  | 'camera_frame'
  | null;

type FlowPhase = 'idle' | 'locating' | 'sending';

type ResultKind = 'accepted' | 'merged' | 'rejected' | 'queued' | 'error';

interface ResultState {
  kind: ResultKind;
  reportId?: string;
  ticketId?: string;
  reason?: string;
  message?: string;
}

const REJECT_NO_GARBAGE =
  "We couldn't find an overflowing bin or garbage in this photo. Please retake it.";
const REJECT_NOTHING_VISIBLE =
  "We couldn't see a bin or garbage in this photo. Please move closer and retake.";

const STATUS_KEYS: Record<TicketStatus, TranslationKey> = {
  open: 'statusOpen',
  offered: 'statusOffered',
  assigned: 'statusAssigned',
  completed: 'statusCompleted',
};

const ISSUE_COPY: Record<
  Exclude<PermissionIssue, null>,
  { title: TranslationKey; body: TranslationKey; steps?: TranslationKey }
> = {
  location_denied: {
    title: 'permissionLocationTitle',
    body: 'permissionLocationBody',
    steps: 'permissionLocationSteps',
  },
  location_unavailable: {
    title: 'permissionLocationTitle',
    body: 'gpsFailed',
  },
  camera_denied: {
    title: 'permissionCameraTitle',
    body: 'permissionCameraBody',
    steps: 'permissionCameraSteps',
  },
  camera_unsupported: {
    title: 'permissionCameraTitle',
    body: 'cameraUnsupported',
  },
  camera_frame: {
    title: 'permissionCameraTitle',
    body: 'cameraFailed',
  },
};

function PermissionNotice({
  issue,
  onRetry,
}: {
  issue: Exclude<PermissionIssue, null>;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const copy = ISSUE_COPY[issue];

  return (
    <div
      role="alert"
      className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left"
    >
      <p className="text-base font-semibold text-amber-900">{t(copy.title)}</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-900">{t(copy.body)}</p>
      {copy.steps && (
        <p className="mt-2 text-sm leading-relaxed text-amber-800">{t(copy.steps)}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
      >
        {t('tryAgain')}
      </button>
    </div>
  );
}

function TicketStatusLine({ status }: { status: TicketStatus | null }) {
  const { t } = useI18n();
  return (
    <p className="mt-3 text-sm text-gray-700">
      {t('ticketStatusLabel')}:{' '}
      <span className="font-semibold">
        {status ? t(STATUS_KEYS[status]) : t('statusUnknown')}
      </span>
    </p>
  );
}

function ResultPanel({
  result,
  ticketStatus,
  onRetake,
  onAnother,
  onTryAgain,
}: {
  result: ResultState;
  ticketStatus: TicketStatus | null;
  onRetake: () => void;
  onAnother: () => void;
  onTryAgain: () => void;
}) {
  const { t } = useI18n();

  const reason =
    result.reason === REJECT_NO_GARBAGE
      ? t('reasonNoGarbage')
      : result.reason === REJECT_NOTHING_VISIBLE
        ? t('reasonNothingVisible')
        : (result.reason ?? t('rejectedBody'));

  if (result.kind === 'accepted' || result.kind === 'merged') {
    const merged = result.kind === 'merged';
    return (
      <section
        aria-live="polite"
        className="rounded-3xl border border-brand-100 bg-white p-6 shadow-sm"
      >
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">
          {t('appName')}
        </p>
        <h2 className="mt-2 text-2xl font-bold leading-tight text-gray-900">
          {merged ? t('mergedTitle') : t('acceptedTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {merged ? t('mergedBody') : t('acceptedBody')}
        </p>
        <TicketStatusLine status={ticketStatus} />
        <button
          type="button"
          onClick={onAnother}
          className="mt-6 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white"
        >
          {t('reportAnother')}
        </button>
      </section>
    );
  }

  if (result.kind === 'rejected') {
    return (
      <section
        aria-live="polite"
        className="rounded-3xl border border-amber-300 bg-white p-6 shadow-sm"
      >
        <h2 className="text-2xl font-bold leading-tight text-gray-900">
          {t('rejectedTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">{reason}</p>
        <button
          type="button"
          onClick={onRetake}
          className="mt-6 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white"
        >
          {t('retake')}
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-gray-600"
        >
          {t('reportAnother')}
        </button>
      </section>
    );
  }

  if (result.kind === 'queued') {
    return (
      <section
        aria-live="polite"
        className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm"
      >
        <h2 className="text-2xl font-bold leading-tight text-blue-950">
          {t('queuedTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-blue-900">
          {t('queuedBody')}
        </p>
        <button
          type="button"
          onClick={onAnother}
          className="mt-6 w-full rounded-2xl bg-blue-900 px-5 py-4 text-lg font-semibold text-white"
        >
          {t('reportAnother')}
        </button>
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      className="rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm"
    >
      <h2 className="text-2xl font-bold leading-tight text-red-950">
        {t('errorTitle')}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-red-900">
        {result.message ?? t('errorBody')}
      </p>
      <button
        type="button"
        onClick={onTryAgain}
        className="mt-6 w-full rounded-2xl bg-red-900 px-5 py-4 text-lg font-semibold text-white"
      >
        {t('tryAgain')}
      </button>
      <button
        type="button"
        onClick={onAnother}
        className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-red-800"
      >
        {t('reportAnother')}
      </button>
    </section>
  );
}

function isRetryableSubmitError(error: unknown): boolean {
  return (
    error instanceof ServiceUnavailableError ||
    error instanceof TypeError ||
    (error instanceof ApiError && error.status >= 500)
  );
}

export default function UserHome() {
  const { t, toggleLanguage } = useI18n();

  const [screen, setScreen] = useState<Screen>('home');
  const [permissionIssue, setPermissionIssue] = useState<PermissionIssue>(null);
  const [phase, setPhase] = useState<FlowPhase>('idle');

  const [capturedPhoto, setCapturedPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [result, setResult] = useState<ResultState | null>(null);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | null>(null);

  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [queuedCount, setQueuedCount] = useState(0);

  const refreshQueue = useCallback(async () => {
    try {
      setQueuedCount(await queuedReportCount());
    } catch {
      // IndexedDB may be unavailable (private mode); keep the UI usable.
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        await processQueue();
      } catch {
        // Ignore transient queue failures; the next tick retries.
      }
      if (active) await refreshQueue();
    }

    void run();

    const handleOnline = () => {
      setOnline(true);
      void run();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const timer = window.setInterval(() => void run(), 30_000);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(timer);
    };
  }, [refreshQueue]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const reportId = result?.reportId;
    if (
      !reportId ||
      (result?.kind !== 'accepted' && result?.kind !== 'merged')
    ) {
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const status = await getReportStatus(reportId);
        if (active) setTicketStatus(status.ticketStatus);
      } catch {
        // Keep the last known status silently.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 15_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [result]);

  const handleStart = useCallback(() => {
    setPermissionIssue(null);
    setResult(null);
    setScreen('camera');
  }, []);

  const handleCameraError = useCallback((reason: CameraError) => {
    setScreen('home');
    setPermissionIssue(
      reason === 'unsupported'
        ? 'camera_unsupported'
        : reason === 'frame'
          ? 'camera_frame'
          : 'camera_denied',
    );
  }, []);

  const handleCapture = useCallback((photo: Blob) => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(photo);
    });
    setCapturedPhoto(photo);
    setNote('');
    setPermissionIssue(null);
    setScreen('preview');
  }, []);

  const handleRetake = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setCapturedPhoto(null);
    setPermissionIssue(null);
    setScreen('camera');
  }, []);

  const handleReportAnother = useCallback(() => {
    setResult(null);
    setTicketStatus(null);
    setCapturedPhoto(null);
    setPreviewUrl(null);
    setNote('');
    setPermissionIssue(null);
    setScreen('home');
  }, []);

  const handleSend = useCallback(async () => {
    if (!capturedPhoto) return;

    setPermissionIssue(null);
    setPhase('locating');

    let position;
    try {
      position = await getCurrentPosition();
    } catch (error) {
      setPhase('idle');
      setPermissionIssue(
        error instanceof GeoError && error.code === 'denied'
          ? 'location_denied'
          : 'location_unavailable',
      );
      return;
    }

    const submission: SubmitReportInput = {
      photo: capturedPhoto,
      lat: position.lat,
      lng: position.lng,
      note: note.trim() ? note.trim() : null,
      deviceId: getDeviceId(),
      clientReportId: createClientReportId(),
    };

    const saveToQueue = async (): Promise<boolean> => {
      try {
        await enqueueReport({
          id: submission.clientReportId,
          createdAt: new Date().toISOString(),
          photo: submission.photo,
          lat: submission.lat,
          lng: submission.lng,
          note: submission.note,
          deviceId: submission.deviceId,
        });
        await refreshQueue();
        return true;
      } catch {
        return false;
      }
    };

    if (!navigator.onLine) {
      const saved = await saveToQueue();
      setPhase('idle');
      setResult(saved ? { kind: 'queued' } : { kind: 'error' });
      setScreen('result');
      return;
    }

    setPhase('sending');
    try {
      const response = await submitReport(submission);
      if (response.status === 'rejected') {
        setResult({
          kind: 'rejected',
          reportId: response.reportId,
          reason: response.reason,
        });
      } else {
        setResult({
          kind: response.status,
          reportId: response.reportId,
          ticketId: response.ticketId,
        });
      }
    } catch (error) {
      if (isRetryableSubmitError(error)) {
        const saved = await saveToQueue();
        setResult(saved ? { kind: 'queued' } : { kind: 'error' });
      } else {
        setResult({
          kind: 'error',
          message: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setPhase('idle');
      setScreen('result');
    }
  }, [capturedPhoto, note, refreshQueue]);

  const handleTryAgainFromResult = useCallback(() => {
    setResult(null);
    if (capturedPhoto) {
      setScreen('preview');
    } else {
      handleStart();
    }
  }, [capturedPhoto, handleStart]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">
            {t('appName')}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleLanguage}
          aria-label={t('languageToggleLabel')}
          className="rounded-full border border-brand-100 bg-white px-3 py-1.5 text-sm font-semibold text-brand-700"
        >
          {t('languageToggle')}
        </button>
      </header>

      {!online && (
        <p
          role="status"
          className="mb-4 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white"
        >
          {t('offlineBanner')}
        </p>
      )}
      {queuedCount > 0 && (
        <p
          role="status"
          className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900"
        >
          {queuedCount === 1
            ? t('queueBannerOne')
            : t('queueBannerMany', { count: queuedCount })}
        </p>
      )}

      {screen === 'home' && (
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
          <h1 className="text-3xl font-bold leading-tight text-gray-900">
            {t('headline')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            {t('intro')}
          </p>

          {permissionIssue && (
            <PermissionNotice
              issue={permissionIssue}
              onRetry={handleStart}
            />
          )}

          <button
            type="button"
            onClick={handleStart}
            disabled={permissionIssue !== null}
            className="mt-6 w-full rounded-2xl bg-brand-700 px-5 py-5 text-lg font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('reportButton')}
          </button>

          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            {t('privacyNote')}
          </p>
        </section>
      )}

      {screen === 'camera' && (
        <CameraCapture
          onCapture={handleCapture}
          onError={handleCameraError}
          onCancel={() => setScreen('home')}
        />
      )}

      {screen === 'preview' && (
        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          <h2 className="text-lg font-bold text-gray-900">{t('previewTitle')}</h2>
          {previewUrl && (
            <img
              src={previewUrl}
              alt={t('previewTitle')}
              className="mt-3 w-full rounded-2xl bg-gray-100 object-contain"
            />
          )}

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-gray-700">
              {t('noteLabel')}
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t('notePlaceholder')}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-base text-gray-900"
            />
          </label>

          {permissionIssue && (
            <PermissionNotice
              issue={permissionIssue}
              onRetry={() => void handleSend()}
            />
          )}

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={phase !== 'idle'}
            className="mt-5 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'locating'
              ? t('locating')
              : phase === 'sending'
                ? t('sending')
                : t('sendReport')}
          </button>
          <button
            type="button"
            onClick={handleRetake}
            disabled={phase !== 'idle'}
            className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-gray-600 disabled:opacity-60"
          >
            {t('retake')}
          </button>
        </section>
      )}

      {screen === 'result' && result && (
        <ResultPanel
          result={result}
          ticketStatus={ticketStatus}
          onRetake={handleRetake}
          onAnother={handleReportAnother}
          onTryAgain={handleTryAgainFromResult}
        />
      )}
    </main>
  );
}
