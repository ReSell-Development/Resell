import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getConditionLabel } from '../../utils/format';
import { useCurrency } from '../../contexts/CurrencyContext';
import { SUPPORTED_CURRENCIES } from '../../utils/currency';

export default function SellForm({ initial = {}, categories = [], onSubmit, submitting, submitLabel = 'Publish Listing' }) {
  const { currency } = useCurrency();
  const currencySymbol = SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol || '$';
  
  const [form, setForm] = useState({
    title: initial.title || '',
    description: initial.description || '',
    price: initial.price || '',
    originalPrice: initial.originalPrice || '',
    category: initial.category?._id || initial.category || '',
    brand: initial.brand || '',
    model: initial.model || '',
    condition: initial.condition || 'good',
    yearsUsed: initial.yearsUsed || 0,
    specifications: initial.specifications || [],
    location: initial.location || { city: '', state: '', country: '' },
  });

  const addSpec = () => {
    setForm((p) => ({ ...p, specifications: [...p.specifications, { key: '', value: '' }] }));
  };
  const updateSpec = (idx, k, v) => {
    setForm((p) => ({
      ...p,
      specifications: p.specifications.map((s, i) => (i === idx ? { key: k, value: v } : s)),
    }));
  };
  const removeSpec = (idx) => {
    setForm((p) => ({
      ...p,
      specifications: p.specifications.filter((_, i) => i !== idx),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title || !form.description || !form.price || !form.category) {
      return;
    }
    onSubmit({
      ...form,
      price: Number(form.price),
      originalPrice: Number(form.originalPrice) || 0,
      yearsUsed: Number(form.yearsUsed) || 0,
      specifications: form.specifications.filter((s) => s.key && s.value),
      images: initial.images, // keep existing
      currencyCode: currency,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="card p-6 space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Title</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="input"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={5}
            required
            className="input"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
              className="input"
            >
              <option value="">Select</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Condition</label>
            <select
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
              className="input"
            >
              <option value="new">New</option>
              <option value="like-new">Like New</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Brand</label>
            <input
              type="text"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Model</label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="input"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Price ({currencySymbol})</label>
            <input
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
              className="input"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Original Price ({currencySymbol})</label>
            <input
              type="number"
              value={form.originalPrice}
              onChange={(e) => setForm({ ...form, originalPrice: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Years Used</label>
            <input
              type="number"
              value={form.yearsUsed}
              onChange={(e) => setForm({ ...form, yearsUsed: e.target.value })}
              min="0"
              className="input"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Specifications</label>
            <button type="button" onClick={addSpec} className="text-sm text-brand-600 hover:underline">
              + Add spec
            </button>
          </div>
          {form.specifications.map((spec, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="text"
                value={spec.key}
                onChange={(e) => updateSpec(i, e.target.value, spec.value)}
                placeholder="Key"
                className="input flex-1"
              />
              <input
                type="text"
                value={spec.value}
                onChange={(e) => updateSpec(i, spec.key, e.target.value)}
                placeholder="Value"
                className="input flex-1"
              />
              <button type="button" onClick={() => removeSpec(i)} className="btn-secondary px-3">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
