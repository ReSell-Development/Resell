import { useState } from 'react';
import { motion } from 'framer-motion';
import { User as UserIcon, Mail, MapPin, Phone, Save, Camera, ShieldCheck, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/services';
import PageTransition from '../components/layout/PageTransition';
import { ScrollReveal } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';
import { TiltCard } from '../components/ui/TiltCard';

export default function Profile() {
  const { user, updateUser, refresh } = useAuth();
  const [form, setForm] = useState({
    name: user.name || '',
    bio: user.bio || '',
    phone: user.phone || '',
    location: user.location || '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  });
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await authService.updateProfile(form);
      updateUser(data.user);
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await authService.changePassword(passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <PageTransition>
      <div className="relative min-h-screen">

        <div className="container-page py-8 md:py-12 max-w-4xl relative z-10">
          <ScrollReveal direction="up">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10"
            >
              <h1 className="font-display font-bold text-3xl md:text-4xl mb-2">Profile</h1>
              <p className="text-slate-500">Manage your account information</p>
            </motion.div>
          </ScrollReveal>

          {/* Tabs */}
          <ScrollReveal delay={0.1} direction="up">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-1 mb-6"
            >
              <div className="flex gap-1">
                {[
                  { id: 'profile', label: 'Profile', icon: UserIcon },
                  { id: 'security', label: 'Security', icon: ShieldCheck },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      activeTab === tab.id
                        ? 'bg-white shadow-lg text-brand-600'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </ScrollReveal>

          {activeTab === 'profile' && (
            <>
              {/* Avatar Card */}
              <ScrollReveal delay={0.15} direction="up">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card p-6 mb-6"
                >
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {user.avatar?.url ? (
                        <img
                          src={user.avatar.url}
                          alt=""
                          className="w-24 h-24 rounded-2xl object-cover ring-4 ring-white shadow-xl"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-bold text-4xl shadow-xl">
                          {user.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center shadow-lg"
                      >
                        <Camera className="w-4 h-4" />
                      </motion.button>
                    </div>
                    <div>
                      <h2 className="font-display font-bold text-2xl">{user.name}</h2>
                      <p className="text-sm text-slate-500">{user.email}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="badge bg-brand-100 text-brand-700 capitalize">{user.role}</span>
                        {user.isVerified && (
                          <span className="flex items-center gap-1 text-sm text-blue-600">
                            <ShieldCheck className="w-4 h-4" />
                            Verified
                          </span>
                        )}
                        {user.trustScore && (
                          <span className="flex items-center gap-1 text-sm text-amber-600">
                            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                            Trust: {user.trustScore}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </ScrollReveal>

              {/* Profile Form */}
              <ScrollReveal delay={0.2} direction="up">
                <motion.form
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  onSubmit={handleSubmit}
                  className="card p-6 space-y-6"
                >
                  <h3 className="font-display font-bold text-lg mb-2">Personal Information</h3>

                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium mb-1 block">Full Name</label>
                      <div className="relative">
                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="text"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          className="input pl-11"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-1 block">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="email"
                          value={user.email}
                          className="input pl-11 bg-slate-50 cursor-not-allowed"
                          disabled
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-1 block">Phone</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="text"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          className="input pl-11"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-1 block">Location</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="text"
                          value={form.location}
                          onChange={(e) => setForm({ ...form, location: e.target.value })}
                          className="input pl-11"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-1 block">Bio</label>
                    <textarea
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      rows={3}
                      placeholder="Tell others about yourself..."
                      className="input"
                    />
                  </div>

                  <MagneticButton
                    type="submit"
                    disabled={saving}
                    className="w-full btn-primary"
                    strength={0.15}
                  >
                    {saving ? 'Saving...' : (
                      <>
                        <Save className="w-4 h-4" />
                        Save Changes
                      </>
                    )}
                  </MagneticButton>
                </motion.form>
              </ScrollReveal>
            </>
          )}

          {activeTab === 'security' && (
            <ScrollReveal delay={0.15} direction="up">
              <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onSubmit={handlePassword}
                className="card p-6 space-y-6"
              >
                <h3 className="font-display font-bold text-lg mb-2">Change Password</h3>

                <div>
                  <label className="text-sm font-medium mb-1 block">Current Password</label>
                  <input
                    type="password"
                    required
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    className="input"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="input"
                  />
                </div>

                <MagneticButton
                  type="submit"
                  disabled={changingPassword}
                  className="w-full btn-primary"
                  strength={0.15}
                >
                  {changingPassword ? 'Changing...' : 'Change Password'}
                </MagneticButton>
              </motion.form>
            </ScrollReveal>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
