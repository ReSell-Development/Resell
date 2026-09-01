export const formatPrice = (amount, currency = 'USD') => {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const getConditionColor = (condition) => {
  const colors = {
    new: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'like-new': 'bg-teal-100 text-teal-700 border-teal-200',
    good: 'bg-blue-100 text-blue-700 border-blue-200',
    fair: 'bg-amber-100 text-amber-700 border-amber-200',
    poor: 'bg-red-100 text-red-700 border-red-200',
  };
  return colors[condition] || colors.good;
};

export const getConditionLabel = (condition) => {
  const labels = {
    new: 'New',
    'like-new': 'Like New',
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
  };
  return labels[condition] || condition;
};

export const getRiskColor = (level) => {
  const colors = {
    low: 'bg-emerald-100 text-emerald-700',
    medium: 'bg-amber-100 text-amber-700',
    high: 'bg-red-100 text-red-700',
  };
  return colors[level] || colors.low;
};

export const getTrustColor = (score) => {
  if (score >= 80) return 'from-emerald-500 to-teal-500';
  if (score >= 65) return 'from-blue-500 to-cyan-500';
  if (score >= 45) return 'from-amber-500 to-orange-500';
  if (score >= 25) return 'from-orange-500 to-red-500';
  return 'from-slate-400 to-slate-500';
};
