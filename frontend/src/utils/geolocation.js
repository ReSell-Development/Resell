const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_EMAIL = 'contact@resell.app';

const getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000,
    });
  });

const reverseGeocode = async (latitude, longitude) => {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'json',
    addressdetails: '1',
    zoom: '10',
    'accept-language': 'en',
    email: NOMINATIM_EMAIL,
  });
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Reverse geocoding failed (${res.status})`);
  return res.json();
};

const formatCityCountry = (data) => {
  const a = data.address || {};
  const city =
    a.city || a.town || a.village || a.hamlet || a.county || a.state_district || a.region || '';
  const country = a.country || '';
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  if (city) return city;
  return data.display_name || '';
};

export const detectLocation = async () => {
  const pos = await getCurrentPosition();
  const { latitude, longitude } = pos.coords;
  const data = await reverseGeocode(latitude, longitude);
  return {
    latitude,
    longitude,
    label: formatCityCountry(data),
    raw: data.address || {},
  };
};

export const getCoordsOnly = async () => {
  const pos = await getCurrentPosition();
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
};
