import { AlertTriangle } from 'lucide-react';

// Buyer-facing line for a cross-seller visual supporting signal. The exact
// wording is owned by the backend (product.buyerAdvisory) — this component
// only renders it in the Trust panel's amber-warning style. Evidence
// phrasing by contract: never "fraud" or "duplicate".
export default function VisualSimilarityAdvisory({ advisory }) {
  if (!advisory) return null;
  return (
    <li className="flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
      <span className="text-amber-600">{advisory}</span>
    </li>
  );
}
