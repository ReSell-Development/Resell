import { motion } from 'framer-motion';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ImageGallery({ images = [] }) {
  const [active, setActive] = useState(0);
  if (!images.length) {
    return (
      <div className="aspect-square bg-slate-100 rounded-2xl grid place-items-center text-slate-400">
        No image
      </div>
    );
  }

  const next = () => setActive((p) => (p + 1) % images.length);
  const prev = () => setActive((p) => (p - 1 + images.length) % images.length);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100 group">
        <motion.img
          key={images[active]}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          src={images[active].url}
          alt="Product"
          className="w-full h-full object-cover"
        />

        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur grid place-items-center opacity-0 group-hover:opacity-100 transition hover:bg-white shadow-lg"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur grid place-items-center opacity-0 group-hover:opacity-100 transition hover:bg-white shadow-lg"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${
                i === active ? 'border-brand-500' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <img src={img.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
