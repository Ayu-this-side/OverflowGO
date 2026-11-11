import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'overflowgo.install.dismissed';

export default function InstallPrompt() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [installed, setInstalled] = useState(() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred || dismissed || installed) return null;

  const dismiss = () => {
    setDismissed(true);
    setDeferred(null);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage may be disabled; the prompt is hidden for this session.
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-brand-900">{t('installTitle')}</p>
      <p className="mt-1 text-xs leading-relaxed text-brand-900/80">
        {t('installBody')}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void deferred.prompt();
            setDeferred(null);
          }}
          className="flex-1 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
        >
          {t('installButton')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-800"
        >
          {t('installDismiss')}
        </button>
      </div>
    </section>
  );
}
