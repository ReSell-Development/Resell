import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { reportService } from '../services/services';
import AdminLayout from '../components/admin/AdminLayout';
import Loader from '../components/ui/Loader';
import { formatDate } from '../utils/format';

const STATUS_BADGES = {
  pending: 'bg-amber-100 text-amber-700',
  reviewing: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-slate-100 text-slate-700',
};

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');

  useEffect(() => {
    load();
  }, [statusFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await reportService.list({ status: statusFilter });
      setReports(r.data.items);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (report, status, action = '') => {
    try {
      await reportService.update(report._id, { status, action });
      setReports((prev) => prev.map((r) => (r._id === report._id ? { ...r, status, action } : r)));
      toast.success('Report updated');
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <AdminLayout title="Reports">
      <div className="card p-4 mb-4">
        <div className="flex gap-2">
          {['pending', 'reviewing', 'resolved', 'dismissed', ''].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                statusFilter === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-50 hover:bg-slate-100'
              }`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loader />
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map((r) => (
              <motion.div
                key={r._id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-5 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`badge ${STATUS_BADGES[r.status]}`}>{r.status}</span>
                      <span className="badge bg-slate-100 capitalize">{r.targetType}</span>
                      <span className="badge bg-red-50 text-red-700 capitalize">{r.reason}</span>
                      <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                    </div>

                    <p className="text-sm text-slate-700 mb-2">
                      <strong>Reporter:</strong> {r.reporter?.name} ({r.reporter?.email})
                    </p>

                    {r.target && (
                      <div className="mb-2">
                        <strong className="text-sm text-slate-700">Target:</strong>
                        {r.targetType === 'product' ? (
                          <Link
                            to={`/product/${r.target._id}`}
                            className="text-brand-600 hover:underline ml-2"
                          >
                            {r.target.title}
                          </Link>
                        ) : (
                          <span className="ml-2">{r.target.name}</span>
                        )}
                      </div>
                    )}

                    {r.description && (
                      <p className="text-sm text-slate-600 italic bg-slate-50 rounded-lg p-3 mt-2">
                        "{r.description}"
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {r.status !== 'resolved' && (
                      <button
                        onClick={() => handleUpdate(r, 'resolved', 'Action taken')}
                        className="btn text-xs text-emerald-600 hover:bg-emerald-50"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Resolve
                      </button>
                    )}
                    {r.status !== 'dismissed' && (
                      <button
                        onClick={() => handleUpdate(r, 'dismissed', 'No action needed')}
                        className="btn text-xs text-slate-600 hover:bg-slate-100"
                      >
                        <XCircle className="w-4 h-4" />
                        Dismiss
                      </button>
                    )}
                    {r.status === 'pending' && (
                      <button
                        onClick={() => handleUpdate(r, 'reviewing')}
                        className="btn text-xs text-blue-600 hover:bg-blue-50"
                      >
                        <Eye className="w-4 h-4" />
                        Reviewing
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}

            {reports.length === 0 && (
              <p className="text-center text-slate-500 py-12">No reports to display</p>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
