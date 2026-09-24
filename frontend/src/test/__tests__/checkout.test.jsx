import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../services/services', () => ({
  productService: {
    get: vi.fn(),
  },
  offerService: {
    get: vi.fn(),
  },
  checkoutService: {
    createSession: vi.fn(),
  },
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

import { productService, offerService, checkoutService } from '../../services/services';
import Checkout from '../../pages/Checkout';

const product = {
  _id: 'p1',
  title: 'Vintage Camera',
  description: 'Nice camera',
  price: 500,
  currencyCode: 'USD',
  images: [{ url: 'http://x.com/img.jpg' }],
  category: { name: 'Photography' },
};

const acceptedOffer = {
  _id: 'o1',
  status: 'accepted',
  amount: 400,
  currencyCode: 'USD',
  product: { _id: 'p1', title: 'Vintage Camera' },
  buyer: { _id: 'u1', name: 'Test User' },
  seller: { _id: 's2', name: 'Seller' },
};

const renderCheckoutAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/checkout/:id" element={<Checkout />} />
        <Route path="/marketplace" element={<div>marketplace</div>} />
      </Routes>
    </MemoryRouter>
  );

const fillAddressAndContinue = async (user) => {
  const inputs = await screen.findAllByRole('textbox');
  // Order matches the form: fullName, phone, line1, line2, city, state, postalCode, country
  await user.type(inputs[0], 'Test Buyer');
  await user.type(inputs[1], '5551234');
  await user.type(inputs[2], '1 Main St');
  await user.type(inputs[4], 'Springfield');
  await user.type(inputs[6], '12345');
  await user.type(inputs[7], 'US');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText('Order Summary');
};

const originalLocation = window.location;

beforeAll(() => {
  // jsdom cannot navigate to external URLs — capture the Stripe redirect target
  delete window.location;
  window.location = { href: '' };
});

afterAll(() => {
  window.location = originalLocation;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productService.get).mockResolvedValue({ data: { product } });
  vi.mocked(offerService.get).mockResolvedValue({ data: { offer: acceptedOffer } });
  vi.mocked(checkoutService.createSession).mockResolvedValue({
    data: { url: 'https://checkout.stripe.com/test', sessionId: 'cs_test_1' },
  });
});

afterEach(cleanup);

describe('Checkout with an accepted offer', () => {
  it('displays the negotiated offer amount instead of the listed price', async () => {
    const user = userEvent.setup();
    renderCheckoutAt('/checkout/p1?offer=o1');

    await fillAddressAndContinue(user);

    // Negotiated amount is shown; the $500 list price is not
    expect(screen.getAllByText('$400.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('$500.00')).toBeNull();
    expect(screen.getByText('Accepted offer applied')).toBeInTheDocument();
    expect(offerService.get).toHaveBeenCalledWith('o1');
  });

  it('sends the offerId when creating the checkout session', async () => {
    const user = userEvent.setup();
    renderCheckoutAt('/checkout/p1?offer=o1');

    await fillAddressAndContinue(user);
    await user.click(screen.getByRole('button', { name: /pay with stripe/i }));

    await waitFor(() =>
      expect(checkoutService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'p1', offerId: 'o1' })
      )
    );
  });
});

describe('Checkout without an offer', () => {
  it('keeps normal product-price behavior', async () => {
    const user = userEvent.setup();
    renderCheckoutAt('/checkout/p1');

    expect(offerService.get).not.toHaveBeenCalled();

    await fillAddressAndContinue(user);

    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('$400.00')).toBeNull();
    expect(screen.queryByText('Accepted offer applied')).toBeNull();
  });

  it('does not send an offerId when creating the session', async () => {
    const user = userEvent.setup();
    renderCheckoutAt('/checkout/p1');

    await fillAddressAndContinue(user);
    await user.click(screen.getByRole('button', { name: /pay with stripe/i }));

    await waitFor(() =>
      expect(checkoutService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'p1' })
      )
    );
    const payload = vi.mocked(checkoutService.createSession).mock.calls[0][0];
    expect(payload).not.toHaveProperty('offerId');
  });
});
