import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { adminService } from '../services/services';
import AdminLayout from '../components/admin/AdminLayout';
import Loader from '../components/ui/Loader';
import useFormatPrice from '../hooks/useFormatPrice';

export default function AdminAnalytics() {
  const formatPrice = useFormatPrice('USD');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminService.analytics().then((r) => setData(r.data.analytics)).finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminLayout title="Analytics"><Loader /></AdminLayout>;
  if (!data) return null;

  const maxUsers = Math.max(...(data.usersByDay?.map((d) => d.count) || [1]), 1);
  const maxProducts = Math.max(...(data.productsByDay?.map((d) => d.count) || [1]), 1);

  return (
    <AdminLayout title="Analytics">
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6"
        >
          <h3 className="font-display font-bold text-lg mb-4">User Signups (30 days)</h3>
          <BarChart data={data.usersByDay} max={maxUsers} color="from-blue-500 to-cyan-500" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card p-6"
        >
          <h3 className="font-display font-bold text-lg mb-4">New Listings (30 days)</h3>
          <BarChart data={data.productsByDay} max={maxProducts} color="from-brand-500 to-accent-500" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card p-6"
        >
          <h3 className="font-display font-bold text-lg mb-4">Top Categories</h3>
          {data.topCategories?.length === 0 ? (
            <p className="text-sm text-slate-500">No data</p>
          ) : (
            <div className="space-y-2">
              {data.topCategories?.map((c) => {
                const max = data.topCategories[0]?.count || 1;
                return (
                  <div key={c._id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{c.name}</span>
                      <span className="font-semibold">{c.count}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(c.count / max) * 100}%` }}
                        transition={{ duration: 1 }}
                        className="h-full bg-gradient-to-r from-brand-500 to-accent-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card p-6"
        >
          <h3 className="font-display font-bold text-lg mb-4">Top Sellers</h3>
          {data.topSellers?.length === 0 ? (
            <p className="text-sm text-slate-500">No data</p>
          ) : (
            <div className="space-y-3">
              {data.topSellers?.map((s, i) => (
                <div key={s._id} className="flex items-center gap-3">
                  <span className="w-6 text-center font-bold text-slate-400">#{i + 1}</span>
                  {s.avatar?.url ? (
                    <img src={s.avatar.url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white text-xs font-bold">
                      {s.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-sm">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.count} listings, {s.sold} sold</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card p-6 lg:col-span-2"
        >
          <h3 className="font-display font-bold text-lg mb-4">Price Distribution</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.priceRanges?.map((range, i) => (
              <div key={i} className="p-4 rounded-xl bg-slate-50">
                <p className="text-xs text-slate-500 mb-1">
                  {range._id === 'Other'
                    ? 'Other'
                    : `${formatPrice(range._id)} - ${formatPrice(range._id + 50)}`}
                </p>
                <p className="font-display font-bold text-2xl">{range.count}</p>
                <p className="text-xs text-slate-500">listings</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </AdminLayout>
  );
}

function BarChart({ data = [], max, color }) {
  if (!data.length) return <p className="text-sm text-slate-500">No data</p>;

  return (
    <div className="flex items-end gap-1 h-40">
      {data.slice(-30).map((d, i) => (
        <div
          key={d._id}
          className="flex-1 group relative"
          title={`${d._id}: ${d.count}`}
        >
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${(d.count / max) * 100}%` }}
            transition={{ delay: i * 0.02, duration: 0.4 }}
            className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${color} rounded-t`}
          />
        </div>
      ))}
    </div>
  );
}
