import type {
  PosCatalogItem,
  PosBasketPricing,
  PosCustomerLocationOption,
  PosCustomerOption,
  PosCustomerPaymentOptions,
  PosDiscountAuthorization,
  PosDiscountType,
  PosLoyaltyLedger,
  PosPaymentMethod,
  PosQuickAccess,
  PosRegisterOption,
  PosReturn,
  PosSale,
  PosShift,
  PosTerminalContext,
} from '@vista/contracts';
import { Help, Toast, VistaMark } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from './api/client';
import { messages } from './messages';
import { returnLineGross } from './return-totals';
import {
  authorizePosDiscount,
  createPosInvoiceDraft,
  createPosReturn,
  closePosShift,
  enrolPosLoyalty,
  getPosCatalog,
  getPosCustomers,
  getPosCustomerPaymentOptions,
  getPosQuickAccess,
  getPosLoyaltyLedger,
  getPosReturns,
  getPosSales,
  getPosTerminalContext,
  downloadPosWarrantyCard,
  openPosShift,
  pricePosBasket,
  updatePosQuickAccess,
} from './api/pos';
import { PosReports } from './PosReports';
import { CheckoutRecovery } from './CheckoutRecovery';
import { submitDurableCheckout } from './checkout-recovery';
import { readCheckout } from './checkout-store';
import { CheckoutHistory } from './CheckoutHistory';

type PosScreen = 'reports' | 'returns' | 'sales' | 'sell' | 'shifts' | 'checkouts';
type Notice = { kind: 'error' | 'info' | 'success'; text: string };

const screenLabels: Record<PosScreen, string> = {
  checkouts: 'Recovery',
  reports: 'Reports',
  returns: 'Returns',
  sales: 'Sale history',
  sell: 'Sell',
  shifts: 'Shifts',
};
const screenOrder: PosScreen[] = ['sell', 'returns', 'sales', 'shifts', 'reports', 'checkouts'];
const screenPaths: Record<PosScreen, string> = {
  checkouts: '/checkouts',
  reports: '/reports',
  returns: '/returns',
  sales: '/sales',
  sell: '/',
  shifts: '/shifts',
};

function normalizePosPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return `/${pathname.split('/').filter(Boolean).join('/')}`;
}

function screenForPath(pathname: string): PosScreen {
  const normalized = normalizePosPath(pathname);
  return (
    (Object.entries(screenPaths).find(([, path]) => path === normalized)?.[0] as
      PosScreen | undefined) ?? 'sell'
  );
}

function shouldUseBrowserNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function PosTerminal({
  canCreateReports = false,
  accountId,
  employeeName,
  onSignOut,
  token,
}: {
  canCreateReports?: boolean;
  accountId: string;
  employeeName: string;
  onSignOut: () => Promise<void>;
  token: string;
}) {
  const [context, setContext] = useState<PosTerminalContext>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>();
  const [screen, setScreen] = useState<PosScreen>(() => screenForPath(window.location.pathname));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [checkoutBlocked, setCheckoutBlocked] = useState(true);
  const [pendingCount, setPendingCount] = useState<number>();
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);
  const [recoveredReceipt, setRecoveredReceipt] = useState<PosSale>();
  const [saleRevision, setSaleRevision] = useState(0);
  const [recoveryContainer, setRecoveryContainer] = useState<HTMLElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => readSoundPreference(accountId));
  const accountMenu = useRef<HTMLDivElement>(null);
  const navigation = useActiveItemVisibility<HTMLElement>(screen);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const navigate = useCallback((next: PosScreen, replace = false) => {
    const path = screenPaths[next];
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method](window.history.state, '', path);
    setScreen(next);
    setNotice(undefined);
  }, []);

  useEffect(() => {
    const path = normalizePosPath(window.location.pathname);
    if (!Object.values(screenPaths).includes(path)) navigate('sell', true);

    const handlePopState = () => {
      setScreen(screenForPath(window.location.pathname));
      setNotice(undefined);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navigate]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (notice && soundEnabled) playNoticeSound(notice.kind);
  }, [notice, soundEnabled]);

  useEffect(() => {
    if (!soundEnabled) return undefined;
    const prime = () => primeNoticeAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, [soundEnabled]);

  const refreshContext = useCallback(async () => {
    try {
      setContext(await getPosTerminalContext(token));
      setNotice(undefined);
    } catch (error) {
      setNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const shift = context?.currentShift;
  const activeRegister = context?.registers.find(
    (register) => register.id === shift?.cashRegisterId,
  );
  const simulator = context?.registers.some((register) => register.fiscalMode === 'simulator');

  return (
    <div className="pos-terminal">
      <header className="pos-topbar">
        <div className="pos-brand">
          <span aria-hidden="true" className="pos-brand-mark">
            <VistaMark compact product="Vista POS" />
          </span>
          <div>
            <strong>Vista POS</strong>
            <small>{shift ? shift.cashRegisterName : 'Counter workspace'}</small>
          </div>
        </div>
        <div className="pos-system-status" aria-label="Terminal system status">
          <span className={`pos-status-dot ${shift ? 'is-ready' : 'is-warning'}`} />
          <span>
            {loading ? 'Checking terminal' : shift ? `${shift.shiftNumber} open` : 'Shift closed'}
          </span>
          <button onClick={() => navigate('shifts')} type="button">
            {shift ? 'View shift' : 'Open shift'}
          </button>
        </div>
        <div className="pos-account" ref={accountMenu}>
          <Help app="pos" />
          <button
            aria-expanded={accountMenuOpen}
            aria-haspopup="true"
            aria-label="Open account menu"
            className="pos-account-trigger"
            onClick={() => setAccountMenuOpen((open) => !open)}
            type="button"
          >
            <span>{initials(employeeName)}</span>
            <strong>{employeeName}</strong>
            <PosIcon name="chevron" />
          </button>
          {accountMenuOpen ? (
            <div aria-label="Account options" className="pos-account-menu" role="group">
              <div className="pos-account-summary">
                <span>{initials(employeeName)}</span>
                <div>
                  <strong>{employeeName}</strong>
                  <small>{shift ? shift.shiftNumber : 'No open shift'}</small>
                </div>
              </div>
              <button
                aria-checked={soundEnabled}
                className="pos-sound-setting"
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  writeSoundPreference(accountId, next);
                  if (next) playNoticeSound('success');
                }}
                role="switch"
                type="button"
              >
                <PosIcon name={soundEnabled ? 'volume' : 'volume-off'} />
                <span>
                  <strong>Sale sounds</strong>
                  <small>Completed sales and errors</small>
                </span>
                <i className={soundEnabled ? 'is-on' : ''} aria-hidden="true" />
              </button>
              <button
                className="pos-account-sign-out"
                onClick={() => void onSignOut()}
                type="button"
              >
                <PosIcon name="logout" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="pos-workspace">
        <nav aria-label="POS navigation" className="pos-nav" ref={navigation}>
          {screenOrder.map((item) => (
            <a
              aria-current={screen === item ? 'page' : undefined}
              className={screen === item ? 'is-active' : undefined}
              href={screenPaths[item]}
              key={item}
              onClick={(event) => {
                if (shouldUseBrowserNavigation(event)) return;
                event.preventDefault();
                navigate(item);
              }}
            >
              <span className="pos-nav-icon" aria-hidden="true">
                <PosIcon name={screenIcon(item)} />
              </span>
              <span className="pos-nav-label">{screenLabels[item]}</span>
            </a>
          ))}
        </nav>

        <main className={`pos-main pos-main--${screen}`}>
          {notice ? <NoticeBar notice={notice} onClose={() => setNotice(undefined)} /> : null}
          {loading ? (
            <PageLoading />
          ) : screen === 'sell' ? (
            <SellScreen
              key={saleRevision}
              checkoutBlocked={checkoutBlocked}
              onCheckoutBusy={setCheckoutInFlight}
              accountId={accountId}
              onNavigate={navigate}
              onNotice={setNotice}
              register={activeRegister}
              shift={shift}
              token={token}
            />
          ) : screen === 'returns' ? (
            <ReturnsScreen
              onNavigate={navigate}
              onNotice={setNotice}
              onReturned={refreshContext}
              register={activeRegister}
              shift={shift}
              token={token}
            />
          ) : screen === 'shifts' ? (
            <ShiftScreen
              accountId={accountId}
              checkoutBlocked={checkoutBlocked || checkoutInFlight}
              context={context}
              onNavigate={navigate}
              onNotice={setNotice}
              onOpened={refreshContext}
              token={token}
            />
          ) : screen === 'checkouts' ? (
            <CheckoutHistory
              onRecoveryContainer={setRecoveryContainer}
              accountId={accountId}
              token={token}
              onBack={() => navigate('sell')}
              onReceipt={setRecoveredReceipt}
            />
          ) : screen === 'reports' ? (
            <PosReports canCreate={canCreateReports} onNotice={setNotice} token={token} />
          ) : (
            <SaleHistory onNotice={setNotice} token={token} />
          )}
        </main>
      </div>

      <CheckoutRecovery
        container={recoveryContainer}
        accountId={accountId}
        token={token}
        refresh={saleRevision}
        paused={checkoutInFlight}
        onBlocked={setCheckoutBlocked}
        onPending={setPendingCount}
        onRecovered={(sale) => {
          setRecoveredReceipt(sale);
          setSaleRevision((value) => value + 1);
          void refreshContext();
          setNotice({
            kind: 'success',
            text: `${sale.saleNumber} confirmed. No second sale was created.`,
          });
        }}
      />
      {recoveredReceipt ? (
        <ReceiptDialog
          sale={recoveredReceipt}
          token={token}
          onClose={() => setRecoveredReceipt(undefined)}
          onNotice={setNotice}
          onSaleUpdated={setRecoveredReceipt}
        />
      ) : null}

      <footer className="pos-footer">
        <button className="pos-recovery-status" type="button" onClick={() => navigate('checkouts')}>
          <i className={pendingCount === 0 ? 'is-ready' : 'is-warning'} />
          {pendingCount === undefined
            ? 'Checking saved checkouts'
            : pendingCount
              ? '1 checkout pending'
              : 'No pending checkouts'}
        </button>
        <span>
          <i className={shift ? 'is-ready' : 'is-warning'} />
          {shift ? `${shift.warehouseName} connected` : 'Open a shift to use stock'}
        </span>
        <span>
          <i className={simulator ? 'is-warning' : 'is-muted'} />
          {simulator ? 'Test receipt mode' : 'Fiscal device unavailable'}
        </span>
        <span>
          <i className={online ? 'is-ready' : 'is-warning'} />
          {online ? 'Network available' : 'Offline · reconnect to complete sales'}
        </span>
      </footer>
    </div>
  );
}

function SellScreen({
  accountId,
  checkoutBlocked,
  onCheckoutBusy,
  onNavigate,
  onNotice,
  register,
  shift,
  token,
}: {
  accountId: string;
  checkoutBlocked: boolean;
  onCheckoutBusy: (busy: boolean) => void;
  onNavigate: (screen: PosScreen) => void;
  onNotice: (notice: Notice) => void;
  register: PosRegisterOption | undefined;
  shift: PosShift | undefined;
  token: string;
}) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [cashTendered, setCashTendered] = useState('');
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerSelection>();
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [loyaltyDialogOpen, setLoyaltyDialogOpen] = useState(false);
  const [loyaltyLedger, setLoyaltyLedger] = useState<PosLoyaltyLedger>();
  const [loyaltyPoints, setLoyaltyPoints] = useState('0');
  const [manualDiscount, setManualDiscount] = useState<ApprovedManualDiscount>();
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentOptions, setPaymentOptions] = useState<PosCustomerPaymentOptions>();
  const [paymentOptionsError, setPaymentOptionsError] = useState<string>();
  const [paymentOptionsLoading, setPaymentOptionsLoading] = useState(false);
  const [customerAdvanceId, setCustomerAdvanceId] = useState('');
  const [customerAdvanceAmount, setCustomerAdvanceAmount] = useState('');
  const [customerRemainderMethod, setCustomerRemainderMethod] =
    useState<CustomerRemainderMethod>('on_account');
  const [paying, setPaying] = useState(false);
  const [pricing, setPricing] = useState<PosBasketPricing>();
  const [pricingError, setPricingError] = useState<string>();
  const [pricingLoading, setPricingLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [quickAccess, setQuickAccess] = useState<PosQuickAccess>();
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  const [receipt, setReceipt] = useState<PosSale>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [splitCash, setSplitCash] = useState('');
  const [transactionId, setTransactionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!shift) {
      setCatalog([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      setCatalogError(undefined);
      void getPosCatalog(token, {
        ...(customer ? { customerPartnerId: customer.customer.id } : {}),
        ...(query.trim() ? { search: query.trim() } : {}),
        shiftId: shift.id,
      })
        .then((page) => setCatalog(page.items))
        .catch((error) => setCatalogError(messageFor(error)))
        .finally(() => setCatalogLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [customer, query, refreshKey, shift, token]);

  useEffect(() => {
    if (!shift) {
      setQuickAccess(undefined);
      return;
    }
    void getPosQuickAccess(token, {
      ...(customer ? { customerPartnerId: customer.customer.id } : {}),
      shiftId: shift.id,
    })
      .then(setQuickAccess)
      .catch((error) => onNotice({ kind: 'error', text: messageFor(error) }));
  }, [customer, onNotice, refreshKey, shift, token]);

  useEffect(() => {
    if (!customer) {
      setPaymentOptions(undefined);
      setPaymentOptionsError(undefined);
      setPaymentOptionsLoading(false);
      setCustomerAdvanceId('');
      setCustomerAdvanceAmount('');
      return;
    }
    let active = true;
    setPaymentOptionsLoading(true);
    setPaymentOptionsError(undefined);
    void getPosCustomerPaymentOptions(token, customer.customer.id)
      .then((options) => {
        if (!active) return;
        setPaymentOptions(options);
        setCustomerAdvanceId(options.advances[0]?.id ?? '');
        setCustomerAdvanceAmount('');
        setCustomerRemainderMethod(options.onAccountAvailable ? 'on_account' : 'cash');
      })
      .catch((error) => {
        if (active) {
          setPaymentOptions(undefined);
          setPaymentOptionsError(messageFor(error));
        }
      })
      .finally(() => active && setPaymentOptionsLoading(false));
    return () => {
      active = false;
    };
  }, [customer, refreshKey, token]);

  useEffect(() => {
    if (!shift || !basket.length) {
      setPricing(undefined);
      setPricingError(undefined);
      setPricingLoading(false);
      return;
    }
    let active = true;
    setPricingLoading(true);
    setPricingError(undefined);
    const timer = window.setTimeout(() => {
      void pricePosBasket(token, {
        ...(customer ? { customerPartnerId: customer.customer.id } : {}),
        lines: saleLinesFor(basket),
        loyaltyPointsToRedeem: Math.max(0, Math.floor(Number(loyaltyPoints || 0))),
        ...(manualDiscount
          ? {
              manualDiscount: {
                authorizationId: manualDiscount.authorization.id,
                discountType: manualDiscount.authorization.discountType,
                discountValue: manualDiscount.authorization.discountValue,
              },
            }
          : {}),
        shiftId: shift.id,
      })
        .then((result) => {
          if (active) setPricing(result);
        })
        .catch((error) => {
          if (!active) return;
          setPricing(undefined);
          setPricingError(messageFor(error));
        })
        .finally(() => {
          if (active) setPricingLoading(false);
        });
    }, 140);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [basket, customer, loyaltyPoints, manualDiscount, shift, token]);

  const localTotals = useMemo(() => basketTotals(basket), [basket]);
  const totals = pricing
    ? {
        gross: Number(pricing.grossTotal),
        net: Number(pricing.netTotal),
        vat: Number(pricing.vatTotal),
      }
    : localTotals;
  const selectedAdvance = paymentOptions?.advances.find(
    (advance) => advance.id === customerAdvanceId,
  );
  const advanceInputError =
    paymentMode === 'customer' && selectedAdvance
      ? advanceAmountIssue(
          customerAdvanceAmount,
          totals.gross,
          Number(selectedAdvance.availableAmount),
        )
      : undefined;
  const advancePortion =
    paymentMode === 'customer'
      ? Math.min(totals.gross, Math.max(0, Number(customerAdvanceAmount || 0)))
      : 0;
  const customerRemainder = Math.max(0, totals.gross - advancePortion);
  const cashPortion =
    paymentMode === 'cash'
      ? totals.gross
      : paymentMode === 'split'
        ? Number(splitCash || 0)
        : paymentMode === 'customer' && customerRemainderMethod === 'cash'
          ? customerRemainder
          : 0;
  const cardPortion =
    paymentMode === 'card'
      ? totals.gross
      : paymentMode === 'split'
        ? Math.max(0, totals.gross - cashPortion)
        : paymentMode === 'customer' && customerRemainderMethod === 'card'
          ? customerRemainder
          : 0;
  const cashChange = Math.max(0, Number(cashTendered || 0) - cashPortion);
  const blockingIssue =
    (checkoutBlocked ? 'Confirm the saved checkout before completing another sale.' : undefined) ??
    advanceInputError ??
    basketIssue(
      basket,
      customer,
      paymentMode,
      cashTendered,
      splitCash,
      totals.gross,
      register?.paymentTerminalMode === 'simulator' || register?.paymentTerminalMode === 'hardware',
      paymentOptions,
      paymentOptionsLoading,
      paymentOptionsError,
      selectedAdvance,
      advancePortion,
      customerRemainder,
      customerRemainderMethod,
    ) ??
    (pricingLoading ? 'Checking offers…' : pricingError);

  function changed(next: BasketLine[]) {
    setBasket(next);
    setManualDiscount(undefined);
    setTransactionId(crypto.randomUUID());
    setCashTendered('');
    setSplitCash('');
    setCustomerAdvanceAmount('');
  }

  function addItem(item: PosCatalogItem) {
    if (!item.unitPrice || !item.vatTreatment) {
      onNotice({ kind: 'error', text: `${item.name} is not ready for counter sale.` });
      return;
    }
    const current = basket.find((line) => line.item.id === item.id);
    if (current) {
      if (item.trackingMode === 'serial') {
        onNotice({ kind: 'info', text: 'Choose the serial number in the basket before payment.' });
        return;
      }
      const quantityValue = Math.min(current.quantity + 1, Number(item.availableQuantity));
      changed(
        basket.map((line) =>
          line.item.id === item.id ? { ...line, quantity: quantityValue } : line,
        ),
      );
      return;
    }
    changed([...basket, { item, quantity: 1 }]);
  }

  async function pay() {
    if (!shift || blockingIssue) return;
    setPaying(true);
    onCheckoutBusy(true);
    try {
      const sale = await submitDurableCheckout(accountId, token, {
        clientTransactionId: transactionId,
        ...(customer?.location ? { customerLocationId: customer.location.id } : {}),
        ...(customer ? { customerPartnerId: customer.customer.id } : {}),
        lines: saleLinesFor(basket),
        loyaltyPointsToRedeem: pricing?.loyaltyPointsRedeemed ?? 0,
        ...(manualDiscount
          ? {
              manualDiscount: {
                authorizationId: manualDiscount.authorization.id,
                discountType: manualDiscount.authorization.discountType,
                discountValue: manualDiscount.authorization.discountValue,
              },
            }
          : {}),
        payments:
          paymentMode === 'cash'
            ? [
                {
                  amount: totals.gross.toFixed(4),
                  method: 'cash',
                  tenderedAmount: Number(cashTendered).toFixed(4),
                },
              ]
            : paymentMode === 'card'
              ? [{ amount: totals.gross.toFixed(4), method: 'card' }]
              : paymentMode === 'split'
                ? [
                    {
                      amount: cashPortion.toFixed(4),
                      method: 'cash',
                      tenderedAmount: Number(cashTendered).toFixed(4),
                    },
                    { amount: cardPortion.toFixed(4), method: 'card' },
                  ]
                : [
                    ...(advancePortion > 0 && selectedAdvance
                      ? [
                          {
                            advanceId: selectedAdvance.id,
                            amount: advancePortion.toFixed(4),
                            method: 'advance' as const,
                          },
                        ]
                      : []),
                    ...(customerRemainder > 0
                      ? [
                          customerRemainderMethod === 'cash'
                            ? {
                                amount: customerRemainder.toFixed(4),
                                method: 'cash' as const,
                                tenderedAmount: Number(cashTendered).toFixed(4),
                              }
                            : {
                                amount: customerRemainder.toFixed(4),
                                method:
                                  customerRemainderMethod === 'card'
                                    ? ('card' as const)
                                    : ('on_account' as const),
                              },
                        ]
                      : []),
                  ],
        shiftId: shift.id,
      });
      setReceipt(sale);
      setBasket([]);
      setCashTendered('');
      setSplitCash('');
      setCustomerAdvanceAmount('');
      setLoyaltyPoints('0');
      setManualDiscount(undefined);
      setPricing(undefined);
      setLoyaltyLedger(undefined);
      if (customer?.customer.loyalty) {
        setCustomer({
          ...customer,
          customer: {
            ...customer.customer,
            loyalty: {
              ...customer.customer.loyalty,
              balance:
                customer.customer.loyalty.balance -
                sale.loyaltyPointsRedeemed +
                sale.loyaltyPointsEarned,
            },
          },
        });
      }
      setTransactionId(crypto.randomUUID());
      setRefreshKey((value) => value + 1);
      onNotice({ kind: 'success', text: `${sale.saleNumber} completed successfully.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setPaying(false);
      onCheckoutBusy(false);
    }
  }

  return (
    <div className="pos-sale-layout">
      <section
        className="pos-catalog-panel"
        aria-labelledby="sale-title"
        inert={checkoutBlocked || paying}
      >
        <header className="pos-page-heading">
          <div>
            <p>Point of sale</p>
            <h1 id="sale-title">New sale</h1>
          </div>
          <button className="pos-quiet-button" onClick={() => onNavigate('shifts')} type="button">
            {shift ? shift.shiftNumber : 'Open shift'}
          </button>
        </header>

        <div className="pos-search-shell">
          <label htmlFor="pos-product-search">Search or scan</label>
          <input
            autoComplete="off"
            disabled={!shift}
            id="pos-product-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Scan barcode, enter product code, or search by name"
            value={query}
          />
          <kbd>F2</kbd>
        </div>

        {shift && !query.trim() ? (
          <section className="pos-quick-access" aria-labelledby="quick-access-title">
            <header>
              <div>
                <strong id="quick-access-title">Quick access</strong>
                <span>Your counter shortcuts use current prices and stock.</span>
              </div>
              <button onClick={() => setQuickEditorOpen(true)} type="button">
                Edit shortcuts
              </button>
            </header>
            {quickAccess?.items.length ? (
              <div className="pos-quick-grid">
                {quickAccess.items.map((item) => (
                  <button
                    disabled={!item.unitPrice || Number(item.availableQuantity) <= 0}
                    key={item.id}
                    onClick={() => addItem(item)}
                    type="button"
                  >
                    <span>{item.productCode}</span>
                    <strong>{item.name}</strong>
                    <small>{grossUnitPrice(item).toFixed(2)} BGN</small>
                  </button>
                ))}
              </div>
            ) : (
              <button
                className="pos-quick-empty"
                onClick={() => setQuickEditorOpen(true)}
                type="button"
              >
                Choose the products your team sells most often
              </button>
            )}
          </section>
        ) : null}

        <div className="pos-catalog-toolbar">
          <div>
            <strong>{query ? 'Search results' : 'Counter catalog'}</strong>
            <span>
              {shift ? `${catalog.length} products · live availability` : 'A shift is required'}
            </span>
          </div>
          {customer ? <span className="pos-price-context">Customer pricing applied</span> : null}
        </div>

        {!shift ? (
          <ActionEmpty
            action="Open cashier shift"
            description="Choose your assigned register and enter the opening cash before starting a sale."
            onAction={() => onNavigate('shifts')}
            title="The counter is closed"
          />
        ) : catalogLoading ? (
          <CatalogLoading />
        ) : catalogError ? (
          <ActionEmpty
            action="Try again"
            description={catalogError}
            onAction={() => setRefreshKey((value) => value + 1)}
            title="Catalog unavailable"
          />
        ) : catalog.length ? (
          <div className="pos-product-grid">
            {catalog.map((item) => (
              <button
                className="pos-product-card"
                disabled={!item.unitPrice || Number(item.availableQuantity) <= 0}
                key={item.id}
                onClick={() => addItem(item)}
                type="button"
              >
                <span className="pos-product-code">{item.productCode}</span>
                <strong>{item.name}</strong>
                <small>
                  {trackingLabel(item)} · {quantity(item.availableQuantity)} {item.unitCode}{' '}
                  available
                </small>
                <span className="pos-product-price">
                  {item.unitPrice ? `${grossUnitPrice(item).toFixed(2)} BGN` : 'Price unavailable'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <ActionEmpty
            action="Clear search"
            description="Try a product name, product code, or exact barcode."
            onAction={() => setQuery('')}
            title="No products found"
          />
        )}

        <section className="pos-action-strip" aria-label="Sale shortcuts">
          <button disabled={!shift} onClick={() => setCustomerPickerOpen(true)} type="button">
            <kbd>F4</kbd> Customer
          </button>
          <button
            disabled={Boolean(blockingIssue) || paying}
            onClick={() => void pay()}
            type="button"
          >
            <kbd>F12</kbd> Complete sale
          </button>
        </section>
      </section>

      <aside
        className="pos-basket"
        aria-label="Current sale basket"
        inert={checkoutBlocked || paying}
      >
        <header className="pos-basket-header">
          <div>
            <p>Current sale</p>
            <strong>{customer?.customer.name ?? 'Counter customer'}</strong>
            {customer?.location ? <small>{customer.location.name}</small> : null}
          </div>
          <button disabled={!shift} onClick={() => setCustomerPickerOpen(true)} type="button">
            {customer ? 'Change' : 'Add customer'}
          </button>
        </header>

        <div
          aria-label="Sale details and payment"
          className="pos-basket-scroll"
          role="region"
          tabIndex={0}
        >
          <div className="pos-basket-lines">
            {basket.length ? (
              basket.map((line) => (
                <BasketRow
                  key={line.item.id}
                  line={line}
                  onChange={(next) =>
                    changed(basket.map((item) => (item.item.id === line.item.id ? next : item)))
                  }
                  onRemove={() => changed(basket.filter((item) => item.item.id !== line.item.id))}
                  {...(pricing?.lines.find((item) => item.productId === line.item.id)
                    ? {
                        pricedLine: pricing.lines.find((item) => item.productId === line.item.id)!,
                      }
                    : {})}
                />
              ))
            ) : (
              <div className="pos-basket-empty">
                <span aria-hidden="true">0</span>
                <p>No items in this sale</p>
                <small>Choose a product from the counter catalog to begin.</small>
              </div>
            )}
          </div>

          {basket.length ? (
            <section className="pos-commercial-controls" aria-label="Offers and rewards">
              <div className="pos-commercial-heading">
                <span>Offers & rewards</span>
                {pricingLoading ? <small>Checking…</small> : null}
              </div>
              <button
                className={manualDiscount ? 'is-applied' : undefined}
                onClick={() => setDiscountDialogOpen(true)}
                type="button"
              >
                <PosIcon name="discount" />
                <span>
                  <strong>{manualDiscount ? 'Manual discount approved' : 'Manual discount'}</strong>
                  <small>
                    {manualDiscount
                      ? `${discountLabel(manualDiscount.authorization)} · ${manualDiscount.authorization.approverName}`
                      : 'Requires approval from another employee'}
                  </small>
                </span>
                <PosIcon name="chevron" />
              </button>
              {customer ? (
                <button
                  className={customer.customer.loyalty ? 'is-applied' : undefined}
                  onClick={() => {
                    setLoyaltyLedger(undefined);
                    setLoyaltyDialogOpen(true);
                    if (customer.customer.loyalty)
                      void getPosLoyaltyLedger(token, customer.customer.id)
                        .then(setLoyaltyLedger)
                        .catch((error) => onNotice({ kind: 'error', text: messageFor(error) }));
                  }}
                  type="button"
                >
                  <PosIcon name="loyalty" />
                  <span>
                    <strong>
                      {customer.customer.loyalty
                        ? `${customer.customer.loyalty.balance} reward points`
                        : 'Join Vista Rewards'}
                    </strong>
                    <small>
                      {customer.customer.loyalty
                        ? customer.customer.loyalty.cardNumber
                        : 'Create a loyalty card for this customer'}
                    </small>
                  </span>
                  <PosIcon name="chevron" />
                </button>
              ) : (
                <p>Choose a customer to use rewards.</p>
              )}
              {customer?.customer.loyalty?.status === 'active' &&
              customer.customer.loyalty.balance > 0 ? (
                <label className="pos-points-entry">
                  <span>Points to use</span>
                  <input
                    max={customer.customer.loyalty.balance}
                    min="0"
                    onChange={(event) => {
                      setLoyaltyPoints(event.target.value);
                      setTransactionId(crypto.randomUUID());
                    }}
                    step="1"
                    type="number"
                    value={loyaltyPoints}
                  />
                </label>
              ) : null}
              {pricingError ? <p className="is-error">{pricingError}</p> : null}
            </section>
          ) : null}

          <div className="pos-totals">
            {pricing && Number(pricing.automaticDiscountTotal) > 0 ? (
              <div className="is-discount">
                <span>Offers</span>
                <strong>−{money(Number(pricing.automaticDiscountTotal))}</strong>
              </div>
            ) : null}
            {pricing && Number(pricing.manualDiscountTotal) > 0 ? (
              <div className="is-discount">
                <span>Manual discount</span>
                <strong>−{money(Number(pricing.manualDiscountTotal))}</strong>
              </div>
            ) : null}
            {pricing && Number(pricing.loyaltyDiscountTotal) > 0 ? (
              <div className="is-discount">
                <span>Rewards</span>
                <strong>−{money(Number(pricing.loyaltyDiscountTotal))}</strong>
              </div>
            ) : null}
            <div>
              <span>Net</span>
              <strong>{money(totals.net)}</strong>
            </div>
            <div>
              <span>VAT</span>
              <strong>{money(totals.vat)}</strong>
            </div>
            <div className="pos-total">
              <span>Total due</span>
              <strong>{money(totals.gross)}</strong>
            </div>
          </div>

          <section className="pos-payment-entry" aria-label="Payment method">
            <span>Payment method</span>
            <div className="pos-payment-methods">
              {(['cash', 'card', 'split', 'customer'] as const).map((method) => (
                <button
                  aria-pressed={paymentMode === method}
                  className={paymentMode === method ? 'is-active' : undefined}
                  disabled={
                    (method === 'card' || method === 'split') &&
                    register?.paymentTerminalMode === 'disabled'
                  }
                  key={method}
                  onClick={() => {
                    setPaymentMode(method);
                    setCashTendered('');
                    setSplitCash('');
                    if (method === 'customer') {
                      const advance = paymentOptions?.advances[0];
                      setCustomerAdvanceId(advance?.id ?? '');
                      setCustomerAdvanceAmount(
                        advance
                          ? Math.min(totals.gross, Number(advance.availableAmount)).toFixed(2)
                          : '0.00',
                      );
                      setCustomerRemainderMethod(
                        paymentOptions?.onAccountAvailable ? 'on_account' : 'cash',
                      );
                    }
                    setTransactionId(crypto.randomUUID());
                  }}
                  type="button"
                >
                  {method === 'cash'
                    ? 'Cash'
                    : method === 'card'
                      ? 'Bank card'
                      : method === 'split'
                        ? 'Split'
                        : 'Advance / account'}
                </button>
              ))}
            </div>
            {paymentMode === 'split' ? (
              <MoneyEntry
                id="split-cash-portion"
                label="Cash portion"
                max={totals.gross}
                onChange={setSplitCash}
                value={splitCash}
              />
            ) : null}
            {paymentMode === 'customer' ? (
              <div className="pos-customer-payment">
                {!customer ? (
                  <div className="pos-customer-payment-empty">
                    <strong>Choose a customer</strong>
                    <span>Customer advances and approved credit will then appear here.</span>
                    <button onClick={() => setCustomerPickerOpen(true)} type="button">
                      Choose customer
                    </button>
                  </div>
                ) : paymentOptionsLoading ? (
                  <p className="pos-customer-payment-state">Checking customer balances…</p>
                ) : paymentOptionsError ? (
                  <p className="pos-customer-payment-state is-error">{paymentOptionsError}</p>
                ) : paymentOptions ? (
                  <>
                    <div className="pos-customer-balance-strip">
                      <div>
                        <span>Advance available</span>
                        <strong>{money(Number(paymentOptions.advanceBalance))}</strong>
                      </div>
                      <div>
                        <span>Credit available</span>
                        <strong>{money(Number(paymentOptions.availableCredit))}</strong>
                      </div>
                    </div>
                    {paymentOptions.advances.length ? (
                      <div className="pos-customer-advance-fields">
                        <label>
                          <span>Advance</span>
                          <select
                            onChange={(event) => {
                              const id = event.target.value;
                              const advance = paymentOptions.advances.find(
                                (item) => item.id === id,
                              );
                              setCustomerAdvanceId(id);
                              setCustomerAdvanceAmount(
                                advance
                                  ? Math.min(totals.gross, Number(advance.availableAmount)).toFixed(
                                      2,
                                    )
                                  : '0.00',
                              );
                              setTransactionId(crypto.randomUUID());
                            }}
                            value={customerAdvanceId}
                          >
                            {paymentOptions.advances.map((advance) => (
                              <option key={advance.id} value={advance.id}>
                                {advance.number} · {money(Number(advance.availableAmount))}
                              </option>
                            ))}
                          </select>
                        </label>
                        <MoneyEntry
                          {...(advanceInputError
                            ? { errorId: 'customer-advance-amount-error' }
                            : {})}
                          id="customer-advance-amount"
                          label="Use from advance"
                          max={Math.min(
                            totals.gross,
                            Number(selectedAdvance?.availableAmount ?? 0),
                          )}
                          onChange={(value) => {
                            setCustomerAdvanceAmount(value);
                            setTransactionId(crypto.randomUUID());
                          }}
                          value={customerAdvanceAmount}
                        />
                        {advanceInputError ? (
                          <small className="pos-money-error" id="customer-advance-amount-error">
                            {advanceInputError}
                          </small>
                        ) : null}
                      </div>
                    ) : (
                      <p className="pos-customer-payment-state">No unused advance is available.</p>
                    )}
                    {customerRemainder > 0 ? (
                      <fieldset className="pos-remainder-methods">
                        <legend>Pay remaining {money(customerRemainder)} by</legend>
                        <div>
                          {(['cash', 'card', 'on_account'] as const).map((method) => (
                            <button
                              aria-pressed={customerRemainderMethod === method}
                              className={
                                customerRemainderMethod === method ? 'is-active' : undefined
                              }
                              disabled={
                                (method === 'card' &&
                                  register?.paymentTerminalMode === 'disabled') ||
                                (method === 'on_account' &&
                                  (!paymentOptions.onAccountAvailable ||
                                    Number(paymentOptions.availableCredit) < customerRemainder))
                              }
                              key={method}
                              onClick={() => {
                                setCustomerRemainderMethod(method);
                                setCashTendered('');
                                setTransactionId(crypto.randomUUID());
                              }}
                              type="button"
                            >
                              {method === 'cash'
                                ? 'Cash'
                                : method === 'card'
                                  ? 'Bank card'
                                  : 'On account'}
                            </button>
                          ))}
                        </div>
                        {customerRemainderMethod === 'on_account' &&
                        paymentOptions.paymentTermsDays !== undefined ? (
                          <small>
                            Due in {paymentOptions.paymentTermsDays} days · Current balance{' '}
                            {money(Number(paymentOptions.outstandingBalance))}
                          </small>
                        ) : null}
                      </fieldset>
                    ) : !advanceInputError ? (
                      <div className="pos-advance-covers-total">
                        <PosIcon name="check" /> The advance covers the full sale.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            {paymentMode === 'cash' ||
            paymentMode === 'split' ||
            (paymentMode === 'customer' &&
              customerRemainder > 0 &&
              customerRemainderMethod === 'cash') ? (
              <MoneyEntry
                id="cash-tendered"
                label="Cash received"
                onChange={setCashTendered}
                value={cashTendered}
              />
            ) : paymentMode === 'card' ||
              (paymentMode === 'customer' &&
                customerRemainder > 0 &&
                customerRemainderMethod === 'card') ? (
              <div className="pos-card-authorisation">
                <span className="pos-status-dot is-ready" />
                <p>
                  <strong>
                    {register?.paymentTerminalMode === 'simulator'
                      ? 'Test card terminal'
                      : (register?.paymentTerminalLabel ?? 'Card terminal')}
                  </strong>
                  <small>{money(cardPortion)} will be authorised at checkout.</small>
                </p>
              </div>
            ) : null}
            {paymentMode === 'split' ? (
              <div className="pos-split-summary">
                <span>Card portion</span>
                <strong>{money(cardPortion)}</strong>
              </div>
            ) : null}
            {cashPortion > 0 ? (
              <p className="pos-change-line">
                Change <strong>{money(cashChange)}</strong>
              </p>
            ) : null}
          </section>
          <button
            className="pos-pay-button"
            disabled={Boolean(blockingIssue) || paying}
            onClick={() => void pay()}
            type="button"
          >
            {paying ? 'Completing sale…' : `Complete sale · ${money(totals.gross)}`}
          </button>
          {!advanceInputError ? (
            <p className="pos-basket-disclaimer">
              {blockingIssue ?? `${paymentLabel(paymentMode)} payment is ready.`}
            </p>
          ) : null}
        </div>
      </aside>

      {customerPickerOpen ? (
        <CustomerPicker
          {...(customer ? { current: customer } : {})}
          onClose={() => setCustomerPickerOpen(false)}
          onSelect={(selection) => {
            setCustomer(selection);
            setLoyaltyLedger(undefined);
            setLoyaltyPoints('0');
            setManualDiscount(undefined);
            setCustomerPickerOpen(false);
            setTransactionId(crypto.randomUUID());
          }}
          token={token}
        />
      ) : null}
      {discountDialogOpen && shift && basket.length ? (
        <DiscountAuthorizationDialog
          basket={basket}
          {...(customer ? { customerPartnerId: customer.customer.id } : {})}
          onApproved={(approved) => {
            setManualDiscount(approved);
            setDiscountDialogOpen(false);
            setTransactionId(crypto.randomUUID());
            onNotice({
              kind: 'success',
              text: `Discount approved by ${approved.authorization.approverName}.`,
            });
          }}
          onClose={() => setDiscountDialogOpen(false)}
          shiftId={shift.id}
          token={token}
        />
      ) : null}
      {loyaltyDialogOpen && customer ? (
        <LoyaltyDialog
          customer={customer.customer}
          {...(loyaltyLedger ? { initialLedger: loyaltyLedger } : {})}
          onClose={() => setLoyaltyDialogOpen(false)}
          onEnrolled={(account, ledger) => {
            const nextCustomer = { ...customer.customer, loyalty: account };
            setCustomer({ ...customer, customer: nextCustomer });
            setLoyaltyLedger(ledger);
          }}
          token={token}
        />
      ) : null}
      {receipt ? (
        <ReceiptDialog
          closeLabel="Start next sale"
          completed
          onClose={() => setReceipt(undefined)}
          onNotice={onNotice}
          onSaleUpdated={setReceipt}
          sale={receipt}
          token={token}
        />
      ) : null}
      {quickEditorOpen && shift ? (
        <QuickAccessDialog
          {...(customer ? { customerPartnerId: customer.customer.id } : {})}
          current={quickAccess?.productIds ?? []}
          onClose={() => setQuickEditorOpen(false)}
          onSaved={(next) => {
            setQuickAccess(next);
            setQuickEditorOpen(false);
            onNotice({ kind: 'success', text: 'Quick-access products updated.' });
          }}
          shiftId={shift.id}
          token={token}
        />
      ) : null}
    </div>
  );
}

interface BasketLine {
  batchId?: string;
  item: PosCatalogItem;
  quantity: number;
  serialNumber?: string;
}
interface ApprovedManualDiscount {
  authorization: PosDiscountAuthorization;
}
type PaymentMode = 'card' | 'cash' | 'customer' | 'split';
type CustomerRemainderMethod = 'card' | 'cash' | 'on_account';
interface CustomerSelection {
  customer: PosCustomerOption;
  location?: PosCustomerLocationOption;
}

function QuickAccessDialog({
  current,
  customerPartnerId,
  onClose,
  onSaved,
  shiftId,
  token,
}: {
  current: string[];
  customerPartnerId?: string;
  onClose: () => void;
  onSaved: (quickAccess: PosQuickAccess) => void;
  shiftId: string;
  token: string;
}) {
  const [error, setError] = useState<string>();
  const [items, setItems] = useState<PosCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>(current);

  useEffect(() => {
    void getPosCatalog(token, {
      ...(customerPartnerId ? { customerPartnerId } : {}),
      shiftId,
    })
      .then((page) => setItems(page.items))
      .catch((caught) => setError(messageFor(caught)))
      .finally(() => setLoading(false));
  }, [customerPartnerId, shiftId, token]);

  const visible = items.filter((item) =>
    `${item.name} ${item.productCode}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  function toggle(productId: string) {
    if (selected.includes(productId)) {
      setSelected(selected.filter((id) => id !== productId));
      return;
    }
    if (selected.length >= 12) {
      setError('You can keep up to 12 quick-access products.');
      return;
    }
    setError(undefined);
    setSelected([...selected, productId]);
  }

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await updatePosQuickAccess(token, { productIds: selected, shiftId });
      onSaved(
        await getPosQuickAccess(token, {
          ...(customerPartnerId ? { customerPartnerId } : {}),
          shiftId,
        }),
      );
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="quick-access-dialog-title"
        aria-modal="true"
        className="pos-dialog pos-quick-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Counter setup</p>
            <h2 id="quick-access-dialog-title">Quick-access products</h2>
          </div>
          <button aria-label="Close quick-access setup" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          <div className="pos-quick-dialog-intro">
            <p>
              Choose up to 12 products. Their live price and availability appear at the counter.
            </p>
            <strong>{selected.length} / 12 selected</strong>
          </div>
          <label className="pos-dialog-search">
            <span>Find product</span>
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Product name or code"
              value={query}
            />
          </label>
          {error ? <p className="pos-dialog-state is-error">{error}</p> : null}
          {loading ? <p className="pos-dialog-state">Loading products…</p> : null}
          {!loading ? (
            <div className="pos-quick-options">
              {visible.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <label className={checked ? 'is-selected' : undefined} key={item.id}>
                    <input checked={checked} onChange={() => toggle(item.id)} type="checkbox" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.productCode} · {quantity(item.availableQuantity)} available
                      </small>
                    </span>
                    <em>
                      {item.unitPrice ? `${grossUnitPrice(item).toFixed(2)} BGN` : 'No price'}
                    </em>
                  </label>
                );
              })}
              {!visible.length ? <p className="pos-dialog-state">No matching product.</p> : null}
            </div>
          ) : null}
        </div>
        <footer>
          <button className="pos-secondary-button" onClick={onClose} type="button">
            Back
          </button>
          <button
            className="pos-primary-button"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? 'Saving…' : 'Save shortcuts'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MoneyEntry({
  errorId,
  id,
  label,
  max,
  onChange,
  value,
}: {
  errorId?: string;
  id: string;
  label: string;
  max?: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="pos-money-entry" htmlFor={id}>
      <span>{label}</span>
      <div>
        <input
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          aria-label={label}
          id={id}
          inputMode="decimal"
          min="0"
          {...(max === undefined ? {} : { max })}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          step="0.01"
          type="number"
          value={value}
        />
        <span>BGN</span>
      </div>
    </label>
  );
}

function advanceAmountIssue(value: string, gross: number, available: number): string | undefined {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return messages.advanceInvalid;
  if (amount > available) return messages.advanceAboveBalance;
  if (amount > gross) return messages.advanceAboveTotal;
  return undefined;
}

function BasketRow({
  line,
  onChange,
  onRemove,
  pricedLine,
}: {
  line: BasketLine;
  onChange: (line: BasketLine) => void;
  onRemove: () => void;
  pricedLine?: PosBasketPricing['lines'][number];
}) {
  const maximum = Math.max(1, Math.floor(Number(line.item.availableQuantity)));
  return (
    <article className="pos-basket-row">
      <div className="pos-basket-row-heading">
        <div>
          <strong>{line.item.name}</strong>
          <small>{line.item.productCode}</small>
        </div>
        <button aria-label={`Remove ${line.item.name}`} onClick={onRemove} type="button">
          <PosIcon name="close" />
        </button>
      </div>
      {line.item.trackingMode === 'serial' ? (
        <label className="pos-tracking-field">
          <span>Serial number</span>
          <select
            onChange={(event) => onChange(withSerial(line, event.target.value))}
            value={line.serialNumber ?? ''}
          >
            <option value="">Choose available serial</option>
            {line.item.serialNumbers.map((serial) => (
              <option key={serial} value={serial}>
                {serial}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {line.item.trackingMode === 'batch' ? (
        <label className="pos-tracking-field">
          <span>Batch</span>
          <select
            onChange={(event) => onChange(withBatch(line, event.target.value))}
            value={line.batchId ?? ''}
          >
            <option value="">Choose available batch</option>
            {line.item.batches.map((batch) => (
              <option key={batch.batchId} value={batch.batchId}>
                {batch.batchNumber} · {quantity(batch.quantity)} available
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="pos-basket-row-footer">
        {line.item.trackingMode === 'serial' ? (
          <span>1 unit</span>
        ) : (
          <div className="pos-quantity-stepper">
            <button
              aria-label={`Reduce ${line.item.name} quantity`}
              disabled={line.quantity <= 1}
              onClick={() => onChange({ ...line, quantity: line.quantity - 1 })}
              type="button"
            >
              −
            </button>
            <strong>{line.quantity}</strong>
            <button
              aria-label={`Increase ${line.item.name} quantity`}
              disabled={line.quantity >= maximum}
              onClick={() => onChange({ ...line, quantity: line.quantity + 1 })}
              type="button"
            >
              +
            </button>
          </div>
        )}
        <strong>{money(pricedLine ? Number(pricedLine.grossTotal) : lineGross(line))}</strong>
      </div>
      {pricedLine?.pricingAdjustments.length ? (
        <div className="pos-line-adjustments">
          {pricedLine.pricingAdjustments.map((adjustment) => (
            <span key={`${adjustment.source}-${adjustment.code}`}>
              {adjustment.label} <strong>−{money(Number(adjustment.amount))}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CustomerPicker({
  current,
  onClose,
  onSelect,
  token,
}: {
  current?: CustomerSelection;
  onClose: () => void;
  onSelect: (selection?: CustomerSelection) => void;
  token: string;
}) {
  const [customers, setCustomers] = useState<PosCustomerOption[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PosCustomerOption | undefined>(current?.customer);
  const [locationId, setLocationId] = useState(current?.location?.id ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(undefined);
      void getPosCustomers(token, query.trim() || undefined)
        .then(setCustomers)
        .catch((caught) => setError(messageFor(caught)))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, token]);

  const location = selected?.locations.find((item) => item.id === locationId);
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="customer-picker-title"
        aria-modal="true"
        className="pos-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Customer profile</p>
            <h2 id="customer-picker-title">Choose customer</h2>
          </div>
          <button aria-label="Close customer search" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          <label className="pos-dialog-search">
            <span>Search customers</span>
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company, UIC, or VAT number"
              value={query}
            />
          </label>
          {loading ? <p className="pos-dialog-state">Loading customers…</p> : null}
          {error ? <p className="pos-dialog-state is-error">{error}</p> : null}
          {!loading && !error ? (
            <div className="pos-customer-results">
              {customers.map((customer) => (
                <button
                  className={selected?.id === customer.id ? 'is-selected' : undefined}
                  key={customer.id}
                  onClick={() => {
                    setSelected(customer);
                    setLocationId(
                      customer.locations.length === 1 ? (customer.locations[0]?.id ?? '') : '',
                    );
                  }}
                  type="button"
                >
                  <strong>{customer.name}</strong>
                  <span>{customer.uic ? `UIC ${customer.uic}` : 'Customer account'}</span>
                </button>
              ))}
              {!customers.length ? <p className="pos-dialog-state">No customer found.</p> : null}
            </div>
          ) : null}
          {selected ? (
            <fieldset className="pos-location-choice">
              <legend>Receiving location</legend>
              <label>
                <input
                  checked={!locationId}
                  name="location"
                  onChange={() => setLocationId('')}
                  type="radio"
                />
                <span>
                  <strong>Counter sale</strong>
                  <small>No equipment location</small>
                </span>
              </label>
              {selected.locations.map((item) => (
                <label key={item.id}>
                  <input
                    checked={locationId === item.id}
                    name="location"
                    onChange={() => setLocationId(item.id)}
                    type="radio"
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.city}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
        <footer>
          <button
            className="pos-secondary-button"
            onClick={() => onSelect(undefined)}
            type="button"
          >
            Clear customer
          </button>
          <button
            className="pos-primary-button"
            disabled={!selected}
            onClick={() =>
              selected && onSelect({ customer: selected, ...(location ? { location } : {}) })
            }
            type="button"
          >
            Use customer
          </button>
        </footer>
      </section>
    </div>
  );
}

function DiscountAuthorizationDialog({
  basket,
  customerPartnerId,
  onApproved,
  onClose,
  shiftId,
  token,
}: {
  basket: BasketLine[];
  customerPartnerId?: string;
  onApproved: (discount: ApprovedManualDiscount) => void;
  onClose: () => void;
  shiftId: string;
  token: string;
}) {
  const [approverEmail, setApproverEmail] = useState('manager@vista.local');
  const [approverPassword, setApproverPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [discountType, setDiscountType] = useState<PosDiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('10');
  const [error, setError] = useState<string>();
  const [reason, setReason] = useState('Customer care discount');
  const [totpCode, setTotpCode] = useState('');

  async function approve() {
    setBusy(true);
    setError(undefined);
    try {
      const authorization = await authorizePosDiscount(token, {
        approverEmail,
        approverPassword,
        ...(customerPartnerId ? { customerPartnerId } : {}),
        discountType,
        discountValue: Number(discountValue).toFixed(4),
        lines: saleLinesFor(basket),
        reason,
        shiftId,
        ...(totpCode ? { totpCode } : {}),
      });
      onApproved({ authorization });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const invalid =
    !approverEmail.trim() ||
    !approverPassword ||
    reason.trim().length < 3 ||
    Number(discountValue) <= 0 ||
    (discountType === 'percentage' && Number(discountValue) > 100);

  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="discount-authorization-title"
        aria-modal="true"
        className="pos-dialog pos-commercial-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Protected action</p>
            <h2 id="discount-authorization-title">Approve manual discount</h2>
          </div>
          <button aria-label="Close discount approval" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          <p className="pos-commercial-intro">
            A different employee with discount approval access must confirm this basket.
          </p>
          <div className="pos-discount-value-grid">
            <label>
              <span>Discount type</span>
              <select
                onChange={(event) => setDiscountType(event.target.value as PosDiscountType)}
                value={discountType}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed amount</option>
              </select>
            </label>
            <label>
              <span>{discountType === 'percentage' ? 'Percentage' : 'Amount (BGN)'}</span>
              <input
                max={discountType === 'percentage' ? 100 : undefined}
                min="0.01"
                onChange={(event) => setDiscountValue(event.target.value)}
                step="0.01"
                type="number"
                value={discountValue}
              />
            </label>
          </div>
          <label className="pos-dialog-field">
            <span>Reason</span>
            <input
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <div className="pos-approval-divider">
            <span>Approver</span>
          </div>
          <label className="pos-dialog-field">
            <span>Email</span>
            <input
              autoComplete="username"
              onChange={(event) => setApproverEmail(event.target.value)}
              type="email"
              value={approverEmail}
            />
          </label>
          <label className="pos-dialog-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setApproverPassword(event.target.value)}
              type="password"
              value={approverPassword}
            />
          </label>
          <label className="pos-dialog-field">
            <span>
              Authentication code <small>if enabled</small>
            </span>
            <input
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
              placeholder="6-digit code"
              value={totpCode}
            />
          </label>
          {error ? <p className="pos-dialog-state is-error">{error}</p> : null}
        </div>
        <footer>
          <button className="pos-secondary-button" onClick={onClose} type="button">
            Back
          </button>
          <button
            className="pos-primary-button"
            disabled={invalid || busy}
            onClick={() => void approve()}
            type="button"
          >
            {busy ? 'Approving…' : 'Approve discount'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function LoyaltyDialog({
  customer,
  initialLedger,
  onClose,
  onEnrolled,
  token,
}: {
  customer: PosCustomerOption;
  initialLedger?: PosLoyaltyLedger;
  onClose: () => void;
  onEnrolled: (
    account: NonNullable<PosCustomerOption['loyalty']>,
    ledger: PosLoyaltyLedger,
  ) => void;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ledger, setLedger] = useState(initialLedger);

  useEffect(() => {
    if (!customer.loyalty || initialLedger) return;
    setBusy(true);
    void getPosLoyaltyLedger(token, customer.id)
      .then(setLedger)
      .catch((caught) => setError(messageFor(caught)))
      .finally(() => setBusy(false));
  }, [customer.id, customer.loyalty, initialLedger, token]);

  async function enrol() {
    setBusy(true);
    setError(undefined);
    try {
      const account = await enrolPosLoyalty(token, { customerPartnerId: customer.id });
      const nextLedger = await getPosLoyaltyLedger(token, customer.id);
      setLedger(nextLedger);
      onEnrolled(account, nextLedger);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const account = ledger?.account ?? customer.loyalty;
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="loyalty-dialog-title"
        aria-modal="true"
        className="pos-dialog pos-commercial-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Customer rewards</p>
            <h2 id="loyalty-dialog-title">{customer.name}</h2>
          </div>
          <button aria-label="Close rewards" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          {account ? (
            <>
              <div className="pos-loyalty-balance">
                <span>
                  <PosIcon name="loyalty" />
                </span>
                <div>
                  <small>Available balance</small>
                  <strong>{account.balance} points</strong>
                </div>
                <em>{account.cardNumber}</em>
              </div>
              <div className="pos-loyalty-history">
                <header>
                  <strong>Points history</strong>
                  <span>Running balance</span>
                </header>
                {ledger?.entries.length ? (
                  ledger.entries.map((entry) => (
                    <article key={entry.id}>
                      <div>
                        <strong>{entry.reason}</strong>
                        <small>{dateTime(entry.occurredAt)}</small>
                      </div>
                      <span className={entry.points > 0 ? 'is-credit' : 'is-debit'}>
                        {entry.points > 0 ? '+' : ''}
                        {entry.points}
                        <small>{entry.balanceAfter} balance</small>
                      </span>
                    </article>
                  ))
                ) : (
                  <p>{busy ? 'Loading points…' : 'No points activity yet.'}</p>
                )}
              </div>
            </>
          ) : (
            <div className="pos-loyalty-enrolment">
              <span>
                <PosIcon name="loyalty" />
              </span>
              <h3>Vista Rewards</h3>
              <p>
                Create a card for this customer. Points are earned on completed sales and kept in a
                full transaction history.
              </p>
              <button
                className="pos-primary-button"
                disabled={busy}
                onClick={() => void enrol()}
                type="button"
              >
                {busy ? 'Creating card…' : 'Create loyalty card'}
              </button>
            </div>
          )}
          {error ? <p className="pos-dialog-state is-error">{error}</p> : null}
        </div>
        <footer>
          <button className="pos-secondary-button" onClick={onClose} type="button">
            Back
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReceiptDialog({
  closeLabel = 'Back',
  completed = false,
  onClose,
  onNotice,
  onSaleUpdated,
  sale,
  token,
}: {
  closeLabel?: string;
  completed?: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
  onSaleUpdated: (sale: PosSale) => void;
  sale: PosSale;
  token: string;
}) {
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [downloadingCardId, setDownloadingCardId] = useState<string>();

  async function prepareInvoice() {
    setInvoiceBusy(true);
    try {
      const document = await createPosInvoiceDraft(token, sale.id, crypto.randomUUID());
      onSaleUpdated({
        ...sale,
        invoiceDocument: {
          id: document.id,
          number: document.number,
          sourceFiscalReceiptNumber: document.sourceFiscalReceiptNumber ?? sale.fiscalReceiptNumber,
          status: document.status,
        },
      });
      onNotice({ kind: 'success', text: `${document.number} is ready for Finance review.` });
    } catch (caught) {
      onNotice({ kind: 'error', text: messageFor(caught) });
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function downloadCard(card: PosSale['warrantyCards'][number]) {
    setDownloadingCardId(card.id);
    try {
      const blob = await downloadPosWarrantyCard(token, sale.id, card.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${card.number}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      onNotice({ kind: 'success', text: `${card.number} downloaded.` });
    } catch (caught) {
      onNotice({ kind: 'error', text: messageFor(caught) });
    } finally {
      setDownloadingCardId(undefined);
    }
  }

  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="receipt-title"
        aria-modal="true"
        className="pos-dialog pos-receipt"
        role="dialog"
      >
        <header>
          <div>
            <p>{completed ? 'Sale complete' : 'Receipt details'}</p>
            <h2 id="receipt-title">{sale.fiscalReceiptNumber}</h2>
          </div>
          <span className="pos-receipt-check">✓</span>
        </header>
        <div className="pos-dialog-body">
          <div className="pos-simulator-label">
            Test receipt mode<small>No certified fiscal receipt was issued.</small>
          </div>
          <dl className="pos-receipt-summary">
            <div>
              <dt>Sale</dt>
              <dd>{sale.saleNumber}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(Number(sale.grossTotal))}</dd>
            </div>
            {Number(sale.automaticDiscountTotal) + Number(sale.manualDiscountTotal) > 0 ? (
              <div>
                <dt>Discounts</dt>
                <dd>
                  −{money(Number(sale.automaticDiscountTotal) + Number(sale.manualDiscountTotal))}
                </dd>
              </div>
            ) : null}
            {sale.loyaltyPointsRedeemed > 0 ? (
              <div>
                <dt>Points used</dt>
                <dd>{sale.loyaltyPointsRedeemed}</dd>
              </div>
            ) : null}
            {sale.loyaltyPointsEarned > 0 ? (
              <div>
                <dt>Points earned</dt>
                <dd>+{sale.loyaltyPointsEarned}</dd>
              </div>
            ) : null}
            {sale.payments.map((payment) => (
              <div key={payment.id}>
                <dt>{paymentLabel(payment.method)}</dt>
                <dd>{money(Number(payment.amount))}</dd>
              </div>
            ))}
            {Number(sale.changeAmount) > 0 ? (
              <div className="is-change">
                <dt>Change due</dt>
                <dd>{money(Number(sale.changeAmount))}</dd>
              </div>
            ) : null}
          </dl>
          <section className="pos-receipt-documents" aria-label="Receipt documents">
            <header>
              <div>
                <strong>Invoice</strong>
                <small>Prepared from this receipt with the same customer, VAT, and totals.</small>
              </div>
              {sale.invoiceDocument ? <span className="is-ready">Ready</span> : null}
            </header>
            {sale.invoiceDocument ? (
              <div className="pos-receipt-document-ready">
                <div>
                  <small>Finance document</small>
                  <strong>{sale.invoiceDocument.number}</strong>
                </div>
                <span>Linked to {sale.invoiceDocument.sourceFiscalReceiptNumber}</span>
              </div>
            ) : sale.customerPartnerId ? (
              <button
                className="pos-secondary-button"
                disabled={invoiceBusy}
                onClick={() => void prepareInvoice()}
                type="button"
              >
                {invoiceBusy ? 'Preparing…' : 'Prepare invoice'}
              </button>
            ) : (
              <p className="pos-receipt-document-note">
                Select a customer before completing a sale when an invoice is required.
              </p>
            )}
          </section>
          {sale.warrantyCards.length ? (
            <section className="pos-receipt-documents" aria-label="Warranty cards">
              <header>
                <div>
                  <strong>Warranty cards</strong>
                  <small>One card is generated for each covered serial number.</small>
                </div>
                <span className="is-ready">{sale.warrantyCards.length}</span>
              </header>
              <div className="pos-receipt-warranty-list">
                {sale.warrantyCards.map((card) => (
                  <article key={card.id}>
                    <div>
                      <strong>{card.productName}</strong>
                      <small>
                        {card.serialNumber} · to {shortDate(card.warrantyEndsOn)}
                      </small>
                    </div>
                    <button
                      className="pos-secondary-button"
                      disabled={downloadingCardId === card.id}
                      onClick={() => void downloadCard(card)}
                      type="button"
                    >
                      {downloadingCardId === card.id ? 'Downloading…' : 'Download PDF'}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <footer>
          <button className="pos-primary-button" onClick={onClose} type="button">
            {closeLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ShiftScreen({
  accountId,
  checkoutBlocked,
  context,
  onNavigate,
  onNotice,
  onOpened,
  token,
}: {
  accountId: string;
  checkoutBlocked: boolean;
  context: PosTerminalContext | undefined;
  onNavigate: (screen: PosScreen) => void;
  onNotice: (notice: Notice) => void;
  onOpened: () => Promise<void>;
  token: string;
}) {
  const current = context?.currentShift;
  const [openingCash, setOpeningCash] = useState('100.00');
  const [opening, setOpening] = useState(false);
  const [registerId, setRegisterId] = useState(context?.registers[0]?.id ?? '');
  const [closingCash, setClosingCash] = useState(current?.expectedCashBgn ?? '0.00');
  const [closing, setClosing] = useState(false);

  async function open() {
    if (!registerId || Number(openingCash) < 0) return;
    setOpening(true);
    try {
      await openPosShift(
        token,
        { cashRegisterId: registerId, openingCashBgn: Number(openingCash).toFixed(4) },
        crypto.randomUUID(),
      );
      await onOpened();
      onNotice({ kind: 'success', text: 'Cashier shift opened. The counter is ready.' });
      onNavigate('sell');
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setOpening(false);
    }
  }

  async function close() {
    if (!current || checkoutBlocked || Number(closingCash) < 0) return;
    setClosing(true);
    try {
      if (await readCheckout(accountId))
        throw new Error('Confirm the saved checkout before closing this shift.');
      await closePosShift(
        token,
        current.id,
        { closingCashBgn: Number(closingCash).toFixed(4), version: current.version },
        crypto.randomUUID(),
      );
      await onOpened();
      onNotice({
        kind: 'success',
        text: 'Cashier shift closed and the drawer count was recorded.',
      });
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="pos-register-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Cashier shift</h1>
          <span>Open the assigned counter before taking payments or issuing receipts.</span>
        </div>
        {current ? (
          <button className="pos-primary-button" onClick={() => onNavigate('sell')} type="button">
            Return to sale
          </button>
        ) : null}
      </header>
      {current ? (
        <section className="pos-current-shift">
          <div className="pos-current-shift-status">
            <span />
            <div>
              <small>Open shift</small>
              <strong>{current.shiftNumber}</strong>
            </div>
          </div>
          <dl>
            <div>
              <dt>Register</dt>
              <dd>{current.cashRegisterName}</dd>
            </div>
            <div>
              <dt>Warehouse</dt>
              <dd>{current.warehouseName}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{current.operatorCode}</dd>
            </div>
            <div>
              <dt>Expected cash</dt>
              <dd>{money(Number(current.expectedCashBgn))}</dd>
            </div>
          </dl>
          <div className="pos-close-shift">
            <label>
              <span>Counted cash</span>
              <div>
                <input
                  min="0"
                  onChange={(event) => setClosingCash(event.target.value)}
                  step="0.01"
                  type="number"
                  value={closingCash}
                />
                <span>BGN</span>
              </div>
            </label>
            <div>
              <p>
                Count the drawer before closing. The final Z report will keep this counted amount
                and any difference from expected cash.
              </p>
              <button
                className="pos-secondary-button"
                disabled={closing || checkoutBlocked || Number(closingCash) < 0}
                onClick={() => void close()}
                type="button"
              >
                {closing ? 'Closing shift…' : 'Close cashier shift'}
              </button>
              {checkoutBlocked ? (
                <p>Confirm the saved checkout in Recovery before closing this shift.</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="pos-open-shift-card">
          <div className="pos-open-shift-step">
            <span>1</span>
            <div>
              <h2>Choose register</h2>
              <p>Only counters assigned to your account are available.</p>
            </div>
          </div>
          <div className="pos-register-options">
            {context?.registers.map((register) => (
              <label
                className={registerId === register.id ? 'is-selected' : undefined}
                key={register.id}
              >
                <input
                  checked={registerId === register.id}
                  name="register"
                  onChange={() => setRegisterId(register.id)}
                  type="radio"
                />
                <span>
                  <strong>{register.name}</strong>
                  <small>{register.businessLocationName}</small>
                  <em>{register.warehouseName}</em>
                </span>
                <i>
                  {register.fiscalMode === 'simulator' ? 'Test receipt mode' : register.fiscalMode}
                </i>
              </label>
            ))}
          </div>
          <div className="pos-open-shift-step">
            <span>2</span>
            <div>
              <h2>Count opening cash</h2>
              <p>Enter the cash physically available in the drawer.</p>
            </div>
          </div>
          <label className="pos-opening-cash">
            <span>Opening cash</span>
            <div>
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setOpeningCash(event.target.value)}
                step="0.01"
                type="number"
                value={openingCash}
              />
              <span>BGN</span>
            </div>
          </label>
          <div className="pos-open-shift-actions">
            <p>Test receipt mode is available only on this local installation.</p>
            <button
              className="pos-primary-button"
              disabled={!registerId || opening || Number(openingCash) < 0}
              onClick={() => void open()}
              type="button"
            >
              {opening ? 'Opening shift…' : 'Open cashier shift'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ReturnsScreen({
  onNavigate,
  onNotice,
  onReturned,
  register,
  shift,
  token,
}: {
  onNavigate: (screen: PosScreen) => void;
  onNotice: (notice: Notice) => void;
  onReturned: () => Promise<void>;
  register: PosRegisterOption | undefined;
  shift: PosShift | undefined;
  token: string;
}) {
  const [completed, setCompleted] = useState<PosReturn>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState<PosReturn[]>([]);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [selectedSale, setSelectedSale] = useState<PosSale>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [salePage, returnPage] = await Promise.all([getPosSales(token), getPosReturns(token)]);
      setSales(salePage.items);
      setReturns(returnPage.items);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => void load(), [load]);
  const returnable = sales.filter((sale) =>
    sale.lines.some((line) => Number(line.returnableQuantity) > 0),
  );

  return (
    <div className="pos-register-page pos-returns-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Returns</h1>
          <span>Refund items against their original receipt and choose where the stock goes.</span>
        </div>
        {!shift ? (
          <button className="pos-primary-button" onClick={() => onNavigate('shifts')} type="button">
            Open shift
          </button>
        ) : null}
      </header>
      {loading ? <PageLoading /> : null}
      {error ? <div className="pos-page-error">{error}</div> : null}
      {!loading && !error ? (
        <div className="pos-returns-layout">
          <section className="pos-returnable-sales">
            <header>
              <div>
                <h2>Receipts with returnable items</h2>
                <p>Select the original sale before choosing products.</p>
              </div>
              <span>{returnable.length}</span>
            </header>
            {returnable.length ? (
              <div className="pos-returnable-list">
                {returnable.map((sale) => (
                  <article key={sale.id}>
                    <div className="pos-sale-history-main">
                      <span className="pos-sale-avatar">
                        <PosIcon name="returns" />
                      </span>
                      <div>
                        <strong>{sale.saleNumber}</strong>
                        <small>
                          {sale.customerName ?? 'Counter customer'} · {dateTime(sale.completedAt)}
                        </small>
                      </div>
                    </div>
                    <div>
                      <small>
                        {sale.lines.filter((line) => Number(line.returnableQuantity) > 0).length}{' '}
                        returnable products
                      </small>
                      <strong>{money(Number(sale.grossTotal))}</strong>
                    </div>
                    <button
                      className="pos-secondary-button"
                      disabled={!shift}
                      onClick={() => setSelectedSale(sale)}
                      type="button"
                    >
                      Start return
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <ActionEmpty
                description="New completed sales with returnable items will appear here."
                title="No returnable receipts"
              />
            )}
          </section>
          <section className="pos-recent-returns">
            <header>
              <div>
                <h2>Recent returns</h2>
                <p>Refund and stock-routing records from this cashier account.</p>
              </div>
            </header>
            {returns.length ? (
              <div className="pos-return-history">
                {returns.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.returnNumber}</strong>
                      <small>
                        From {item.originalSaleNumber} · {dateTime(item.completedAt)}
                      </small>
                    </div>
                    <span>
                      {item.lines.map((line) => dispositionLabel(line.disposition)).join(', ')}
                    </span>
                    <strong>{money(Number(item.grossTotal))}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="pos-inline-empty">No returns have been completed.</p>
            )}
          </section>
        </div>
      ) : null}
      {selectedSale && shift ? (
        <ReturnDialog
          onClose={() => setSelectedSale(undefined)}
          onComplete={(result) => {
            setSelectedSale(undefined);
            setCompleted(result);
            onNotice({ kind: 'success', text: `${result.returnNumber} completed successfully.` });
            void onReturned();
            void load();
          }}
          register={register}
          sale={selectedSale}
          shift={shift}
          token={token}
        />
      ) : null}
      {completed ? (
        <ReturnReceiptDialog item={completed} onClose={() => setCompleted(undefined)} />
      ) : null}
    </div>
  );
}

interface ReturnSelection {
  disposition: 'restock' | 'service';
  quantity: number;
  serialNumbers: string[];
}

function ReturnDialog({
  onClose,
  onComplete,
  register,
  sale,
  shift,
  token,
}: {
  onClose: () => void;
  onComplete: (item: PosReturn) => void;
  register: PosRegisterOption | undefined;
  sale: PosSale;
  shift: PosShift;
  token: string;
}) {
  const [error, setError] = useState<string>();
  const [reason, setReason] = useState('Customer returned the item');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Record<string, ReturnSelection>>({});
  const returnableLines = sale.lines.filter((line) => Number(line.returnableQuantity) > 0);
  const total = returnableLines.reduce((sumValue, line) => {
    const selection = selected[line.id];
    if (!selection) return sumValue;
    return sumValue + returnLineGross(line, selection.quantity);
  }, 0);
  const refunds = allocateRefunds(sale, total);
  const selectedLines = returnableLines.filter((line) => selected[line.id]);
  const selectionIssue = (() => {
    if (selectedLines.length === 0) return 'Choose at least one product to return.';
    for (const line of selectedLines) {
      const selection = selected[line.id];
      if (!selection) continue;
      const maximum = Number(line.returnableQuantity);
      if (!Number.isFinite(selection.quantity) || selection.quantity <= 0) {
        return `Enter a valid quantity for ${line.productName}.`;
      }
      if (selection.quantity > maximum) {
        return `Only ${quantity(line.returnableQuantity)} of ${line.productName} can be returned.`;
      }
      if (
        line.serialNumbers.length > 0 &&
        (selection.serialNumbers.length === 0 ||
          selection.quantity !== selection.serialNumbers.length)
      ) {
        return `Choose the serial number for ${line.productName}.`;
      }
    }
    if (reason.trim().length < 3) return 'Enter a short reason for the return.';
    const refundTotal = refunds.reduce((sumValue, refund) => sumValue + refund.amount, 0);
    if (!Number.isFinite(total) || total <= 0 || Math.abs(refundTotal - total) > 0.005) {
      return 'The refund cannot be completed against the original payments.';
    }
    return undefined;
  })();
  const ready = !selectionIssue;

  function toggleLine(line: PosSale['lines'][number], checked: boolean) {
    if (!checked) {
      const next = { ...selected };
      delete next[line.id];
      setSelected(next);
      return;
    }
    const serial = line.returnableSerialNumbers[0];
    setSelected({
      ...selected,
      [line.id]: {
        disposition: 'restock',
        quantity: 1,
        serialNumbers: serial ? [serial] : [],
      },
    });
  }

  async function submit() {
    if (!ready) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await createPosReturn(
        token,
        {
          lines: returnableLines.flatMap((line) => {
            const selection = selected[line.id];
            return selection
              ? [
                  {
                    disposition: selection.disposition,
                    originalSaleLineId: line.id,
                    quantity: selection.quantity.toFixed(4),
                    ...(selection.serialNumbers.length
                      ? { serialNumbers: selection.serialNumbers }
                      : {}),
                  },
                ]
              : [];
          }),
          originalSaleId: sale.id,
          reason: reason.trim(),
          refunds: refunds.map((refund) => ({
            amount: refund.amount.toFixed(4),
            method: refund.method,
            originalPaymentId: refund.originalPaymentId,
          })),
          shiftId: shift.id,
        },
        crypto.randomUUID(),
      );
      onComplete(result);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="return-title"
        aria-modal="true"
        className="pos-dialog pos-return-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Linked return</p>
            <h2 id="return-title">{sale.saleNumber}</h2>
            <small>
              {sale.customerName ?? 'Counter customer'} · {sale.fiscalReceiptNumber}
            </small>
          </div>
          <button aria-label="Close return" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          {error ? <div className="pos-dialog-state is-error">{error}</div> : null}
          <section className="pos-return-step">
            <div className="pos-return-step-heading">
              <span>1</span>
              <div>
                <h3>Choose products</h3>
                <p>Only quantities still available on this receipt are shown.</p>
              </div>
            </div>
            <div className="pos-return-line-list">
              {returnableLines.map((line) => {
                const selection = selected[line.id];
                const serialised = line.serialNumbers.length > 0;
                return (
                  <article className={selection ? 'is-selected' : undefined} key={line.id}>
                    <label className="pos-return-line-check">
                      <input
                        checked={Boolean(selection)}
                        onChange={(event) => toggleLine(line, event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{line.productName}</strong>
                        <small>
                          {line.productCode} · {quantity(line.returnableQuantity)} available
                        </small>
                      </span>
                      <em>{money(returnLineGross(line, Number(line.returnableQuantity)))}</em>
                    </label>
                    {selection ? (
                      <div className="pos-return-line-fields">
                        {serialised ? (
                          <fieldset>
                            <legend>Serial number</legend>
                            {line.returnableSerialNumbers.map((serial) => (
                              <label key={serial}>
                                <input
                                  checked={selection.serialNumbers.includes(serial)}
                                  onChange={(event) => {
                                    const serialNumbers = event.target.checked
                                      ? [...selection.serialNumbers, serial]
                                      : selection.serialNumbers.filter((item) => item !== serial);
                                    setSelected({
                                      ...selected,
                                      [line.id]: {
                                        ...selection,
                                        quantity: serialNumbers.length,
                                        serialNumbers,
                                      },
                                    });
                                  }}
                                  type="checkbox"
                                />
                                <span>{serial}</span>
                              </label>
                            ))}
                          </fieldset>
                        ) : (
                          <label>
                            <span>Quantity</span>
                            <input
                              max={Number(line.returnableQuantity)}
                              min="0.0001"
                              onChange={(event) =>
                                setSelected({
                                  ...selected,
                                  [line.id]: { ...selection, quantity: Number(event.target.value) },
                                })
                              }
                              step="0.0001"
                              type="number"
                              value={selection.quantity}
                            />
                          </label>
                        )}
                        <label>
                          <span>Send item to</span>
                          <select
                            onChange={(event) =>
                              setSelected({
                                ...selected,
                                [line.id]: {
                                  ...selection,
                                  disposition: event.target.value as ReturnSelection['disposition'],
                                },
                              })
                            }
                            value={selection.disposition}
                          >
                            <option value="restock">Return to saleable stock</option>
                            {serialised && register?.serviceReturnWarehouseId ? (
                              <option value="service">Send to Service for inspection</option>
                            ) : null}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
          <section className="pos-return-step">
            <div className="pos-return-step-heading">
              <span>2</span>
              <div>
                <h3>Reason and refund</h3>
                <p>The refund follows the payment methods used on the original receipt.</p>
              </div>
            </div>
            <label className="pos-return-reason">
              <span>Reason for return</span>
              <textarea
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                value={reason}
              />
            </label>
            <div className="pos-refund-summary">
              {refunds.map((refund) => (
                <div key={refund.originalPaymentId}>
                  <span>{paymentLabel(refund.method)} refund</span>
                  <strong>{money(refund.amount)}</strong>
                </div>
              ))}
              <div className="is-total">
                <span>Total refund</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
            <p className={ready ? 'pos-return-guidance is-ready' : 'pos-return-guidance'}>
              {ready ? 'Ready to complete the return.' : selectionIssue}
            </p>
          </section>
        </div>
        <footer>
          <button className="pos-secondary-button" onClick={onClose} type="button">
            Back
          </button>
          <button
            className="pos-primary-button"
            disabled={!ready || saving}
            onClick={() => void submit()}
            type="button"
          >
            {saving ? 'Completing return…' : `Complete return · ${money(total)}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReturnReceiptDialog({ item, onClose }: { item: PosReturn; onClose: () => void }) {
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="return-receipt-title"
        aria-modal="true"
        className="pos-dialog pos-receipt"
        role="dialog"
      >
        <header>
          <div>
            <p>Return complete</p>
            <h2 id="return-receipt-title">{item.returnNumber}</h2>
          </div>
          <span className="pos-receipt-check">✓</span>
        </header>
        <div className="pos-dialog-body">
          <div className="pos-simulator-label">
            Reversal recorded<small>{item.fiscalReversalNumber}</small>
          </div>
          <dl className="pos-receipt-summary">
            <div>
              <dt>Original sale</dt>
              <dd>{item.originalSaleNumber}</dd>
            </div>
            {item.refunds.map((refund) => (
              <div key={refund.id}>
                <dt>{paymentLabel(refund.method)} refund</dt>
                <dd>{money(Number(refund.amount))}</dd>
              </div>
            ))}
            <div className="is-change">
              <dt>Total returned</dt>
              <dd>{money(Number(item.grossTotal))}</dd>
            </div>
          </dl>
        </div>
        <footer>
          <button className="pos-primary-button" onClick={onClose} type="button">
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function SaleHistory({ onNotice, token }: { onNotice: (notice: Notice) => void; token: string }) {
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [selected, setSelected] = useState<PosSale>();

  useEffect(() => {
    void getPosSales(token)
      .then((page) => setSales(page.items))
      .catch((caught) => setError(messageFor(caught)))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="pos-register-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Sale history</h1>
          <span>Receipts, payment methods, and return status for this cashier account.</span>
        </div>
      </header>
      {loading ? <PageLoading /> : null}
      {error ? <div className="pos-page-error">{error}</div> : null}
      {!loading && !error && !sales.length ? (
        <ActionEmpty
          description="Completed counter sales will appear here."
          title="No sales recorded"
        />
      ) : null}
      <div className="pos-sale-history">
        {sales.map((sale) => (
          <article key={sale.id}>
            <div className="pos-sale-history-main">
              <span className="pos-sale-avatar">
                <PosIcon name="sales" />
              </span>
              <div>
                <strong>{sale.saleNumber}</strong>
                <small>
                  {sale.customerName ?? 'Counter customer'} · {dateTime(sale.completedAt)}
                </small>
              </div>
            </div>
            <div className="pos-sale-history-receipt">
              <small>{saleStatusLabel(sale.status)}</small>
              <strong>{sale.fiscalReceiptNumber}</strong>
            </div>
            <div className="pos-sale-history-total">
              <small>
                {sale.payments.map((payment) => paymentLabel(payment.method)).join(' + ')}
              </small>
              <strong>{money(Number(sale.grossTotal))}</strong>
            </div>
            <button
              className="pos-secondary-button pos-sale-history-view"
              onClick={() => setSelected(sale)}
              type="button"
            >
              View receipt
            </button>
          </article>
        ))}
      </div>
      {selected ? (
        <ReceiptDialog
          onClose={() => setSelected(undefined)}
          onNotice={onNotice}
          onSaleUpdated={(updated) => {
            setSelected(updated);
            setSales((current) => current.map((sale) => (sale.id === updated.id ? updated : sale)));
          }}
          sale={selected}
          token={token}
        />
      ) : null}
    </div>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <Toast
      durationMs={notice.kind === 'error' ? 7000 : 4800}
      onDismiss={onClose}
      tone={notice.kind}
    >
      {notice.text}
    </Toast>
  );
}

function ActionEmpty({
  action,
  description,
  onAction,
  title,
}: {
  action?: string;
  description: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <section className="pos-catalog-empty">
      <span className="pos-empty-mark">
        <PosIcon name="scan" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && onAction ? (
        <button className="pos-primary-button" onClick={onAction} type="button">
          {action}
        </button>
      ) : null}
    </section>
  );
}

function CatalogLoading() {
  return (
    <div aria-label="Loading products" className="pos-product-grid is-loading">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function PageLoading() {
  return (
    <div className="pos-page-loading" role="status">
      Loading current information…
    </div>
  );
}

type PosIconName =
  | 'recovery'
  | 'check'
  | 'chevron'
  | 'close'
  | 'customers'
  | 'devices'
  | 'discount'
  | 'loyalty'
  | 'logout'
  | 'reports'
  | 'returns'
  | 'sales'
  | 'scan'
  | 'sell'
  | 'shifts'
  | 'volume'
  | 'volume-off';

function PosIcon({ name }: { name: PosIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="pos-icon"
      fill="none"
      focusable="false"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {posIconPaths[name]}
    </svg>
  );
}

const posIconPaths: Record<PosIconName, ReactNode> = {
  recovery: (
    <>
      <path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  customers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A3.5 3.5 0 0 1 7 15h4a3.5 3.5 0 0 1 3.5 3.5V20M16 5.5a3 3 0 0 1 0 5.8M17 15a3.5 3.5 0 0 1 3.5 3.5V20" />
    </>
  ),
  devices: <path d="M4 5h16v11H4zM8 20h8M12 16v4M7 9h2m2 0h2" />,
  discount: (
    <>
      <path d="M4 7.5 7.5 4H14l6 6-10 10-6-6z" />
      <circle cx="9" cy="9" r="1" />
      <path d="m11 15 4-4" />
    </>
  ),
  loyalty: (
    <>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
      <path d="m9.5 12 1.6 1.6 3.5-3.7" />
    </>
  ),
  logout: <path d="M10 5H5v14h5m4-3 4-4-4-4m4 4H9" />,
  reports: <path d="M5 20V10m5 10V5m5 15v-7m5 7V8M3 20h19" />,
  returns: <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6" />,
  sales: <path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h3" />,
  scan: <path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M8 8v8m3-8v8m3-8v8m3-8v8" />,
  sell: <path d="M4 5h16v14H4zM4 10h16M8 15h4" />,
  shifts: <path d="M5 3v3m14-3v3M4 8h16v12H4zM8 12h3m2 0h3M8 16h3" />,
  volume: <path d="M5 10v4h3l4 3V7L8 10zm10-1.5a5 5 0 0 1 0 7m2-9a8 8 0 0 1 0 11" />,
  'volume-off': <path d="M5 10v4h3l4 3V7L8 10zm4.5 1.5 6 6m0-6-6 6" />,
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (
    (parts.length > 1 ? `${parts[0]?.[0]}${parts.at(-1)?.[0]}` : parts[0]?.slice(0, 2))
      ?.toUpperCase()
      .replace(/[^\p{L}\p{N}]/gu, '') || 'VS'
  );
}

function preferenceKey(accountId: string) {
  return `vista.pos.preferences.${accountId}`;
}

function readSoundPreference(accountId: string) {
  try {
    const stored = window.localStorage.getItem(preferenceKey(accountId));
    if (!stored) return true;
    return (JSON.parse(stored) as { sounds?: boolean }).sounds !== false;
  } catch {
    return true;
  }
}

function writeSoundPreference(accountId: string, sounds: boolean) {
  try {
    window.localStorage.setItem(preferenceKey(accountId), JSON.stringify({ sounds }));
  } catch {
    // The preference remains active for this session when browser storage is unavailable.
  }
}

function playNoticeSound(kind: Notice['kind']) {
  if (kind === 'info') return;
  try {
    const audio = primeNoticeAudio();
    if (!audio) return;
    if (audio.state === 'suspended') {
      void audio
        .resume()
        .then(() => scheduleNoticeNotes(audio, kind))
        .catch(() => undefined);
      return;
    }
    scheduleNoticeNotes(audio, kind);
  } catch {
    // Sound is optional and must never interrupt a sale.
  }
}

let noticeAudioContext: AudioContext | undefined;

function primeNoticeAudio() {
  try {
    if (!noticeAudioContext && window.AudioContext) {
      noticeAudioContext = new window.AudioContext();
    }
    if (noticeAudioContext?.state === 'suspended') {
      void noticeAudioContext.resume().catch(() => undefined);
    }
    return noticeAudioContext;
  } catch {
    return undefined;
  }
}

function scheduleNoticeNotes(audio: AudioContext, kind: Exclude<Notice['kind'], 'info'>) {
  try {
    const notes = kind === 'success' ? [660, 880] : [220, 175];
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + index * 0.095;
      oscillator.type = kind === 'success' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    });
  } catch {
    // Sound is optional and must never interrupt a sale.
  }
}

function screenIcon(screen: PosScreen): PosIconName {
  if (screen === 'checkouts') return 'recovery';
  if (screen === 'reports') return 'reports';
  if (screen === 'returns') return 'returns';
  if (screen === 'sales') return 'sales';
  if (screen === 'sell') return 'sell';
  return 'shifts';
}

function vatRate(item: PosCatalogItem) {
  if (item.vatTreatment === 'reduced_9') return 0.09;
  if (item.vatTreatment === 'standard_20' || item.vatTreatment === 'ica') return 0.2;
  return 0;
}
function withSerial(line: BasketLine, value: string): BasketLine {
  if (value) return { ...line, serialNumber: value };
  const rest: BasketLine = { item: line.item, quantity: line.quantity };
  return line.batchId ? { ...rest, batchId: line.batchId } : rest;
}
function withBatch(line: BasketLine, value: string): BasketLine {
  if (value) return { ...line, batchId: value };
  const rest: BasketLine = { item: line.item, quantity: line.quantity };
  return line.serialNumber ? { ...rest, serialNumber: line.serialNumber } : rest;
}
function grossUnitPrice(item: PosCatalogItem) {
  return Number(item.unitPrice ?? 0) * (1 + vatRate(item));
}
function lineGross(line: BasketLine) {
  return grossUnitPrice(line.item) * line.quantity;
}
function basketTotals(lines: BasketLine[]) {
  const net = lines.reduce(
    (total, line) => total + Number(line.item.unitPrice ?? 0) * line.quantity,
    0,
  );
  const vat = lines.reduce(
    (total, line) => total + Number(line.item.unitPrice ?? 0) * vatRate(line.item) * line.quantity,
    0,
  );
  return { gross: net + vat, net, vat };
}

function saleLinesFor(lines: BasketLine[]) {
  return lines.map((line) => ({
    ...(line.batchId ? { batchId: line.batchId } : {}),
    productId: line.item.id,
    quantity: line.quantity.toFixed(4),
    ...(line.serialNumber ? { serialNumbers: [line.serialNumber] } : {}),
  }));
}

function discountLabel(authorization: PosDiscountAuthorization) {
  return authorization.discountType === 'percentage'
    ? `${Number(authorization.discountValue).toFixed(2)}%`
    : money(Number(authorization.discountValue));
}
function basketIssue(
  lines: BasketLine[],
  customer: CustomerSelection | undefined,
  paymentMode: PaymentMode,
  cashTendered: string,
  splitCash: string,
  gross: number,
  cardAvailable: boolean,
  paymentOptions: PosCustomerPaymentOptions | undefined,
  paymentOptionsLoading: boolean,
  paymentOptionsError: string | undefined,
  selectedAdvance: PosCustomerPaymentOptions['advances'][number] | undefined,
  advancePortion: number,
  customerRemainder: number,
  customerRemainderMethod: CustomerRemainderMethod,
) {
  if (!lines.length) return 'Add at least one product.';
  const serial = lines.find((line) => line.item.trackingMode === 'serial');
  if (serial && !serial.serialNumber) return `Choose the serial number for ${serial.item.name}.`;
  if (serial && (!customer || !customer.location))
    return 'Choose the customer and receiving location for serialised equipment.';
  const batch = lines.find((line) => line.item.trackingMode === 'batch' && !line.batchId);
  if (batch) return `Choose the batch for ${batch.item.name}.`;
  const needsCard =
    paymentMode === 'card' ||
    paymentMode === 'split' ||
    (paymentMode === 'customer' && customerRemainder > 0 && customerRemainderMethod === 'card');
  if (needsCard && !cardAvailable) return 'Card payment is not available on this register.';
  if (
    paymentMode === 'split' &&
    (!splitCash || Number(splitCash) <= 0 || Number(splitCash) >= gross)
  )
    return 'Enter a cash portion smaller than the total.';
  if (paymentMode === 'customer') {
    if (!customer) return 'Choose a customer for an advance or on-account payment.';
    if (paymentOptionsLoading) return 'Checking the customer account…';
    if (paymentOptionsError) return paymentOptionsError;
    if (!paymentOptions) return 'The customer account is unavailable.';
    if (!Number.isFinite(advancePortion)) return 'Enter a valid advance amount.';
    if (advancePortion > 0 && !selectedAdvance) return 'Choose the advance to use.';
    if (advancePortion > Number(selectedAdvance?.availableAmount ?? 0))
      return 'The amount is higher than the available advance.';
    if (
      customerRemainder > 0 &&
      customerRemainderMethod === 'on_account' &&
      (!paymentOptions.onAccountAvailable ||
        customerRemainder > Number(paymentOptions.availableCredit))
    )
      return 'This customer does not have enough approved credit.';
  }
  const cashDue =
    paymentMode === 'cash'
      ? gross
      : paymentMode === 'split'
        ? Number(splitCash)
        : paymentMode === 'customer' && customerRemainderMethod === 'cash'
          ? customerRemainder
          : 0;
  if (cashDue > 0 && (!cashTendered || Number(cashTendered) < cashDue))
    return `Enter at least ${money(cashDue)} in cash.`;
  return undefined;
}
function paymentLabel(method: PaymentMode | PosPaymentMethod) {
  if (method === 'cash') return 'Cash';
  if (method === 'card') return 'Bank card';
  if (method === 'advance') return 'Customer advance';
  if (method === 'on_account') return 'On account';
  if (method === 'customer') return 'Advance / account';
  return 'Split';
}
function saleStatusLabel(status: PosSale['status']) {
  if (status === 'returned') return 'Fully returned';
  if (status === 'partially_returned') return 'Partially returned';
  return 'Completed receipt';
}
function dispositionLabel(disposition: PosReturn['lines'][number]['disposition']) {
  return disposition === 'service' ? 'Sent to Service' : 'Restocked';
}
function allocateRefunds(sale: PosSale, total: number) {
  let unallocated = Math.round(total * 10000) / 10000;
  const refunds: Array<{
    amount: number;
    method: PosPaymentMethod;
    originalPaymentId: string;
  }> = [];
  for (const payment of sale.payments) {
    const available = Number(payment.refundableAmount);
    const amount = Math.min(available, unallocated);
    if (amount > 0) refunds.push({ amount, method: payment.method, originalPaymentId: payment.id });
    unallocated = Math.round((unallocated - amount) * 10000) / 10000;
  }
  return unallocated <= 0.00005 ? refunds : [];
}
function money(value: number) {
  return `${value.toLocaleString('en-BG', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} BGN`;
}
function quantity(value: string) {
  return Number(value).toLocaleString('en-BG', { maximumFractionDigits: 4 });
}
function trackingLabel(item: PosCatalogItem) {
  return item.trackingMode === 'serial'
    ? 'Serial tracked'
    : item.trackingMode === 'batch'
      ? 'Batch tracked'
      : 'Standard item';
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}
function messageFor(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return 'The POS service is unavailable. Check the connection and try again.';
}
