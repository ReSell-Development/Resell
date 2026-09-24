import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/services', () => ({
  offerService: {
    create: vi.fn(),
    list: vi.fn(),
    received: vi.fn(),
    mine: vi.fn(),
    update: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    counter: vi.fn(),
  },
  notificationService: {
    list: vi.fn().mockResolvedValue({ data: { notifications: [] } }),
    unread: vi.fn().mockResolvedValue({ data: { count: 0 } }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', name: 'Test User', email: 'test@test.com', role: 'buyer' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../contexts/SocketContext', () => ({
  useSocket: () => ({
    totalUnread: 0,
    unreadNotifications: 0,
    setUnreadNotifications: vi.fn(),
  }),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    base: 'USD',
    rates: { USD: 1, fetchedAt: Date.now() },
    supported: ['USD'],
    setCurrency: vi.fn(),
    refreshRates: vi.fn(),
    loading: false,
  }),
}));

import { offerService } from '../../services/services';
import Offers from '../../pages/Offers';
import Navbar from '../../components/layout/Navbar';

const receivedOffer = {
  _id: 'o1',
  status: 'pending',
  amount: 400,
  currencyCode: 'USD',
  message: 'Would you take 400?',
  createdAt: new Date().toISOString(),
  product: {
    _id: 'p1',
    title: 'Vintage Camera',
    price: 500,
    images: [{ url: 'http://x.com/img.jpg' }],
  },
  buyer: { _id: 'b1', name: 'Buyer Ben' },
  seller: { _id: 'u1', name: 'Test User' },
};

const sentOffer = {
  _id: 'o2',
  status: 'pending',
  amount: 300,
  currencyCode: 'USD',
  message: '',
  createdAt: new Date().toISOString(),
  product: {
    _id: 'p2',
    title: 'Mechanical Keyboard',
    price: 350,
    images: [],
  },
  buyer: { _id: 'u1', name: 'Test User' },
  seller: { _id: 's1', name: 'Seller Sam' },
};

const renderOffers = () =>
  render(
    <MemoryRouter>
      <Offers />
    </MemoryRouter>
  );

const renderNavbar = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Navbar />
    </MemoryRouter>
  );

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(offerService.received).mockResolvedValue({ data: { offers: [receivedOffer] } });
  vi.mocked(offerService.mine).mockResolvedValue({ data: { offers: [sentOffer] } });
  vi.mocked(offerService.accept).mockResolvedValue({ data: {} });
  vi.mocked(offerService.reject).mockResolvedValue({ data: {} });
  vi.mocked(offerService.update).mockResolvedValue({ data: {} });
  vi.mocked(offerService.counter).mockResolvedValue({ data: {} });
});

describe('Offers page', () => {
  it('loads received offers on mount and shows seller actions', async () => {
    renderOffers();

    expect(offerService.received).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Counter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('switches to the Sent tab, loads sent offers and shows withdraw', async () => {
    const user = userEvent.setup();
    renderOffers();

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sent' }));

    expect(offerService.mine).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('accepts a received offer via the service', async () => {
    const user = userEvent.setup();
    renderOffers();

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(offerService.accept).toHaveBeenCalledWith('o1'));
  });

  it('counters a received offer with the entered amount', async () => {
    const user = userEvent.setup();
    renderOffers();

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Counter' }));
    await user.type(screen.getByPlaceholderText('Your price'), '450');
    await user.click(screen.getByRole('button', { name: /send counter/i }));

    await waitFor(() => expect(offerService.counter).toHaveBeenCalledWith('o1', { amount: 450 }));
  });

  it('withdraws a sent offer via the update service', async () => {
    const user = userEvent.setup();
    renderOffers();

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sent' }));
    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() =>
      expect(offerService.update).toHaveBeenCalledWith('o2', { status: 'withdrawn' })
    );
  });
});

describe('Offers navigation', () => {
  it('shows an Offers link in the desktop navbar', async () => {
    renderNavbar();

    const link = screen.getByRole('link', { name: 'Offers' });
    expect(link).toHaveAttribute('href', '/offers');
  });

  it('shows an Offers link in the user dropdown menu', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    const offersLinks = screen.getAllByRole('link', { name: 'Offers' });
    expect(offersLinks).toHaveLength(2);
    expect(offersLinks.every((l) => l.getAttribute('href') === '/offers')).toBe(true);
  });

  it('shows an Offers link in the mobile menu', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Menu' }));

    const offersLinks = screen.getAllByRole('link', { name: 'Offers' });
    expect(offersLinks).toHaveLength(2);
    expect(offersLinks.every((l) => l.getAttribute('href') === '/offers')).toBe(true);
  });
});

afterEach(cleanup);
