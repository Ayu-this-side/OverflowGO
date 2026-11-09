import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Language = 'en' | 'hi';

const en = {
  appName: 'OverflowGo',
  headline: 'Bin overflowing? Let us know.',
  intro:
    'Your location and photo will be used to send a cleaner. No sign-in needed.',
  reportButton: 'Report overflowing bin',
  startBusy: 'Checking permissions...',
  privacyNote:
    'Camera-only report. Photos are deleted after the ticket is closed.',
  driverPortal: 'Driver portal',
  languageToggle: 'हिंदी',
  languageToggleLabel: 'Switch language',
  permissionLocationTitle: 'Location is needed',
  permissionLocationBody:
    'We use your location to send a cleaner to the right bin.',
  permissionLocationSteps:
    'Open your browser settings, allow location for this site, then try again.',
  permissionCameraTitle: 'Camera is needed',
  permissionCameraBody:
    'Reports use a live camera photo. Gallery uploads are disabled.',
  permissionCameraSteps:
    'Open your browser settings, allow camera access for this site, then try again.',
  cameraUnsupported:
    'This browser cannot open a camera. Please try a different browser.',
  cameraFailed: "We couldn't take the photo. Please try again.",
  tryAgain: 'Try again',
  cameraTitle: 'Take a photo of the bin',
  cameraHint: 'Keep the bin inside the frame and move closer if you can.',
  captureButton: 'Take photo',
  cameraStarting: 'Starting camera...',
  cancel: 'Cancel',
  previewTitle: 'Is this photo clear?',
  noteLabel: 'Describe the problem (optional)',
  notePlaceholder: 'For example: the bin has been full for three days',
  retake: 'Retake photo',
  sendReport: 'Send report',
  sending: 'Sending report...',
  locating: 'Getting your location...',
  gpsAccuracy: 'Location accuracy: ±{meters} m',
  gpsWeak:
    'Your location is only accurate to ±{meters} m. Move to an open area and try again.',
  gpsDenied:
    'We need your location to send a cleaner. Allow location access and try again.',
  gpsFailed: "We couldn't get your location. Please try again.",
  acceptedTitle: 'Thanks! A cleaner has been notified.',
  acceptedBody: 'Your report is with the dispatch team.',
  mergedTitle:
    "This bin was already reported. We've increased its priority.",
  mergedBody: 'All reports for this bin share one ticket.',
  rejectedTitle: "We couldn't use this photo",
  rejectedBody:
    "We couldn't find an overflowing bin or garbage in this photo. Please retake it.",
  reasonNoGarbage:
    "We couldn't find an overflowing bin or garbage in this photo. Please retake it.",
  reasonNothingVisible:
    "We couldn't see a bin or garbage in this photo. Please move closer and retake.",
  queuedTitle: "Saved. We'll send it when you're back online.",
  queuedBody: 'Keep this page installed. We retry automatically.',
  errorTitle: 'Report not sent',
  errorBody: 'Something went wrong. Please try again.',
  reportAnother: 'Report another bin',
  ticketStatusLabel: 'Ticket status',
  statusOpen: 'Open',
  statusOffered: 'Offered to a driver',
  statusAssigned: 'Driver assigned',
  statusCompleted: 'Completed',
  statusUnknown: 'Checking...',
  queueBannerOne: '1 saved report is waiting to send.',
  queueBannerMany: '{count} saved reports are waiting to send.',
  offlineBanner:
    "You're offline. Reports will be saved and sent automatically.",
} as const;

export type TranslationKey = keyof typeof en;

const hi: Record<TranslationKey, string> = {
  appName: 'OverflowGo',
  headline: 'क्या कूड़ेदान भर गया है? हमें बताएं।',
  intro:
    'आपकी लोकेशन और फोटो का उपयोग सफाईकर्मी भेजने के लिए होगा। साइन-इन की ज़रूरत नहीं।',
  reportButton: 'भरा हुआ कूड़ेदान रिपोर्ट करें',
  startBusy: 'अनुमतियाँ जाँची जा रही हैं...',
  privacyNote:
    'रिपोर्ट केवल कैमरे से। टिकट बंद होने के बाद फोटो हटा दी जाती है।',
  driverPortal: 'ड्राइवर पोर्टल',
  languageToggle: 'English',
  languageToggleLabel: 'भाषा बदलें',
  permissionLocationTitle: 'लोकेशन की अनुमति चाहिए',
  permissionLocationBody:
    'सही कूड़ेदान तक सफाईकर्मी भेजने के लिए हमें आपकी लोकेशन चाहिए।',
  permissionLocationSteps:
    'ब्राउज़र सेटिंग्स में इस साइट के लिए लोकेशन चालू करें, फिर दोबारा कोशिश करें।',
  permissionCameraTitle: 'कैमरे की अनुमति चाहिए',
  permissionCameraBody:
    'रिपोर्ट के लिए लाइव कैमरा फोटो ज़रूरी है। गैलरी से फोटो नहीं चुनी जा सकती।',
  permissionCameraSteps:
    'ब्राउज़र सेटिंग्स में इस साइट के लिए कैमरा चालू करें, फिर दोबारा कोशिश करें।',
  cameraUnsupported:
    'यह ब्राउज़र कैमरा नहीं खोल सकता। कृपया दूसरा ब्राउज़र आज़माएं।',
  cameraFailed: 'फोटो नहीं ली जा सकी। कृपया दोबारा कोशिश करें।',
  tryAgain: 'दोबारा कोशिश करें',
  cameraTitle: 'कूड़ेदान की फोटो लें',
  cameraHint: 'कूड़ेदान फ्रेम में रखें और हो सके तो थोड़ा पास जाएं।',
  captureButton: 'फोटो लें',
  cameraStarting: 'कैमरा शुरू हो रहा है...',
  cancel: 'रद्द करें',
  previewTitle: 'क्या यह फोटो साफ़ है?',
  noteLabel: 'समस्या बताएं (वैकल्पिक)',
  notePlaceholder: 'जैसे: कूड़ेदान तीन दिन से भरा है',
  retake: 'फिर से फोटो लें',
  sendReport: 'रिपोर्ट भेजें',
  sending: 'रिपोर्ट भेजी जा रही है...',
  locating: 'आपकी लोकेशन पता की जा रही है...',
  gpsAccuracy: 'लोकेशन सटीकता: ±{meters} मीटर',
  gpsWeak:
    'लोकेशन केवल ±{meters} मीटर सटीक है। खुली जगह पर जाकर दोबारा कोशिश करें।',
  gpsDenied:
    'सफाईकर्मी भेजने के लिए लोकेशन ज़रूरी है। लोकेशन की अनुमति दें और दोबारा कोशिश करें।',
  gpsFailed: 'लोकेशन नहीं मिल सकी। कृपया दोबारा कोशिश करें।',
  acceptedTitle: 'धन्यवाद! सफाईकर्मी को सूचना भेज दी गई है।',
  acceptedBody: 'आपकी रिपोर्ट डिस्पैच टीम के पास है।',
  mergedTitle:
    'इस कूड़ेदान की रिपोर्ट पहले ही हो चुकी है। हमने इसकी प्राथमिकता बढ़ा दी है।',
  mergedBody: 'इस कूड़ेदान की सभी रिपोर्टें एक ही टिकट में जुड़ती हैं।',
  rejectedTitle: 'इस फोटो का उपयोग नहीं हो सका',
  rejectedBody:
    'इस फोटो में भरा हुआ कूड़ेदान या कूड़ा नहीं मिला। कृपया दोबारा फोटो लें।',
  reasonNoGarbage:
    'इस फोटो में भरा हुआ कूड़ेदान या कूड़ा नहीं मिला। कृपया दोबारा फोटो लें।',
  reasonNothingVisible:
    'इस फोटो में कूड़ेदान या कूड़ा नहीं दिखा। थोड़ा पास जाकर दोबारा फोटो लें।',
  queuedTitle: 'सहेज लिया गया है। इंटरनेट आने पर भेज दिया जाएगा।',
  queuedBody: 'यह पेज इंस्टॉल रखें। हम अपने आप दोबारा कोशिश करेंगे।',
  errorTitle: 'रिपोर्ट नहीं भेजी जा सकी',
  errorBody: 'कुछ गड़बड़ हुई। कृपया दोबारा कोशिश करें।',
  reportAnother: 'दूसरा कूड़ेदान रिपोर्ट करें',
  ticketStatusLabel: 'टिकट की स्थिति',
  statusOpen: 'खुला',
  statusOffered: 'ड्राइवर को भेजा गया',
  statusAssigned: 'ड्राइवर असाइन हुआ',
  statusCompleted: 'पूरा हुआ',
  statusUnknown: 'जाँच हो रही है...',
  queueBannerOne: '1 सहेजी हुई रिपोर्ट भेजने के लिए बाकी है।',
  queueBannerMany: '{count} सहेजी हुई रिपोर्टें भेजने के लिए बाकी हैं।',
  offlineBanner:
    'आप ऑफ़लाइन हैं। रिपोर्ट सहेजी जाएगी और इंटरनेट आने पर भेज दी जाएगी।',
};

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  hi,
};

const STORAGE_KEY = 'overflowgo.language';

export interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (
    key: TranslationKey,
    values?: Record<string, string | number>,
  ) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Storage may be disabled; language still works for this session.
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => (current === 'en' ? 'hi' : 'en'));
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) => {
      let text = translations[language][key] ?? translations.en[key];
      if (values) {
        for (const [name, value] of Object.entries(values)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return context;
}
