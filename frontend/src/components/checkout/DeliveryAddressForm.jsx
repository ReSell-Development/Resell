import { useState } from 'react';
import { MapPin, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';
import LocationDetectButton from '../ui/LocationDetectButton';
import useLocationDetector from '../../hooks/useLocationDetector';
import toast from 'react-hot-toast';

const EMPTY = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
};

export default function DeliveryAddressForm({ initialValues, onConfirm, onCancel, product }) {
  const [address, setAddress] = useState({ ...EMPTY, ...(initialValues || {}) });
  const { detect, loading: detecting, error: detectError } = useLocationDetector();

  const handleChange = (field) => (e) => setAddress((a) => ({ ...a, [field]: e.target.value }));

  const handleDetect = async () => {
    const result = await detect();
    if (!result) return;
    const a = result.raw || {};
    setAddress((prev) => ({
      ...prev,
      city: a.city || a.town || a.village || a.county || prev.city,
      state: a.state || a.region || prev.state,
      country: a.country || prev.country,
    }));
    toast.success('Filled city / state / country from your location');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const required = ['fullName', 'phone', 'line1', 'city', 'postalCode', 'country'];
    const missing = required.filter((k) => !address[k] || !address[k].trim());
    if (missing.length) {
      toast.error(`Please fill: ${missing.join(', ')}`);
      return;
    }
    onConfirm(address);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {product && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Delivering for: <span className="font-medium text-slate-900">{product.title}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-900">Delivery Address</h3>
        </div>
        <LocationDetectButton
          onDetect={handleDetect}
          loading={detecting}
          error={detectError}
          label="Auto-fill city / country"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name *" value={address.fullName} onChange={handleChange('fullName')} required />
        <Field label="Phone *" value={address.phone} onChange={handleChange('phone')} type="tel" required />
        <div className="sm:col-span-2">
          <Field label="Address line 1 *" value={address.line1} onChange={handleChange('line1')} required />
        </div>
        <div className="sm:col-span-2">
          <Field label="Address line 2 (optional)" value={address.line2} onChange={handleChange('line2')} />
        </div>
        <Field label="City *" value={address.city} onChange={handleChange('city')} required />
        <Field label="State / Region" value={address.state} onChange={handleChange('state')} />
        <Field label="Postal code *" value={address.postalCode} onChange={handleChange('postalCode')} required />
        <Field label="Country *" value={address.country} onChange={handleChange('country')} required />
      </div>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        )}
        <button type="submit" className="btn-primary flex-1">
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, type = 'text', required }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete="off"
        className="input"
        placeholder=""
      />
    </div>
  );
}
