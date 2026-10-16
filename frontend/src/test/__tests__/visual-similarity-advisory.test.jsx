import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import VisualSimilarityAdvisory from '../../components/product/VisualSimilarityAdvisory';
import ProductDetail from '../../pages/ProductDetail';

const ADVISORY =
  '⚠️ Visually similar to another active listing — we recommend verifying details with the seller before paying';

vi.mock('../../services/services', () => ({
  productService: {
    list: vi.fn().mockResolvedValue({ data: { items: [], pagination: { page: 1, pages: 1, total: 0 } } }),
    get: vi.fn().mockResolvedValue({
      data: {
        product: {
          _id: '1',
          title: 'Steel bottle',
          price: 500,
          images: [],
          seller: { _id: '9', name: 'Seller' },
          category: { name: 'Home & Garden' },
          buyerAdvisory:
            '⚠️ Visually similar to another active listing — we recommend verifying details with the seller before paying',
        },
      },
    }),
    similar: vi.fn().mockResolvedValue({ data: { items: [] } }),
    brands: vi.fn().mockResolvedValue({ data: { brands: [] } }),
    identityStatus: vi.fn().mockResolvedValue({ data: { tracked: false } }),
    reviews: vi.fn().mockResolvedValue({ data: { reviews: [], summary: { count: 0, average: 0 }, canReview: { allowed: false } } }),
  },
  categoryService: {
    list: vi.fn().mockResolvedValue({ data: { categories: [] } }),
    stats: vi.fn().mockResolvedValue({ data: { stats: [] } }),
  },
  favoriteService: {
    check: vi.fn().mockResolvedValue({ data: { favorited: false } }),
    add: vi.fn(),
    remove: vi.fn(),
  },
  chatService: {
    conversations: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
    messages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
    send: vi.fn(),
    markRead: vi.fn(),
    createConversation: vi.fn(),
  },
  sellerService: {
    trust: vi.fn().mockResolvedValue({ data: { trust: { score: 80, level: 'trusted' } } }),
  },
  reportService: { create: vi.fn() },
  offerService: { create: vi.fn() },
  notificationService: {
    list: vi.fn().mockResolvedValue({ data: { notifications: [] } }),
    unread: vi.fn().mockResolvedValue({ data: { count: 0 } }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: '1' }) };
});

describe('VisualSimilarityAdvisory', () => {
  it('renders the backend advisory verbatim (evidence phrasing)', () => {
    renderWithProviders(<VisualSimilarityAdvisory advisory={ADVISORY} />);
    const line = screen.getByText(ADVISORY);
    expect(line).toBeTruthy();
    expect(line.textContent).not.toMatch(/fraud|duplicate/i);
  });

  it('renders nothing when the backend reports no advisory', () => {
    const { container } = renderWithProviders(<VisualSimilarityAdvisory advisory="" />);
    expect(container.textContent).toBe('');
    const { container: c2 } = renderWithProviders(<VisualSimilarityAdvisory />);
    expect(c2.textContent).toBe('');
  });

  it('ProductDetail Trust panel shows the advisory line for a flagged listing', async () => {
    renderWithProviders(<ProductDetail />);
    const line = await screen.findByText(
      /Visually similar to another active listing/
    );
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('verifying details with the seller before paying');
  });
});
