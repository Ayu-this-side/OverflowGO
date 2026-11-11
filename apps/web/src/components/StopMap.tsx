import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface StopMapProps {
  lat: number;
  lng: number;
  label: string;
}

export default function StopMap({ lat, lng, label }: StopMapProps) {
  return (
    <div className="mt-3 h-48 overflow-hidden rounded-2xl ring-1 ring-gray-200">
      <MapContainer
        key={`${lat},${lng}`}
        center={[lat, lng]}
        zoom={16}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[lat, lng]}
          radius={11}
          pathOptions={{
            color: '#15803d',
            fillColor: '#22c55e',
            fillOpacity: 0.75,
          }}
        >
          <Popup>{label}</Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
