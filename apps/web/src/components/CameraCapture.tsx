import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { captureFrame } from '../lib/image';

export type CameraError = 'denied' | 'unsupported' | 'frame';

interface CameraCaptureProps {
  onCapture: (photo: Blob) => void;
  onError: (reason: CameraError) => void;
  onCancel: () => void;
  title?: string;
  hint?: string;
  captureLabel?: string;
}

export default function CameraCapture({
  onCapture,
  onError,
  onCancel,
  title,
  hint,
  captureLabel,
}: CameraCaptureProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [starting, setStarting] = useState(true);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        onError('unsupported');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      } catch {
        if (!cancelled) onError('denied');
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onError]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    setCapturing(true);
    try {
      const photo = await captureFrame(video);
      onCapture(photo);
    } catch {
      onError('frame');
    } finally {
      setCapturing(false);
    }
  }, [onCapture, onError, ready]);

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
      <h2 className="text-lg font-bold text-gray-900">
        {title ?? t('cameraTitle')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{hint ?? t('cameraHint')}</p>

      <div className="relative mt-4 aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => setReady(true)}
          className="h-full w-full object-cover"
        />
        {starting && (
          <p className="absolute inset-0 grid place-items-center bg-black/60 px-6 text-center text-sm font-medium text-white">
            {t('cameraStarting')}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleCapture}
        disabled={!ready || capturing}
        className="mt-4 w-full rounded-2xl bg-brand-700 px-5 py-4 text-lg font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {captureLabel ?? t('captureButton')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-gray-600"
      >
        {t('cancel')}
      </button>
    </section>
  );
}
