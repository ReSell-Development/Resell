import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit3, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { categoryService } from '../services/services';
import AdminLayout from '../components/admin/AdminLayout';
import Loader from '../components/ui/Loader';

const ICON_OPTIONS = ['smartphone', 'phone', 'laptop', 'shirt', 'home', 'activity', 'book', 'gamepad', 'heart', 'truck', 'package'];

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', icon: 'package' });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await categoryService.list();
      setCategories(r.data.categories);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await categoryService.update(editing._id, form);
        toast.success('Category updated');
      } else {
        await categoryService.create(form);
        toast.success('Category created');
      }
      setShowModal(false);
      setEditing(null);
      setForm({ name: '', description: '', icon: 'package' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleEdit = (cat) => {
    setEditing(cat);
    setForm({ name: cat.name, description: cat.description, icon: cat.icon });
    setShowModal(true);
  };

  const handleDelete = async (cat) => {
    if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    try {
      await categoryService.remove(cat._id);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <AdminLayout title="Categories">
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => {
            setEditing(null);
            setForm({ name: '', description: '', icon: 'package' });
            setShowModal(true);
          }}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          New Category
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loader />
        ) : (
          <div className="divide-y divide-slate-100">
            {categories.map((c) => (
              <motion.div
                key={c._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 flex items-center gap-4 hover:bg-slate-50"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-100 grid place-items-center text-xl">
                  {c.icon === 'smartphone' || c.icon === 'phone' ? '📱' :
                   c.icon === 'laptop' ? '💻' :
                   c.icon === 'shirt' ? '👕' :
                   c.icon === 'home' ? '🏠' :
                   c.icon === 'activity' ? '⚽' :
                   c.icon === 'book' ? '📚' :
                   c.icon === 'gamepad' ? '🎮' :
                   c.icon === 'heart' ? '💖' :
                   c.icon === 'truck' ? '🚗' : '📦'}
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-slate-500">{c.description || 'No description'}</p>
                </div>
                <code className="text-xs text-slate-400">{c.slug}</code>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(c)}
                    className="p-2 rounded hover:bg-slate-100"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="p-2 rounded hover:bg-red-50 text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
            {categories.length === 0 && (
              <p className="text-center text-slate-500 py-8">No categories</p>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 grid place-items-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-6 w-full max-w-md"
          >
            <h3 className="font-display font-bold text-xl mb-4">
              {editing ? 'Edit Category' : 'New Category'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="input"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Icon</label>
                <select
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  className="input"
                >
                  {ICON_OPTIONS.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  {editing ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AdminLayout>
  );
}
