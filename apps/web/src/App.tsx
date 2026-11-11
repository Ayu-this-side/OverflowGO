import { Link, Route, Routes } from 'react-router-dom';
import { useI18n } from './i18n';
import OfferModal from './components/OfferModal';
import { DriverRealtimeProvider } from './lib/driver-realtime';
import UserHome from './pages/UserHome';
import DriverHome from './pages/DriverHome';
import DriverRoute from './pages/DriverRoute';
import DriverComplete from './pages/DriverComplete';
import NotFound from './pages/NotFound';

export default function App() {
  const { t } = useI18n();

  return (
    <div className="min-h-dvh">
      <DriverRealtimeProvider>
        <Routes>
          <Route path="/" element={<UserHome />} />
          <Route path="/driver" element={<DriverHome />} />
          <Route path="/driver/route" element={<DriverRoute />} />
          <Route
            path="/driver/tickets/:ticketId/complete"
            element={<DriverComplete />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <OfferModal />
      </DriverRealtimeProvider>
      <footer className="mx-auto w-full max-w-md px-6 pb-8 pt-4 text-center text-xs text-gray-500">
        <Link className="underline underline-offset-2" to="/driver">
          {t('driverPortal')}
        </Link>
      </footer>
    </div>
  );
}
