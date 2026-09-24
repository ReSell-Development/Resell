import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../services/services', () => ({
  orderService: {
    myOrders: vi.fn(),
    mySales: vi.fn(),
    get: vi.fn(),
    ship: vi.fn(),
    deliver: vi.fn(),
    cancel: vi.fn(),
  },
  productService: { get: vi.fn() },
  offerService: { get: vi.fn() },
  checkoutService: { createSession: vi.fn() },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', name: 'Test User', email: 'test@test.com', role: 'buyer' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    base: 'USD',
    rates: { USD: 1 },
    supported: ['USD'],
    setCurrency: vi.fn(),
    refreshRates: vi.fn(),
    loading: false,
  }),
}));

import { orderService, productService } from '../../services/services';
import Orders from '../../pages/Orders';
import OrderDetail from '../../pages/OrderDetail';
import Checkout from '../../pages/Checkout';
import OrderSuccess from '../../pages/OrderSuccess';
import OrderCancelled from '../../pages/OrderCancelled';

const buyerOrders = [
  {
    _id: 'o1',
    status: 'paid',
    salePrice: 400,
    platformFee: 20,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    product: { _id: 'p1', title: 'Vintage Camera', images: [] },
    buyer: { _id: 'u1', name: 'Test User' },
    seller: { _id: 's1', name: 'Seller Sam' },
    trackingNumber: null,
  },
  {
    _id: 'o2',
    status: 'shipped',
    salePrice: 300,
    platformFee: 15,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    product: { _id: 'p2', title: 'Mechanical Keyboard', images: [] },
    buyer: { _id: 'u1', name: 'Test User' },
    seller: { _id: 's1', name: 'Seller Sam' },
    trackingNumber: 'TRK9',
  },
  {
    _id: 'o3',
    status: 'delivered',
    salePrice: 120,
    platformFee: 6,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    product: { _id: 'p3', title: 'Desk Lamp', images: [] },
    buyer: { _id: 'u1', name: 'Test User' },
    seller: { _id: 's1', name: 'Seller Sam' },
    trackingNumber: null,
  },
  {
    _id: 'o5',
    status: 'pending_payment',
    salePrice: 90,
    platformFee: 5,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    product: { _id: 'p5', title: 'Notebook', images: [] },
    buyer: { _id: 'u1', name: 'Test User' },
    seller: { _id: 's1', name: 'Seller Sam' },
    trackingNumber: null,
  },
];

const sellerPaidSale = {
  _id: 'o4',
  status: 'paid',
  salePrice: 500,
  platformFee: 25,
  currencyCode: 'USD',
  createdAt: new Date().toISOString(),
  product: { _id: 'p4', title: 'Used Synth', images: [] },
  buyer: { _id: 'b9', name: 'Betty Buyer' },
  seller: { _id: 'u1', name: 'Test User' },
  trackingNumber: null,
};

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/checkout/:id" element={<Checkout />} />
        <Route path="/order-success" element={<OrderSuccess />} />
        <Route path="/order-cancelled" element={<OrderCancelled />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = vi.fn(() => true);
  vi.mocked(orderService.myOrders).mockResolvedValue({ data: { orders: buyerOrders } });
  vi.mocked(orderService.mySales).mockResolvedValue({ data: { orders: [sellerPaidSale] } });
  vi.mocked(orderService.get).mockResolvedValue({ data: { order: buyerOrders[1] } });
  vi.mocked(orderService.ship).mockResolvedValue({ data: {} });
  vi.mocked(orderService.deliver).mockResolvedValue({ data: {} });
  vi.mocked(orderService.cancel).mockResolvedValue({ data: {} });
});

afterEach(cleanup);

describe('Orders list', () => {
  it('renders orders with status-appropriate buyer actions', async () => {
    renderAt('/orders');

    expect(await screen.findByText('Vintage Camera')).toBeInTheDocument();
    expect(orderService.myOrders).toHaveBeenCalledTimes(1);

    // Buyer of a shipped order sees Confirm Delivery
    expect(screen.getByRole('button', { name: /confirm delivery/i })).toBeInTheDocument();

    // Cancel available for pending_payment + paid orders
    expect(screen.getAllByRole('button', { name: /cancel order/i })).toHaveLength(2);

    // Buyer never sees seller-only Ship; delivered order shows no actions
    expect(screen.queryByText('Ship order')).toBeNull();
    expect(screen.queryByText('Tracking:')).toBeNull();
  });

  it('shows tracking number on shipped orders', async () => {
    renderAt('/orders');
    await screen.findByText('Mechanical Keyboard');
    expect(screen.getByText(/Tracking: TRK9/)).toBeInTheDocument();
  });

  it('switches to My Sales and loads sales via mySales', async () => {
    const user = userEvent.setup();
    renderAt('/orders');
    await screen.findByText('Vintage Camera');

    await user.click(screen.getByRole('button', { name: 'My Sales' }));

    expect(orderService.mySales).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Used Synth')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ship order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm delivery/i })).toBeNull();
  });

  it('seller ships an order with a tracking number', async () => {
    const user = userEvent.setup();
    renderAt('/orders');
    await screen.findByText('Vintage Camera');
    await user.click(screen.getByRole('button', { name: 'My Sales' }));
    expect(await screen.findByText('Used Synth')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ship order' }));
    await user.type(screen.getByPlaceholderText('Tracking number (optional)'), 'TRK123');
    await user.click(screen.getByRole('button', { name: /confirm shipment/i }));

    await waitFor(() =>
      expect(orderService.ship).toHaveBeenCalledWith('o4', { trackingNumber: 'TRK123' })
    );
    // List refreshes after the action
    await waitFor(() => expect(orderService.mySales).toHaveBeenCalledTimes(2));
  });

  it('buyer confirms delivery and the list refreshes', async () => {
    const user = userEvent.setup();
    renderAt('/orders');
    await screen.findByText('Vintage Camera');

    await user.click(screen.getByRole('button', { name: /confirm delivery/i }));

    await waitFor(() => expect(orderService.deliver).toHaveBeenCalledWith('o2'));
    await waitFor(() => expect(orderService.myOrders).toHaveBeenCalledTimes(2));
  });

  it('buyer cancels a paid order with a refund warning and refreshes', async () => {
    const user = userEvent.setup();
    renderAt('/orders');
    await screen.findByText('Vintage Camera');

    await user.click(screen.getByRole('button', { name: /cancel order \(refund\)/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('refund'));
    await waitFor(() => expect(orderService.cancel).toHaveBeenCalledWith('o1'));
    await waitFor(() => expect(orderService.myOrders).toHaveBeenCalledTimes(2));
  });

  it('does not cancel when the confirmation is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup();
    renderAt('/orders');
    await screen.findByText('Vintage Camera');

    await user.click(screen.getByRole('button', { name: /cancel order \(refund\)/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(orderService.cancel).not.toHaveBeenCalled();
  });
});

describe('Order detail', () => {
  it('renders the order with tracking number and participants', async () => {
    renderAt('/orders/o2');

    expect(orderService.get).toHaveBeenCalledWith('o2');
    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.getByText(/Tracking: TRK9/)).toBeInTheDocument();
    expect(screen.getByText('Buyer: Test User')).toBeInTheDocument();
    expect(screen.getByText('Seller: Seller Sam')).toBeInTheDocument();
  });

  it('buyer confirms delivery from the detail page and data refreshes', async () => {
    const user = userEvent.setup();
    renderAt('/orders/o2');
    await screen.findByText('Mechanical Keyboard');

    await user.click(screen.getByRole('button', { name: /confirm delivery/i }));

    await waitFor(() => expect(orderService.deliver).toHaveBeenCalledWith('o2'));
    await waitFor(() => expect(orderService.get).toHaveBeenCalledTimes(2));
  });

  it('seller sees Ship for a paid sale on the detail page', async () => {
    vi.mocked(orderService.get).mockResolvedValue({ data: { order: sellerPaidSale } });
    renderAt('/orders/o4');

    expect(await screen.findByText('Used Synth')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ship order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm delivery/i })).toBeNull();
  });

  it('hides actions when the status does not permit them', async () => {
    const shippedSellerOrder = {
      ...sellerPaidSale,
      status: 'shipped',
      trackingNumber: 'TRK7',
    };
    vi.mocked(orderService.get).mockResolvedValue({ data: { order: shippedSellerOrder } });
    renderAt('/orders/o4');

    expect(await screen.findByText('Used Synth')).toBeInTheDocument();
    expect(screen.queryByText('Ship order')).toBeNull();
    expect(screen.queryByRole('button', { name: /confirm delivery/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });
});

describe('Order-related routes render', () => {
  it('/checkout/:id renders the checkout page', async () => {
    vi.mocked(productService.get).mockResolvedValue({
      data: {
        product: {
          _id: 'p1',
          title: 'Vintage Camera',
          price: 500,
          currencyCode: 'USD',
          images: [],
          category: { name: 'Photography' },
        },
      },
    });
    renderAt('/checkout/p1');
    expect(await screen.findByText('Checkout')).toBeInTheDocument();
  });

  it('/order-success renders', async () => {
    renderAt('/order-success');
    expect(await screen.findByText('Payment Successful!')).toBeInTheDocument();
  });

  it('/order-cancelled renders', async () => {
    renderAt('/order-cancelled');
    expect(await screen.findByText('Payment Cancelled')).toBeInTheDocument();
  });
});
