import React, { useState, useMemo, useRef, useEffect } from 'react';
import logoImg from '../assets/logo.jpg';
import {
  IconScan, IconPos, IconReceipt, IconCash, IconQr, IconSplit,
  IconPrinter, IconTrash, IconBarcode, IconPlus, IconCheck, IconHanger, IconInfo,
} from './Icons';
import { normalizeScannedCode, isValidEan13, playScanOk, playScanError, playCashRegister } from '../utils/barcode';
import { printThermalReceipt, PAYMENT_LABELS, resolveBarcodeValue } from '../utils/print';

const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';
const todayISO = () => new Date().toISOString().slice(0, 10);

const PAY_METHODS = [
  { id: 'cash', Icon: IconCash, label: 'Наличные' },
  { id: 'qr', Icon: IconQr, label: 'QR / Перевод' },
  { id: 'card', Icon: IconPos, label: 'Карта' },
  { id: 'mixed', Icon: IconSplit, label: 'Смешанная' },
];

export default function PosTerminal({
  products,
  sales,
  categories,
  storeSettings,
  api,
  refresh,
  notify,
  pendingScan,
  clearPendingScan,
  onCreateWithBarcode,
  onPrintLabel,
}) {
  const [scanInput, setScanInput] = useState('');
  const [activeCat, setActiveCat] = useState('Все');
  const [cart, setCart] = useState([]);
  const [spotlight, setSpotlight] = useState(null);
  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [note, setNote] = useState('');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [subTab, setSubTab] = useState('pos');
  const [lastScannedCode, setLastScannedCode] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [openDiscRowId, setOpenDiscRowId] = useState(null);
  const [showReceiptDisc, setShowReceiptDisc] = useState(false);
  const [showExtraMeta, setShowExtraMeta] = useState(false);

  const scanRef = useRef(null);
  const spotlightRef = useRef(null);
  const autoScanTimerRef = useRef(null);
  const soundOn = storeSettings?.sound_enabled !== false;

  useEffect(() => {
    return () => {
      if (autoScanTimerRef.current) clearTimeout(autoScanTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (spotlight?.ts && spotlightRef.current) {
      spotlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [spotlight?.ts]);

  const addToCart = (product, viaScanner = false) => {
    setErr('');
    if (!product) return;
    const bc = resolveBarcodeValue(product);
    if ((product.quantity || 0) <= 0) {
      playScanError(soundOn);
      setSpotlight({ product, status: 'out', code: bc, ts: Date.now() });
      setErr(`«${product.name}» закончился на складе (0 шт)`);
      return;
    }

    let exceeded = false;
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.product.id === product.id);
      if (idx >= 0) {
        const cur = prev[idx];
        if (cur.quantity + 1 > product.quantity) {
          exceeded = true;
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...cur, product, quantity: cur.quantity + 1 };
        return next;
      }
      return [{ product, quantity: 1, unit_price: product.sale_price, discount: 0 }, ...prev];
    });

    if (exceeded) {
      playScanError(soundOn);
      setSpotlight({ product, status: 'limit', code: bc, ts: Date.now() });
      setErr(`Максимум в наличии для «${product.name}»: ${product.quantity} шт`);
    } else {
      playScanOk(soundOn);
      setSpotlight({ product, status: 'added', code: bc, ts: Date.now(), viaScanner });
    }
  };

  const findLocalProductByCode = (clean) => {
    const lc = clean.toLowerCase();
    const digits = clean.replace(/\D/g, '');
    const digitVariants = new Set([lc]);
    if (digits) {
      digitVariants.add(digits);
      if (digits.length === 12) digitVariants.add('0' + digits);
      if (digits.length === 13 && digits.startsWith('0')) digitVariants.add(digits.slice(1));
    }
    return (
      products.find((p) => digitVariants.has(resolveBarcodeValue(p).toLowerCase())) ||
      products.find((p) => digitVariants.has((p.barcode || '').trim().toLowerCase())) ||
      products.find((p) => digitVariants.has((p.code || '').trim().toLowerCase())) ||
      null
    );
  };

  const handleBarcodeLookup = async (rawCode) => {
    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }
    const clean = normalizeScannedCode(rawCode).replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (!clean) return;
    setLastScannedCode(clean);

    const localMatch = findLocalProductByCode(clean);

    if (localMatch) {
      addToCart(localMatch, true);
      setScanInput('');
      return;
    }

    try {
      const res = await api(`/api/products/lookup?code=${encodeURIComponent(clean)}`);
      if (res?.product) {
        addToCart(res.product, true);
        setScanInput('');
        return;
      }
    } catch {
      // не найден
    }

    playScanError(soundOn);
    setSpotlight({ product: null, status: 'notfound', code: clean, ts: Date.now() });
    setErr(`Товар со штрихкодом «${clean}» не найден в базе`);
    setScanInput('');
  };

  useEffect(() => {
    if (pendingScan?.code) {
      handleBarcodeLookup(pendingScan.code);
      clearPendingScan?.();
    }
  }, [pendingScan]);

  useEffect(() => {
    setCart((prev) =>
      prev
        .map((it) => {
          const fresh = products.find((p) => p.id === it.product.id);
          return fresh ? { ...it, product: fresh } : it;
        })
        .filter(Boolean)
    );
  }, [products]);

  const updateCartQty = (pid, delta) => {
    setErr('');
    setCart((prev) =>
      prev
        .map((it) => {
          if (it.product.id !== pid) return it;
          const nextQ = it.quantity + delta;
          if (nextQ <= 0) return null;
          if (nextQ > (it.product.quantity || 0)) {
            setErr(`На складе «${it.product.name}» только ${it.product.quantity} шт`);
            return it;
          }
          const maxLine = nextQ * Number(it.unit_price || 0);
          return { ...it, quantity: nextQ, discount: Math.min(maxLine, Number(it.discount || 0)) };
        })
        .filter(Boolean)
    );
  };

  const updateCartDiscount = (pid, rawVal) => {
    setErr('');
    const parsed = rawVal === '' ? 0 : Math.max(0, Number(rawVal) || 0);
    setCart((prev) =>
      prev.map((it) => {
        if (it.product.id !== pid) return it;
        const maxLine = it.quantity * Number(it.unit_price || 0);
        return { ...it, discount: Math.min(maxLine, Math.round(parsed)) };
      })
    );
  };

  const setCartItemPercentDiscount = (pid, pct) => {
    setCart((prev) =>
      prev.map((it) => {
        if (it.product.id !== pid) return it;
        const maxLine = it.quantity * Number(it.unit_price || 0);
        return { ...it, discount: Math.min(maxLine, Math.round((maxLine * pct) / 100)) };
      })
    );
  };

  const removeFromCart = (pid) => {
    setCart((prev) => prev.filter((it) => it.product.id !== pid));
  };

  const subtotal = useMemo(
    () => cart.reduce((acc, it) => acc + it.quantity * Number(it.unit_price || 0), 0),
    [cart]
  );

  const itemDiscountTotal = useMemo(
    () =>
      cart.reduce((acc, it) => {
        const lineGross = it.quantity * Number(it.unit_price || 0);
        return acc + Math.min(lineGross, Math.max(0, Number(it.discount || 0)));
      }, 0),
    [cart]
  );

  const afterItemDiscounts = Math.max(0, subtotal - itemDiscountTotal);

  const receiptDiscountAmount = useMemo(() => {
    const val = Math.max(0, Number(discountValue) || 0);
    if (discountType === 'percent') return Math.round((afterItemDiscounts * Math.min(100, val)) / 100);
    if (discountType === 'amount') return Math.min(afterItemDiscounts, Math.round(val));
    return 0;
  }, [afterItemDiscounts, discountType, discountValue]);

  const discountAmount = itemDiscountTotal + receiptDiscountAmount;
  const finalTotal = Math.max(0, subtotal - discountAmount);
  const spotlightCartItem = spotlight?.product
    ? cart.find((x) => x.product.id === spotlight.product.id) || null
    : null;
  const cashNum = Number(cashReceived) || 0;
  const changeAmount = paymentMethod === 'cash' && cashNum > 0 ? Math.max(0, cashNum - finalTotal) : 0;
  const mixedCashNum = Math.min(finalTotal, Math.max(0, Number(cashPart) || 0));
  const mixedCardNum = Math.max(0, finalTotal - mixedCashNum);

  const filteredProducts = useMemo(() => {
    const q = scanInput.trim().toLowerCase();
    const qNorm = normalizeScannedCode(scanInput).toLowerCase();
    return products.filter((p) => {
      if (onlyInStock && !q && (p.quantity || 0) <= 0) return false;
      if (activeCat !== 'Все' && p.category !== activeCat) return false;
      if (!q) return true;
      const bc = resolveBarcodeValue(p).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(qNorm) ||
        bc.includes(q) ||
        bc.includes(qNorm)
      );
    });
  }, [products, activeCat, scanInput, onlyInStock]);

  const submitCheckout = async () => {
    if (!cart.length) {
      setErr('Отсканируйте или выберите хотя бы один товар');
      return;
    }
    if (paymentMethod === 'cash' && cashReceived !== '' && cashNum < finalTotal) {
      setErr(`Недостаточно наличных — нужно ещё ${money(finalTotal - cashNum)}`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const payload = {
        items: cart.map((it) => ({
          product_id: it.product.id,
          quantity: it.quantity,
          unit_price: Number(it.unit_price),
          discount: Math.max(0, Number(it.discount || 0)),
        })),
        payment_method: paymentMethod,
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        cash_received: paymentMethod === 'cash' ? (cashNum || finalTotal) : 0,
        cash_part: paymentMethod === 'mixed' ? mixedCashNum : 0,
        card_part: paymentMethod === 'mixed' ? mixedCardNum : 0,
        note: note.trim(),
        date: saleDate,
      };
      const res = await api('/api/checkout', { method: 'POST', body: payload });
      playCashRegister(soundOn);
      setCompletedReceipt(res.receipt);
      setCart([]);
      setDiscountType('none');
      setDiscountValue('');
      setCashReceived('');
      setCashPart('');
      setNote('');
      await refresh();
      notify?.(`Оплата принята · ${money(res.receipt.total)}`);
      if (storeSettings?.auto_print_receipt) {
        printThermalReceipt(res.receipt, storeSettings);
      }
    } catch (e) {
      playScanError(soundOn);
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const receiptsHistory = useMemo(() => {
    const groups = new Map();
    for (const s of sales) {
      const key = s.receipt_no || `single-${s.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          receipt_no: s.receipt_no || `#${s.id}`,
          hasReceiptNo: Boolean(s.receipt_no),
          sale_date: s.sale_date,
          created_at: s.created_at,
          payment_method: s.payment_method || 'cash',
          cash_received: Number(s.cash_received || 0),
          change_amount: Number(s.change_amount || 0),
          cash_part: Number(s.cash_part || 0),
          card_part: Number(s.card_part || 0),
          note: s.note || '',
          items: [],
          subtotal: 0,
          discount: 0,
          total: 0,
          profit: 0,
          saleIds: [],
        });
      }
      const g = groups.get(key);
      const gross = (s.quantity || 0) * (s.unit_price || 0);
      const disc = Number(s.discount || 0);
      const lineTotal = Math.max(0, gross - disc);
      const lineProfit = lineTotal - (s.quantity || 0) * (s.unit_cost || 0);
      g.items.push({
        id: s.id,
        name: s.product_name,
        quantity: s.quantity,
        unit_price: s.unit_price,
        discount: disc,
        line_total: lineTotal,
      });
      g.subtotal += gross;
      g.discount += disc;
      g.total += lineTotal;
      g.profit += lineProfit;
      g.saleIds.push(s.id);
    }
    return Array.from(groups.values());
  }, [sales]);

  const cancelReceipt = async (r) => {
    if (!window.confirm(`Отменить чек ${r.receipt_no}? Все товары вернутся на склад.`)) return;
    try {
      if (r.hasReceiptNo) {
        await api(`/api/receipts/${encodeURIComponent(r.receipt_no)}`, { method: 'DELETE' });
      } else {
        await api(`/api/sales/${r.saleIds[0]}`, { method: 'DELETE' });
      }
      await refresh();
      notify?.('Чек отменён, товары возвращены на склад');
    } catch (e) {
      notify?.(e.message);
    }
  };

  const quickBills = useMemo(() => {
    if (!finalTotal) return [500, 1000, 2000, 5000];
    const set = new Set([finalTotal]);
    const rounded500 = Math.ceil(finalTotal / 500) * 500;
    const rounded1000 = Math.ceil(finalTotal / 1000) * 1000;
    set.add(rounded500);
    set.add(rounded1000);
    if (rounded1000 < 5000) set.add(5000);
    if (finalTotal >= 5000) set.add(Math.ceil(finalTotal / 5000) * 5000);
    return Array.from(set).sort((a, b) => a - b).slice(0, 4);
  }, [finalTotal]);

  return (
    <section className="tab active pos-root">
      <div className="pos-subbar">
        <div className="pos-switch">
          <button className={subTab === 'pos' ? 'active' : ''} onClick={() => setSubTab('pos')}>
            <IconPos size={15} /> Касса
          </button>
          <button className={subTab === 'history' ? 'active' : ''} onClick={() => setSubTab('history')}>
            <IconReceipt size={15} /> История чеков ({receiptsHistory.length})
          </button>
        </div>

        <div className="scanner-status-pill">
          <span className="pulse-dot" />
          <span>Сканер HID готов к работе</span>
          {lastScannedCode && (
            <span className="last-scan-chip mono" title="Последний полученный от сканера код">
              Код: {lastScannedCode}
            </span>
          )}
          <button type="button" className="help-link" onClick={() => setShowGuide((v) => !v)}>
            <IconInfo size={13} /> Подключение
          </button>
        </div>
      </div>

      {showGuide && (
        <div className="panel guide-panel">
          <div className="guide-head">
            <h3>Подключение беспроводного сканера и Xprinter</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowGuide(false)}>Скрыть</button>
          </div>
          <div className="guide-steps">
            <div className="g-step">
              <div className="g-num">01</div>
              <b>Подключите USB-адаптер сканера</b>
              <p>Вставьте 2.4GHz USB-донгл сканера в ноутбук и нажмите курок. Драйверы не требуются — Windows распознаёт сканер как клавиатуру. Для проверки откройте Блокнот и просканируйте любой штрихкод: появятся цифры и перенос строки.</p>
            </div>
            <div className="g-step">
              <div className="g-num">02</div>
              <b>Распечатайте этикетки на Xprinter</b>
              <p>В разделе <b>«Товары и бирки»</b> у каждой вещи есть свой штрихкод <b>EAN-13</b>. Нажмите иконку штрихкода, выберите размер ленты <b>58×40 мм</b> и отправьте на печать — наклейте бирку на одежду.</p>
            </div>
            <div className="g-step">
              <div className="g-num">03</div>
              <b>Сканируйте и принимайте оплату</b>
              <p>На этой странице просто наведите сканер на бирку — курсор ставить в поле не нужно. Товар сразу покажется на экране и добавится в чек, даже если в Windows включена русская раскладка.</p>
            </div>
          </div>
        </div>
      )}

      {subTab === 'pos' ? (
        <div className="pos-layout">
          <div className="pos-left">
            <div className="panel scan-box">
              <div className="scan-toolbar">
                <div className="scan-input-wrap">
                  <span className="scan-ic"><IconScan size={18} /></span>
                  <input
                    ref={scanRef}
                    data-scanner-input="true"
                    value={scanInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScanInput(val);
                      if (autoScanTimerRef.current) clearTimeout(autoScanTimerRef.current);
                      const norm = normalizeScannedCode(val).replace(/[\x00-\x1F\x7F]/g, '').trim();
                      if (norm.length >= 6 && (isValidEan13(norm) || Boolean(findLocalProductByCode(norm)))) {
                        autoScanTimerRef.current = setTimeout(() => {
                          handleBarcodeLookup(norm);
                        }, 160);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        const liveVal = (e.currentTarget.value || '').trim();
                        if (liveVal) {
                          e.preventDefault();
                          handleBarcodeLookup(liveVal);
                        }
                      }
                    }}
                    placeholder="Сканируйте штрихкод или введите название / артикул…"
                  />
                  {scanInput && (
                    <button type="button" className="scan-clear" onClick={() => setScanInput('')}>×</button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleBarcodeLookup(scanInput)}
                    disabled={!scanInput.trim()}
                  >
                    Найти
                  </button>
                </div>

                <select
                  className="cat-select"
                  value={activeCat}
                  onChange={(e) => setActiveCat(e.target.value)}
                  aria-label="Фильтр по категории"
                >
                  <option value="Все">Все категории ({products.length})</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="scan-hint">
                Наведите сканер на этикетку и нажмите кнопку — товар сразу добавится в чек без клика по полю.
              </div>
            </div>

            {spotlight && (
              <div ref={spotlightRef} className={'panel spotlight-card ' + spotlight.status}>
                {spotlight.product ? (
                  <div className="spot-in">
                    <div className="spot-photo">
                      {spotlight.product.photos?.length ? (
                        <img src={spotlight.product.photos[0].url} alt={spotlight.product.name} />
                      ) : (
                        <IconHanger size={24} />
                      )}
                    </div>
                    <div className="spot-info">
                      <div className="spot-tag">
                        {spotlight.status === 'added' && 'Отсканировано — добавлено в чек'}
                        {spotlight.status === 'out' && 'Нет в наличии на складе'}
                        {spotlight.status === 'limit' && 'Достигнут лимит остатка на складе'}
                      </div>
                      <div className="spot-name">{spotlight.product.name}</div>
                      <div className="spot-meta">
                        <span className="pill cat">{spotlight.product.category}</span>
                        <span className="code mono">{resolveBarcodeValue(spotlight.product)}</span>
                        {spotlight.product.code && <span className="code">{spotlight.product.code}</span>}
                        <span className="spot-stock">Остаток: <b>{spotlight.product.quantity} шт</b></span>
                      </div>
                    </div>
                    <div className="spot-right">
                      {spotlightCartItem && Number(spotlightCartItem.discount || 0) > 0 ? (
                        <div className="spot-price-stack num">
                          <span className="spot-price-old">{money(spotlightCartItem.quantity * Number(spotlightCartItem.unit_price || 0))}</span>
                          <span className="spot-price">{money(Math.max(0, spotlightCartItem.quantity * Number(spotlightCartItem.unit_price || 0) - Number(spotlightCartItem.discount || 0)))}</span>
                        </div>
                      ) : (
                        <div className="spot-price num">{money(spotlight.product.sale_price)}</div>
                      )}
                      <div className="act">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onPrintLabel?.([spotlight.product])}
                          title="Распечатать этикетку на Xprinter"
                        >
                          <IconBarcode size={14} /> Бирка
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => addToCart(spotlight.product, false)}
                          disabled={(spotlight.product.quantity || 0) <= 0}
                        >
                          <IconPlus size={14} /> Ещё 1
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="spot-notfound">
                    <div>
                      <b>Штрихкод «{spotlight.code}» не найден в базе</b>
                      <p>Создайте карточку товара — этот штрихкод сразу прикрепится к нему.</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onCreateWithBarcode?.(spotlight.code)}
                    >
                      <IconPlus size={14} /> Создать товар
                    </button>
                  </div>
                )}

                {spotlight.product && spotlightCartItem && (
                  <div className="spot-disc-bar">
                    <div className="spot-disc-label">
                      <span>Скидка на этот товар:</span>
                      <div className="spot-disc-input-wrap">
                        <input
                          type="number"
                          min="0"
                          max={spotlightCartItem.quantity * Number(spotlightCartItem.unit_price || 0)}
                          data-testid="spot-discount-input"
                          value={spotlightCartItem.discount || ''}
                          onChange={(e) => updateCartDiscount(spotlightCartItem.product.id, e.target.value)}
                          placeholder="0"
                        />
                        <span>сом</span>
                      </div>
                    </div>
                    <div className="spot-disc-chips">
                      {[100, 200, 300, 500].map((amt) => (
                        <button
                          type="button"
                          key={amt}
                          className={'disc-chip' + (Number(spotlightCartItem.discount || 0) === amt ? ' active' : '')}
                          onClick={() => updateCartDiscount(spotlightCartItem.product.id, amt)}
                        >
                          −{amt}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="disc-chip"
                        onClick={() => setCartItemPercentDiscount(spotlightCartItem.product.id, 10)}
                      >
                        −10%
                      </button>
                      {Number(spotlightCartItem.discount || 0) > 0 && (
                        <button
                          type="button"
                          className="disc-chip reset"
                          onClick={() => updateCartDiscount(spotlightCartItem.product.id, 0)}
                        >
                          Сброс
                        </button>
                      )}
                    </div>
                    {Number(spotlightCartItem.discount || 0) > 0 && (
                      <div className="spot-disc-calc num">
                        {money(spotlightCartItem.quantity * Number(spotlightCartItem.unit_price || 0))} − {money(spotlightCartItem.discount)} ={' '}
                        <b>{money(Math.max(0, spotlightCartItem.quantity * Number(spotlightCartItem.unit_price || 0) - Number(spotlightCartItem.discount || 0)))}</b>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="panel pos-catalog-panel">
              <div className="pos-grid-head">
                <span className="pos-grid-title">
                  <b>Быстрый выбор товара</b>
                  <small>{filteredProducts.length} шт</small>
                </span>
                <label className="chk pos-stock-chk">
                  <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
                  <span>Только в наличии</span>
                </label>
              </div>
              <div className="pos-grid">
                {filteredProducts.slice(0, 60).map((p) => {
                  const inCart = cart.find((x) => x.product.id === p.id)?.quantity || 0;
                  const out = (p.quantity || 0) <= 0;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={'pos-tile' + (out ? ' out' : '') + (inCart ? ' in-cart' : '')}
                      onClick={() => addToCart(p, false)}
                    >
                      <div className="pt-img">
                        {p.photos?.length ? (
                          <img src={p.photos[0].url} alt={p.name} />
                        ) : (
                          <IconHanger size={22} />
                        )}
                        {inCart > 0 && <span className="pt-in-badge">В чеке: {inCart}</span>}
                        <span className={'pt-qty ' + (out ? 'out' : p.quantity <= 3 ? 'low' : '')}>
                          {out ? 'Нет' : `${p.quantity} шт`}
                        </span>
                      </div>
                      <div className="pt-body">
                        <div className="pt-cat">{p.category}</div>
                        <div className="pt-name">{p.name}</div>
                        <div className="pt-foot">
                          <b className="num">{money(p.sale_price)}</b>
                          <span className="pt-add-hint">+ В чек</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {!filteredProducts.length && (
                  <div className="pos-empty-grid">Ничего не найдено — измените запрос или отсканируйте этикетку</div>
                )}
              </div>
            </div>
          </div>

          <div className="pos-right">
            <div className="panel checkout-panel">
              <div className="chk-head">
                <div>
                  <h3>Текущий чек</h3>
                  <p className="sub">
                    {cart.length
                      ? `${cart.reduce((a, b) => a + b.quantity, 0)} шт · ${cart.length} поз.`
                      : 'Отсканируйте бирку или нажмите на товар слева'}
                  </p>
                </div>
                {cart.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => { setCart([]); setErr(''); setOpenDiscRowId(null); }}
                  >
                    Очистить
                  </button>
                )}
              </div>

              <div className="cart-list">
                {!cart.length ? (
                  <div className="cart-empty">
                    <div className="ce-ic"><IconScan size={28} /></div>
                    <div>Чек пуст</div>
                    <small>Наведите сканер на штрихкод — товар появится здесь автоматически</small>
                  </div>
                ) : (
                  cart.map((it) => {
                    const lineGross = it.quantity * Number(it.unit_price || 0);
                    const lineDisc = Math.min(lineGross, Math.max(0, Number(it.discount || 0)));
                    const lineNet = Math.max(0, lineGross - lineDisc);
                    const isDiscOpen = openDiscRowId === it.product.id;
                    return (
                      <div className={'cart-row' + (lineDisc > 0 ? ' discounted' : '')} key={it.product.id}>
                        <div className="cr-top">
                          <div className="cr-info">
                            <div className="cr-name">{it.product.name}</div>
                            <div className="cr-sub num">
                              <span>{money(it.unit_price)} / шт</span>
                              {lineDisc > 0 && <span className="cr-disc-pill">−{money(lineDisc)}</span>}
                            </div>
                          </div>
                          <div className="cr-qty">
                            <button type="button" onClick={() => updateCartQty(it.product.id, -1)}>−</button>
                            <span className="num">{it.quantity}</span>
                            <button type="button" onClick={() => updateCartQty(it.product.id, 1)}>+</button>
                          </div>
                          <div className="cr-sum num">
                            {lineDisc > 0 && <span className="cr-sum-old">{money(lineGross)}</span>}
                            <span>{money(lineNet)}</span>
                          </div>
                          <button
                            type="button"
                            className={'cr-disc-toggle' + (isDiscOpen || lineDisc > 0 ? ' active' : '')}
                            onClick={() => setOpenDiscRowId(isDiscOpen ? null : it.product.id)}
                            title="Указать скидку на этот товар"
                          >
                            %
                          </button>
                          <button
                            type="button"
                            className="cr-del"
                            onClick={() => removeFromCart(it.product.id)}
                            title="Убрать"
                          >
                            ×
                          </button>
                        </div>
                        {isDiscOpen && (
                          <div className="cr-disc-row">
                            <span className="cr-disc-lbl">Скидка:</span>
                            <div className="cr-disc-inp">
                              <input
                                type="number"
                                min="0"
                                max={lineGross}
                                value={lineDisc || ''}
                                onChange={(e) => updateCartDiscount(it.product.id, e.target.value)}
                                placeholder="0"
                                aria-label={`Скидка на ${it.product.name} в сомах`}
                              />
                              <span>сом</span>
                            </div>
                            <div className="cr-disc-quick">
                              {[100, 200, 500].map((amt) => (
                                <button
                                  type="button"
                                  key={amt}
                                  className={lineDisc === amt ? 'active' : ''}
                                  onClick={() => updateCartDiscount(it.product.id, amt)}
                                >
                                  −{amt}
                                </button>
                              ))}
                              {lineDisc > 0 && (
                                <button
                                  type="button"
                                  className="clear"
                                  title="Убрать скидку"
                                  onClick={() => updateCartDiscount(it.product.id, 0)}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="chk-extras-bar">
                <button
                  type="button"
                  className={'chk-extra-chip' + (showReceiptDisc || discountType !== 'none' ? ' active' : '')}
                  onClick={() => setShowReceiptDisc((v) => !v)}
                >
                  {receiptDiscountAmount > 0 ? `Скидка на чек: −${money(receiptDiscountAmount)}` : '+ Скидка на весь чек'}
                </button>
                <button
                  type="button"
                  className={'chk-extra-chip' + (showExtraMeta || note.trim() || saleDate !== todayISO() ? ' active' : '')}
                  onClick={() => setShowExtraMeta((v) => !v)}
                >
                  {note.trim() ? `Заметка: ${note.trim().slice(0, 14)}…` : 'Дата / заметка'}
                </button>
              </div>

              {(showReceiptDisc || discountType !== 'none') && (
                <div className="discount-bar">
                  <span>Скидка на чек</span>
                  <div className="disc-pills">
                    <button
                      type="button"
                      className={discountType === 'none' ? 'active' : ''}
                      onClick={() => { setDiscountType('none'); setDiscountValue(''); }}
                    >Нет</button>
                    <button
                      type="button"
                      className={discountType === 'percent' ? 'active' : ''}
                      onClick={() => setDiscountType('percent')}
                    >%</button>
                    <button
                      type="button"
                      className={discountType === 'amount' ? 'active' : ''}
                      onClick={() => setDiscountType('amount')}
                    >сом</button>
                  </div>
                  {discountType !== 'none' && (
                    <input
                      type="number"
                      min="0"
                      max={discountType === 'percent' ? 100 : afterItemDiscounts}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      placeholder={discountType === 'percent' ? '10' : 'Сумма'}
                    />
                  )}
                </div>
              )}

              {showExtraMeta && (
                <div className="form-row" style={{ marginBottom: 12 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Дата чека</label>
                    <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Примечание</label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Клиент / заметка" />
                  </div>
                </div>
              )}

              <div className="totals-box">
                {discountAmount > 0 && (
                  <>
                    <div className="tot-row"><span>Сумма без скидки</span><span className="num">{money(subtotal)}</span></div>
                    {itemDiscountTotal > 0 && (
                      <div className="tot-row disc"><span>Скидка на товары</span><span className="num">−{money(itemDiscountTotal)}</span></div>
                    )}
                    {receiptDiscountAmount > 0 && (
                      <div className="tot-row disc"><span>Скидка на чек</span><span className="num">−{money(receiptDiscountAmount)}</span></div>
                    )}
                  </>
                )}
                <div className="tot-row grand">
                  <span>К оплате</span>
                  <b className="num">{money(finalTotal)}</b>
                </div>
              </div>

              <div className="pay-label">Способ оплаты</div>
              <div className="pay-methods">
                {PAY_METHODS.map(({ id, Icon, label }) => (
                  <button
                    type="button"
                    key={id}
                    className={'pay-btn' + (paymentMethod === id ? ' active' : '')}
                    onClick={() => setPaymentMethod(id)}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {paymentMethod === 'cash' && (
                <div className="pay-details">
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>Получено наличными (сом)</label>
                    <input
                      type="number"
                      min="0"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={finalTotal ? String(finalTotal) : '0'}
                    />
                  </div>
                  <div className="quick-bills">
                    {quickBills.map((b) => (
                      <button
                        type="button"
                        key={b}
                        className="bill-chip"
                        onClick={() => setCashReceived(String(b))}
                      >
                        {b === finalTotal ? 'Без сдачи' : money(b)}
                      </button>
                    ))}
                  </div>
                  {cashNum > 0 && (
                    <div className={'change-box' + (cashNum < finalTotal ? ' short' : '')}>
                      {cashNum >= finalTotal ? (
                        <><span>Сдача клиенту</span><b className="num">{money(changeAmount)}</b></>
                      ) : (
                        <><span>Не хватает</span><b className="num">{money(finalTotal - cashNum)}</b></>
                      )}
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'qr' && (
                <div className="pay-details qr-box">
                  <div className="qr-bank">{storeSettings?.qr_bank_name || 'MBank / O!Деньги / Элсом'}</div>
                  {storeSettings?.qr_account ? (
                    <div className="qr-acc">Реквизиты: <b>{storeSettings.qr_account}</b></div>
                  ) : (
                    <div className="qr-acc muted">Номер MBank / QR можно задать в «Настройках и БД»</div>
                  )}
                </div>
              )}

              {paymentMethod === 'mixed' && (
                <div className="pay-details">
                  <div className="form-row">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Наличными, сом</label>
                      <input
                        type="number"
                        min="0"
                        max={finalTotal}
                        value={cashPart}
                        onChange={(e) => setCashPart(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Картой / QR, сом</label>
                      <input type="number" readOnly value={mixedCardNum} />
                    </div>
                  </div>
                </div>
              )}

              {err && <div className="err">{err}</div>}

              <button
                type="button"
                className="btn btn-pay-cta"
                onClick={submitCheckout}
                disabled={busy || !cart.length}
              >
                <IconCheck size={17} />
                {busy ? 'Оформляю оплату…' : `Пробить чек · ${money(finalTotal)}`}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <h3>История чеков</h3>
          <p className="sub">Всего чеков: {receiptsHistory.length} · доступна повторная печать на Xprinter и возврат на склад</p>
          {!receiptsHistory.length ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 32, fontSize: 13 }}>Продаж пока нет</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Чек</th>
                    <th>Дата</th>
                    <th>Позиции</th>
                    <th>Оплата</th>
                    <th>Скидка</th>
                    <th>Итого</th>
                    <th>Прибыль</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {receiptsHistory.map((r) => (
                    <tr key={r.key}>
                      <td><span className="code mono">{r.receipt_no}</span></td>
                      <td className="num">{r.sale_date}</td>
                      <td className="receipt-items-cell">
                        {r.items.map((it, idx) => (
                          <div key={idx}>{it.name} × {it.quantity}</div>
                        ))}
                        {r.note && <small className="muted">{r.note}</small>}
                      </td>
                      <td><span className={'pill pay-' + r.payment_method}>{PAYMENT_LABELS[r.payment_method] || r.payment_method}</span></td>
                      <td className="num">{r.discount > 0 ? '−' + money(r.discount) : '—'}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                      <td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{money(r.profit)}</td>
                      <td>
                        <div className="act">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Печать чека на Xprinter"
                            onClick={() => printThermalReceipt(r, storeSettings)}
                          >
                            <IconPrinter size={14} /> Чек
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            title="Отменить чек"
                            onClick={() => cancelReceipt(r)}
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {completedReceipt && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCompletedReceipt(null); }}>
          <div className="modal receipt-success-modal">
            <div className="rs-badge"><IconCheck size={26} /></div>
            <h2>Оплата принята</h2>
            <p className="sub">Чек {completedReceipt.receipt_no} · {PAYMENT_LABELS[completedReceipt.payment_method]}</p>

            <div className="rs-paper">
              <div className="rs-brand">
                <img src={logoImg} alt="Vishenka Store" className="rs-logo" />
                <span>{(storeSettings?.store_name || 'Vishenka Store').toUpperCase()}</span>
              </div>
              <div className="rs-list">
                {completedReceipt.items.map((it, idx) => (
                  <div key={idx}>
                    <div className="rs-line">
                      <span>{it.name} × {it.quantity}</span>
                      <b>{money(it.line_total)}</b>
                    </div>
                    {Number(it.discount || 0) > 0 && (
                      <div className="rs-line sm disc">
                        <span>↳ скидка на товар</span>
                        <span>−{money(it.discount)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {completedReceipt.discount > 0 && (
                <div className="rs-line disc">
                  <span>Скидка</span>
                  <span>−{money(completedReceipt.discount)}</span>
                </div>
              )}
              <div className="rs-line total">
                <span>ИТОГО</span>
                <b>{money(completedReceipt.total)}</b>
              </div>
              {completedReceipt.payment_method === 'cash' && completedReceipt.cash_received > 0 && (
                <>
                  <div className="rs-line sm"><span>Получено</span><span>{money(completedReceipt.cash_received)}</span></div>
                  <div className="rs-line sm green"><span>Сдача</span><b>{money(completedReceipt.change_amount)}</b></div>
                </>
              )}
            </div>

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => printThermalReceipt(completedReceipt, storeSettings)}
              >
                <IconPrinter size={15} /> Печать чека (Xprinter)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCompletedReceipt(null);
                  scanRef.current?.focus();
                }}
              >
                Новый чек
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
