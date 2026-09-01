import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { productService, categoryService } from '../services/services';
import PageTransition from '../components/layout/PageTransition';
import toast from 'react-hot-toast';
import SellForm from '../components/product/SellForm';
import { ScrollReveal } from '../components/ui/ScrollReveal';

export default function EditProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      productService.get(id),
      categoryService.list(),
    ])
      .then(([p, c]) => {
        if (p.data.product) setProduct(p.data.product);
        setCategories(c.data.categories);
      })
      .catch(() => toast.error('Failed to load product'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (form) => {
    setSubmitting(true);
    try {
      await productService.update(id, form);
      toast.success('Listing updated');
      navigate(`/product/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 max-w-4xl relative z-10">
          <ScrollReveal direction="up">
            <motion.button
              onClick={() => navigate(-1)}
              whileHover={{ x: -4 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </motion.button>
          </ScrollReveal>

          <ScrollReveal delay={0.1} direction="up">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display font-bold text-3xl mb-2"
            >
              Edit Listing
            </motion.h1>
          </ScrollReveal>

          <ScrollReveal delay={0.15} direction="up">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-slate-500 mb-8"
            >
              Update your product details.
            </motion.p>
          </ScrollReveal>

          {product && (
            <ScrollReveal delay={0.2} direction="up">
              <SellForm
                initial={product}
                categories={categories}
                onSubmit={handleSubmit}
                submitting={submitting}
                submitLabel="Save Changes"
              />
            </ScrollReveal>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
