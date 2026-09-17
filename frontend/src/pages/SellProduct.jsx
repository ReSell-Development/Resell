import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  X,
  Sparkles,
  Check,
  TrendingUp,
  Shield,
  Camera,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Tag,
  Image,
  DollarSign,
  Hash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productService, categoryService } from '../services/services';
import { formatPrice, getConditionLabel, cn } from '../utils/format';
import PageTransition from '../components/layout/PageTransition';
import { TiltCard } from '../components/ui/TiltCard';
import MagneticButton from '../components/ui/MagneticButton';
import { ScrollReveal } from '../components/ui/ScrollReveal';

const STEPS = [
  { id: 'photos', label: 'Photos', icon: Image },
  { id: 'details', label: 'Details', icon: Hash },
  { id: 'ai', label: 'AI Analysis', icon: Sparkles },
  { id: 'review', label: 'Review', icon: Check },
];

export default function SellProduct() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    originalPrice: '',
    category: '',
    brand: '',
    model: '',
    condition: 'good',
    yearsUsed: 0,
    specifications: [],
    location: { city: '', state: '', country: '' },
  });
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [priceSuggestion, setPriceSuggestion] = useState(null);
  const [categoryAutoFilled, setCategoryAutoFilled] = useState(false);

  useEffect(() => {
    categoryService.list().then((r) => setCategories(r.data.categories)).catch(() => {});
  }, []);

  // Auto-fill category from image classification prediction
  useEffect(() => {
    if (aiAnalysis?.predictedCategory && categories.length > 0 && !categoryAutoFilled && !form.category) {
      const predicted = categories.find(
        (c) => c.name.toLowerCase() === aiAnalysis.predictedCategory.toLowerCase()
      );
      if (predicted && aiAnalysis.classificationConfidence >= 0.3) {
        setForm((prev) => ({ ...prev, category: predicted._id }));
        setCategoryAutoFilled(true);
        toast.success(`Category auto-detected: ${predicted.name}`);
      }
    }
  }, [aiAnalysis, categories, categoryAutoFilled, form.category]);

  // Fetch price suggestion when category/condition/brand change
  useEffect(() => {
    if (!form.category || !form.condition) {
      setPriceSuggestion(null);
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      productService.suggestPrice({
        category: form.category,
        condition: form.condition,
        brand: form.brand || undefined,
        originalPrice: form.originalPrice || undefined,
        yearsUsed: form.yearsUsed || undefined,
      }).then((r) => setPriceSuggestion(r.data)).catch(() => {});
    }, 500); // debounce 500ms
    return () => { clearTimeout(timeoutId); controller.abort(); };
  }, [form.category, form.condition, form.brand, form.originalPrice, form.yearsUsed]);

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (images.length + files.length > 8) {
      toast.error('Maximum 8 images allowed');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    if (form.title) formData.append('title', form.title);

    try {
      const { data } = await productService.uploadImages(formData);
      setImages((prev) => [...prev, ...data.images]);
      if (data.analysis) {
        setAiAnalysis((prev) => ({
          ...prev,
          conditionScore: data.analysis.conditionScore,
          damageScore: data.analysis.damageScore,
          predictedCategory: data.analysis.predictedCategory,
          classificationConfidence: data.analysis.classificationConfidence,
        }));
      }
      toast.success(`${data.images.length} image(s) analyzed`);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(err.response?.data?.message || 'This image is already used in another listing. Please use a different photo.');
      } else {
        toast.error(err.response?.data?.message || 'Failed to upload images');
      }
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const addSpec = () => {
    setForm((prev) => ({ ...prev, specifications: [...prev.specifications, { key: '', value: '' }] }));
  };

  const updateSpec = (idx, key, value) => {
    setForm((prev) => ({
      ...prev,
      specifications: prev.specifications.map((s, i) => (i === idx ? { key, value } : s)),
    }));
  };

  const removeSpec = (idx) => {
    setForm((prev) => ({
      ...prev,
      specifications: prev.specifications.filter((_, i) => i !== idx),
    }));
  };

  const canProceed = () => {
    if (step === 0) return images.length > 0;
    if (step === 1) return form.title && form.description && form.price && form.category;
    return true;
  };

  const handleSubmit = async () => {
    if (!images.length) {
      toast.error('Please upload at least one image');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        originalPrice: Number(form.originalPrice) || 0,
        yearsUsed: Number(form.yearsUsed) || 0,
        images: images.map((img) => ({
          url: img.url,
          publicId: img.publicId,
          hash: img.hash,
        })),
        specifications: form.specifications.filter((s) => s.key && s.value),
        aiAnalysis: aiAnalysis || {},
      };
      const { data } = await productService.create(payload);
      toast.success('Listing published!');
      navigate(`/product/${data.product._id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create listing');
    } finally {
      setLoading(false);
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
              <h1 className="font-display font-bold text-3xl md:text-4xl mb-2">List Your Item</h1>
              <p className="text-slate-500">Our AI will analyze your images and suggest the optimal price.</p>
            </motion.div>
          </ScrollReveal>

          {/* Stepper */}
          <ScrollReveal delay={0.1} direction="up">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10"
            >
              <div className="flex items-center justify-between mb-4">
                {STEPS.map((s, i) => (
                  <div key={s.id} className="flex-1 flex items-center">
                    <motion.div
                      className={cn(
                        'w-12 h-12 rounded-full grid place-items-center font-semibold transition-all',
                        i < step
                          ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-500/30'
                          : i === step
                          ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                          : 'bg-slate-200 text-slate-500'
                      )}
                      animate={{
                        scale: i <= step ? 1 : 0.9,
                        backgroundColor: i < step
                          ? 'linear-gradient(135deg, #4f4af0, #6671f8)'
                          : i === step
                          ? 'linear-gradient(135deg, #4f4af0, #6671f8)'
                          : '#e2e8f0',
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      {i < step ? <Check className="w-5 h-5" /> : i + 1}
                    </motion.div>
                    {i < STEPS.length - 1 && (
                      <motion.div
                        className="flex-1 h-1 mx-2 bg-slate-200 rounded overflow-hidden"
                        initial={{ width: 0 }}
                        animate={{ width: i < step ? '100%' : '0%' }}
                        transition={{ delay: 0.2, duration: 0.3 }}
                      >
                        <motion.div
                          className="h-full bg-brand-500 rounded"
                          initial={{ width: 0 }}
                          animate={{ width: i < step ? '100%' : '0%' }}
                          transition={{ delay: 0.2, duration: 0.3 }}
                        />
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                {STEPS.map((s, i) => (
                  <motion.span
                    key={s.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className={cn(i === step && 'font-semibold text-brand-600')}
                  >
                    {s.label}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          </ScrollReveal>

          <AnimatePresence mode="wait">
            {/* STEP 0: IMAGES */}
            {step === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <ScrollReveal direction="up">
                  <TiltCard maxTilt={4} className="card p-6">
                    <div className="mb-6">
                      <h3 className="font-display font-bold text-lg mb-1">Upload Photos</h3>
                      <p className="text-sm text-slate-500">Add up to 8 high-quality images. The first image will be the cover.</p>
                    </div>

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer group"
                    >
                      {uploading ? (
                        <motion.div className="flex flex-col items-center gap-3">
                          <Loader2 className="w-12 h-12 animate-spin text-brand-500" />
                          <p className="font-medium text-slate-700">Analyzing images...</p>
                        </motion.div>
                      ) : (
                        <>
                          <motion.div
                            whileHover={{ scale: 1.1, rotate: 180 }}
                            className="w-16 h-16 mx-auto text-slate-400 mb-4"
                          >
                            <Upload className="w-16 h-16" />
                          </motion.div>
                          <p className="font-medium text-slate-700">Click to upload images</p>
                          <p className="text-sm text-slate-500 mt-1">PNG, JPG up to 10MB each</p>
                        </>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                    />

                    {images.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                        {images.map((img, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            className="relative group aspect-square rounded-xl overflow-hidden"
                          >
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                            <motion.button
                              onClick={() => removeImage(i)}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full grid place-items-center opacity-0 group-hover:opacity-100 transition"
                            >
                              <X className="w-4 h-4" />
                            </motion.button>
                            {i === 0 && (
                              <span className="absolute bottom-2 left-2 badge bg-white text-slate-900">Cover</span>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </TiltCard>
                </ScrollReveal>
              </motion.div>
            )}

            {/* STEP 1: DETAILS */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <ScrollReveal direction="up">
                  <TiltCard maxTilt={4} className="card p-6 space-y-6">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Title</label>
                      <input
                        type="text"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        placeholder="e.g. MacBook Pro 16 inch M2 - Like New"
                        className="input"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-1 block">Description</label>
                      <textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        rows={5}
                        placeholder="Describe the item in detail..."
                        className="input"
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">
                          Category
                          {categoryAutoFilled && (
                            <span className="ml-2 text-xs text-brand-500 font-normal">AI detected</span>
                          )}
                        </label>
                        <select
                          value={form.category}
                          onChange={(e) => { setForm({ ...form, category: e.target.value }); setCategoryAutoFilled(false); }}
                          className="input"
                        >
                          <option value="">Select a category</option>
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
                          placeholder="e.g. Apple"
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Model</label>
                        <input
                          type="text"
                          value={form.model}
                          onChange={(e) => setForm({ ...form, model: e.target.value })}
                          placeholder="e.g. MacBook Pro 16"
                          className="input"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Price ($)</label>
                        <input
                          type="number"
                          value={form.price}
                          onChange={(e) => setForm({ ...form, price: e.target.value })}
                          placeholder="0.00"
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Original Price ($)</label>
                        <input
                          type="number"
                          value={form.originalPrice}
                          onChange={(e) => setForm({ ...form, originalPrice: e.target.value })}
                          placeholder="0.00"
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
                      <label className="text-sm font-medium mb-1 block">Location</label>
                      <div className="grid sm:grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={form.location.city}
                          onChange={(e) => setForm({ ...form, location: { ...form.location, city: e.target.value } })}
                          placeholder="City"
                          className="input"
                        />
                        <input
                          type="text"
                          value={form.location.state}
                          onChange={(e) => setForm({ ...form, location: { ...form.location, state: e.target.value } })}
                          placeholder="State"
                          className="input"
                        />
                        <input
                          type="text"
                          value={form.location.country}
                          onChange={(e) => setForm({ ...form, location: { ...form.location, country: e.target.value } })}
                          placeholder="Country"
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
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex gap-2 mb-2"
                        >
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
                          <motion.button
                            type="button"
                            onClick={() => removeSpec(i)}
                            whileTap={{ scale: 0.9 }}
                            className="btn-secondary px-3"
                          >
                            <X className="w-4 h-4" />
                          </motion.button>
                        </motion.div>
                      ))}
                    </div>
                  </TiltCard>
                </ScrollReveal>
              </motion.div>
            )}

            {/* STEP 2: AI Analysis */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <ScrollReveal direction="up">
                  <TiltCard maxTilt={4} className="card p-6 bg-gradient-to-br from-brand-50 to-accent-50 border-brand-100">
                    <div className="flex items-center gap-3 mb-6">
                      <motion.div
                        animate={{ rotate: [0, 5, -5, 0] }}
                        transition={{ duration: 3, repeat: Infinity }}
                        className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 grid place-items-center"
                      >
                        <Sparkles className="w-6 h-6 text-white" />
                      </motion.div>
                      <div>
                        <h3 className="font-display font-bold text-lg">AI Analysis</h3>
                        <p className="text-sm text-slate-600">Powered by computer vision and pricing models</p>
                      </div>
                    </div>

                    <RevealOnScroll delay={0.05} className="grid sm:grid-cols-2 gap-4">
                      <AICard
                        icon={Camera}
                        title="Condition Score"
                        value={`${aiAnalysis?.conditionScore ?? '—'}/100`}
                        color="from-emerald-500 to-teal-500"
                      />
                      <AICard
                        icon={Shield}
                        title="Damage Score"
                        value={`${aiAnalysis?.damageScore ?? '—'}/100`}
                        color="from-amber-500 to-red-500"
                        inverted
                      />
                      <AICard
                        icon={Tag}
                        title="Suggested Category"
                        value={aiAnalysis?.predictedCategory || '—'}
                        color="from-violet-500 to-purple-500"
                      />
                      <AICard
                        icon={TrendingUp}
                        title="Confidence"
                        value={`${Math.round((aiAnalysis?.classificationConfidence || 0) * 100)}%`}
                        color="from-blue-500 to-cyan-500"
                      />
                    </RevealOnScroll>

                    {priceSuggestion && priceSuggestion.suggestedPrice > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 p-4 rounded-xl bg-white border border-slate-200"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="w-5 h-5 text-emerald-500" />
                          <span className="font-semibold text-sm">Suggested Price</span>
                        </div>
                        <div className="text-2xl font-display font-extrabold gradient-text mb-1">
                          {formatPrice(priceSuggestion.suggestedPrice)}
                        </div>
                        <div className="text-xs text-slate-500 mb-2">
                          Range: {formatPrice(priceSuggestion.priceRange.min)} – {formatPrice(priceSuggestion.priceRange.max)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Suggested based on {priceSuggestion.comparableCount} comparable listing{priceSuggestion.comparableCount !== 1 ? 's' : ''}
                          {priceSuggestion.confidence > 0 && ` · ${Math.round(priceSuggestion.confidence * 100)}% confidence`}
                        </div>
                        {priceSuggestion.factors?.length > 0 && (
                          <div className="mt-2 text-xs text-slate-400">
                            {priceSuggestion.factors.slice(0, 2).map((f, i) => (
                              <div key={i}>· {f}</div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                    {priceSuggestion && priceSuggestion.suggestedPrice === 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 p-4 rounded-xl bg-white border border-slate-200 text-sm text-slate-500"
                      >
                        Not enough data for a price suggestion yet. Add more details (category, original price) to get a recommendation.
                      </motion.div>
                    )}

                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 text-sm text-slate-600"
                    >
                      💡 Our AI analyzed your images using a MobileNet image classification model and detected visual signals.
                    </motion.p>
                  </TiltCard>
                </ScrollReveal>
              </motion.div>
            )}

            {/* STEP 3: REVIEW */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <ScrollReveal direction="up">
                  <TiltCard maxTilt={4} className="card p-6">
                    <h3 className="font-display font-bold text-lg mb-6">Review your listing</h3>
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <motion.img
                          src={images[0]?.url}
                          alt=""
                          className="w-full aspect-square object-cover rounded-xl"
                          initial={{ scale: 1.05 }}
                          animate={{ scale: 1 }}
                          transition={{ duration: 0.8 }}
                        />
                      </div>
                      <div className="space-y-4">
                        <motion.h2
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="font-display font-bold text-xl"
                        >
                          {form.title}
                        </motion.h2>
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                          className="text-3xl font-display font-extrabold gradient-text"
                        >
                          {formatPrice(Number(form.price))}
                        </motion.div>
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 }}
                          className="flex gap-2"
                        >
                          <span className="badge bg-slate-100">{getConditionLabel(form.condition)}</span>
                          {form.brand && <span className="badge bg-slate-100">{form.brand}</span>}
                        </motion.div>
                        <motion.p
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3 }}
                          className="text-sm text-slate-600 line-clamp-4"
                        >
                          {form.description}
                        </motion.p>
                      </div>
                    </div>
                  </TiltCard>
                </ScrollReveal>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <ScrollReveal delay={0.3} direction="up">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-between mt-10"
            >
              <MagneticButton
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="btn-secondary"
                strength={0.15}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </MagneticButton>

              {step < STEPS.length - 1 ? (
                <MagneticButton
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canProceed()}
                  className="btn-primary"
                  strength={0.15}
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </MagneticButton>
              ) : (
                <MagneticButton
                  onClick={handleSubmit}
                  disabled={loading}
                  className="btn-primary"
                  strength={0.15}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Publish Listing
                    </>
                  )}
                </MagneticButton>
              )}
            </motion.div>
          </ScrollReveal>
        </div>
      </div>
    </PageTransition>
  );
}

function AICard({ icon: Icon, title, value, color, inverted }) {
  const displayValue = inverted && value !== '—' ? `${100 - parseInt(value)}` : value;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="p-4 rounded-xl bg-white border border-slate-200"
    >
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} grid place-items-center mb-3`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-xs text-slate-500 mb-1">{title}</p>
      <p className="font-display font-bold text-xl">{displayValue}</p>
    </motion.div>
  );
}
