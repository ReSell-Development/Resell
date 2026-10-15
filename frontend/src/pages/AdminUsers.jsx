import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ShieldOff, ShieldCheck, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../services/services';
import AdminLayout from '../components/admin/AdminLayout';
import Loader from '../components/ui/Loader';
import { formatDate } from '../utils/format';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    loadUsers();
  }, [roleFilter]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const r = await adminService.users({ q: search, role: roleFilter });
      setUsers(r.data.items);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadUsers();
  };

  const handleToggleActive = async (user) => {
    try {
      await adminService.updateUser(user._id, { isActive: !user.isActive });
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, isActive: !u.isActive } : u)));
      toast.success(user.isActive ? 'User deactivated' : 'User activated');
    } catch {
      toast.error('Failed to update user');
    }
  };

  const handleChangeRole = async (user, role) => {
    try {
      await adminService.updateUser(user._id, { role });
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, role } : u)));
      toast.success('Role updated');
    } catch {
      toast.error('Failed to update role');
    }
  };

  return (
    <AdminLayout title="Users">
      <div className="card p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name or email..."
            className="input pl-9"
          />
        </form>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input max-w-[160px]">
          <option value="">All roles</option>
          <option value="buyer">Buyers</option>
          <option value="seller">Sellers</option>
          <option value="admin">Admins</option>
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
                  <th className="text-left p-3 font-medium text-sm">User</th>
                  <th className="text-left p-3 font-medium text-sm">Role</th>
                  <th className="text-left p-3 font-medium text-sm">Joined</th>
                  <th className="text-left p-3 font-medium text-sm">Status</th>
                  <th className="text-right p-3 font-medium text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {u.avatar?.url ? (
                          <img src={u.avatar.url} alt="" className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-semibold text-sm">
                            {u.name?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{u.name}</p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u, e.target.value)}
                        disabled={u.role === 'admin'}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
                      >
                        <option value="buyer">Buyer</option>
                        <option value="seller">Seller</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-3 text-sm text-slate-500">{formatDate(u.createdAt)}</td>
                    <td className="p-3">
                      <span
                        className={`badge ${
                          u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={u.role === 'admin'}
                        className="text-sm text-slate-600 hover:text-red-600 disabled:opacity-30"
                      >
                        {u.isActive ? (
                          <>
                            <ShieldOff className="w-4 h-4 inline" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-4 h-4 inline" />
                            Activate
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <p className="text-center text-slate-500 py-8">No users found</p>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
