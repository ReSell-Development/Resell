import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Eye, Flag, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminService } from '../services/services';
import AdminLayout from '../components/admin/AdminLayout';
import Loader from '../components/ui/Loader';
import { formatPrice, formatDate } from '../utils/format';

export default function AdminProducts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    load();
  }, [statusFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminService.products({ q: search, status: statusFilter });
      setItems(r.data.items);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    load();
  };

  const handleModerate = async (product, status) => {
    try {
      await adminService.moderateProduct(product._id, { status });
      setItems((prev) => prev.map((p) => (p._id === product._id ? { ...p, status } : p)));
      toast.success(`Listing ${status}`);
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleFlag = async (product, isFlagged) => {
    try {
      await adminService.moderateProduct(product._id, {
        isFlagged,
        flagReason: isFlagged ? 'Flagged by admin' : '',
      });
      setItems((prev) => prev.map((p) => (p._id === product._id ? { ...p, isFlagged, flagReason: isFlagged ? 'Flagged by admin' : '' } : p)));
      toast.success(isFlagged ? 'Listing flagged' : 'Flag removed');
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <AdminLayout title="Products">
      <div className="card p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search listings..."
            className="input pl-9"
          />
        </form>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input max-w-[180px]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="removed">Removed</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3 font-medium text-sm">Listing</th>
                  <th className="text-left p-3 font-medium text-sm">Seller</th>
                  <th className="text-left p-3 font-medium text-sm">Price</th>
                  <th className="text-left p-3 font-medium text-sm">Status</th>
                  <th className="text-right p-3 font-medium text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={p.images?.[0]?.url || 'https://via.placeholder.com/60'}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover"
                        />
                        <div>
                          <Link
                            to={`/product/${p._id}`}
                            className="font-medium text-sm hover:text-brand-600 line-clamp-1"
                          >
                            {p.title}
                          </Link>
                          <p className="text-xs text-slate-500">{p.category?.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-sm">{p.seller?.name}</td>
                    <td className="p-3 font-semibold text-sm">{formatPrice(p.price)}</td>
                    <td className="p-3">
                      <span className={`badge capitalize ${
                        p.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        p.status === 'sold' ? 'bg-slate-100 text-slate-700' :
                        p.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        p.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {p.status}
                      </span>
                      {p.isFlagged && (
                        <span className="ml-2 badge bg-red-100 text-red-700">Flagged</span>
                      )}
                    </td>
                    <td className="p-3 text-right space-x-1">
                      <Link
                        to={`/product/${p._id}`}
                        className="inline-flex p-1.5 rounded hover:bg-slate-100"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                      {p.status === 'active' ? (
                        <button
                          onClick={() => handleModerate(p, 'rejected')}
                          className="inline-flex p-1.5 rounded hover:bg-red-50 text-red-600"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleModerate(p, 'active')}
                          className="inline-flex p-1.5 rounded hover:bg-emerald-50 text-emerald-600"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleFlag(p, !p.isFlagged)}
                        className={`inline-flex p-1.5 rounded hover:bg-amber-50 ${
                          p.isFlagged ? 'text-amber-600' : 'text-slate-400'
                        }`}
                      >
                        <Flag className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 && (
              <p className="text-center text-slate-500 py-8">No products found</p>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
