import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// Mock providers for isolated component testing
const mockAuthValue = {
  user: { _id: '1', name: 'Test User', email: 'test@test.com', role: 'buyer' },
  loading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
};

const mockSocketValue = {
  socket: null,
  connected: true,
  totalUnread: 0,
  onlineUsers: new Set(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  joinConversation: vi.fn(),
  leaveConversation: vi.fn(),
  emitTyping: vi.fn(),
  emitStopTyping: vi.fn(),
  setUnread: vi.fn(),
  incrementUnread: vi.fn(),
  clearUnread: vi.fn(),
};

const mockCurrencyValue = {
  currency: 'USD',
  base: 'USD',
  rates: { USD: 1, EUR: 0.92 },
  supported: ['USD', 'EUR', 'GBP'],
  setCurrency: vi.fn(),
  refreshRates: vi.fn(),
};

export function renderWithProviders(ui, { authValue, socketValue, currencyValue, route = '/' } = {}) {
  const auth = { ...mockAuthValue, ...authValue };
  const socket = { ...mockSocketValue, ...socketValue };
  const currency = { ...mockCurrencyValue, ...currencyValue };

  // Mock useAuth and useSocket hooks
  vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => auth,
    AuthProvider: ({ children }) => children,
  }));
  vi.mock('../contexts/SocketContext', () => ({
    useSocket: () => socket,
    SocketProvider: ({ children }) => children,
  }));
  vi.mock('../contexts/CurrencyContext', () => ({
    useCurrency: () => currency,
    CurrencyProvider: ({ children }) => children,
  }));

  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
}

export { mockAuthValue, mockSocketValue, mockCurrencyValue };
