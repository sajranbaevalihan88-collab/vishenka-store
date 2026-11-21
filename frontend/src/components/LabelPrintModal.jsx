import React, { useState, useMemo, useEffect, useCallback } from 'react';
import BarcodeSvg from './BarcodeSvg';
import { IconPrinter, IconDownload, IconInfo, IconRefresh } from './Icons';
import { LABEL_PRESETS, printBarcodeLabels, downloadBarcodeSvg, resolveBarcodeValue } from '../utils/print';

const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';

const LOCAL_BRIDGES = [
  { statusUrl: 'http://127.0.0.1:18181/status', printUrl: 'http://127.0.0.1:18181/print/labels', calibrateUrl: 'http://127.0.0.1:18181/print/calibrate' },
  { statusUrl: 'http://127.0.0.1:8000/api/local-printer/status', printUrl: 'http://127.0.0.1:8000/api/local-printer/labels', calibrateUrl: 'http://127.0.0.1:8000/api/local-printer/calibrate' },
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export default function LabelPrintModal({ products, storeSettings, api, onClose, notify }) {
  const [size, setSize] = useState(storeSettings?.label_size || '58x40');
  const [showStore, setShowStore] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [flip180, setFlip180] = useState(false);
  const [copiesMap, setCopiesMap] = useState(() => {
    const initial = {};
    for (const p of products) {
      initial[p.id] = products.length === 1 ? Math.max(1, Math.min(p.quantity || 1, 20)) : Math.max(1, p.quantity || 1);
    }
    return initial;
  });

  // Прямая TSPL-печать на Xprinter (работает И на localhost, И на Render через локальный мост 127.0.0.1:18181)
  const [printerInfo, setPrinterInfo] = useState({ available: false, printers: [], default_printer: '' });
  const [bridgeTarget, setBridgeTarget] = useState(null); // null = same-origin /api/print/*, либо объект LOCAL_BRIDGES
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [printErr, setPrintErr] = useState('');

  const detectPrinters = useCallback(async () => {
    setCheckingBridge(true);
    setPrintErr('');
    try {
      // 1. Сначала проверяем same-origin (когда сайт открыт локально на localhost:8000)
      if (api) {
        try {
          const info = await api('/api/printers');
          if (info?.available) {
            setBridgeTarget(null);
            setPrinterInfo(info);
            setSelectedPrinter((prev) => (prev && info.printers?.includes(prev) ? prev : info.default_printer || info.printers?.[0] || ''));
            return;
          }
        } catch {
          // игнорируем — попробуем локальный мост ниже
        }
      }

      // 2. Если сайт открыт на Render / Vercel — подключаемся к локальному TSPL-мосту на ноутбуке
      for (const b of LOCAL_BRIDGES) {
        try {
          const res = await fetchWithTimeout(b.statusUrl, { method: 'GET', mode: 'cors' }, 1600);
          if (!res.ok) continue;
          const info = await res.json();
          if (info?.available) {
            setBridgeTarget(b);
            setPrinterInfo(info);
            setSelectedPrinter((prev) => (prev && info.printers?.includes(prev) ? prev : info.default_printer || info.printers?.[0] || ''));
            return;
          }
        } catch {
          // пробуем следующий порт
        }
      }

      setBridgeTarget(null);
      setPrinterInfo({ available: false, printers: [], default_printer: '' });
    } finally {
      setCheckingBridge(false);
    }
  }, [api]);

  useEffect(() => {
    detectPrinters();
  }, [detectPrinters]);

  const storeName = storeSettings?.store_name || 'Vishenka Store';
  const previewProduct = products[0];
  const previewCode = resolveBarcodeValue(previewProduct);
  const preset = LABEL_PRESETS[size] || LABEL_PRESETS['58x40'];
  const hasArt = showCode && Boolean(previewProduct?.code);
  const canDirectPrint = Boolean(printerInfo.available && selectedPrinter && size !== 'a4' && (bridgeTarget || api));

  const totalLabels = useMemo(
    () => products.reduce((acc, p) => acc + Math.max(0, Number(copiesMap[p.id]) || 0), 0),
    [products, copiesMap]
  );

  const setAllCopies = (mode) => {
    const next = {};
    for (const p of products) {
      next[p.id] = mode === 'stock' ? Math.max(1, p.quantity || 1) : 1;
    }
    setCopiesMap(next);
  };

  const handleBrowserPrint = () => {
    setPrintErr('');
    const items = products
      .map((p) => ({ product: p, copies: Number(copiesMap[p.id]) || 0 }))
      .filter((x) => x.copies > 0);
    if (!items.length) {
      notify?.('Укажите количество этикеток больше нуля');
      return;
    }
    const ok = printBarcodeLabels(items, { size, storeName, showStore, showPrice, showCode });
    if (ok) notify?.(`Открыто окно печати: ${totalLabels} этик.`);
  };

  const callDirectEndpoint = async (type, payload) => {
    if (bridgeTarget) {
      const url = type === 'calibrate' ? bridgeTarget.calibrateUrl : bridgeTarget.printUrl;
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        15000
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || 'Ошибка локального принтера');
      return data;
    }
    const path = type === 'calibrate' ? '/api/print/calibrate' : '/api/print/labels';
    return api(path, { method: 'POST', body: payload });
  };

  const sendDirectLabels = async (list) => {
    if (!selectedPrinter) return;
    setPrintErr('');
    setPrinting(true);
    try {
      const payload = {
        printer_name: selectedPrinter,
        size,
        store_name: storeName,
        show_store: showStore,
        show_price: showPrice,
        show_code: showCode,
        gap_mm: 2,
        density: 10,
        direction: flip180 ? 0 : 1,
        items: list.map(({ product, copies }) => ({
          name: product.name || 'Товар',
          price: Number(product.sale_price || 0),
          barcode: resolveBarcodeValue(product),
          code: product.code || '',
          copies,
        })),
      };
      const res = await callDirectEndpoint('labels', payload);
      notify?.(`Напечатано на ${res.printer}: ${res.labels_printed} шт`);
    } catch (e) {
      setPrintErr(e.message || 'Ошибка прямой печати');
    } finally {
      setPrinting(false);
    }
  };

  const handleDirectPrint = () => {
    const items = products
      .map((p) => ({ product: p, copies: Number(copiesMap[p.id]) || 0 }))
      .filter((x) => x.copies > 0);
    if (!items.length) {
      notify?.('Укажите количество этикеток больше нуля');
      return;
    }
    sendDirectLabels(items);
  };

  const handleTestOne = () => {
    if (!previewProduct) return;
    sendDirectLabels([{ product: previewProduct, copies: 1 }]);
  };

  const handleCalibrate = async () => {
    if (!selectedPrinter) return;
    setPrintErr('');
    setCalibrating(true);
    try {
      await callDirectEndpoint('calibrate', { printer_name: selectedPrinter, size });
      notify?.(`Датчик ленты откалиброван (${selectedPrinter})`);
    } catch (e) {
      setPrintErr(e.message || 'Ошибка калибровки');
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide label-modal">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        <h2>Печать этикеток на Xprinter</h2>
        <p className="sub">
          Термоэтикетки со штрихкодом EAN-13 — ровно по центру наклейки, без поворота и без «about:blank»
        </p>

        <div className="label-studio">
          <div className="label-preview-box">
            <div className="label-preview-caption">Предпросмотр бирки ({preset.w} × {preset.h} мм)</div>
            <div
              className="sticker-preview"
              style={{
                aspectRatio: `${preset.w} / ${preset.h}`,
                maxWidth: preset.w <= 35 ? 215 : 295,
              }}
            >
              {showStore && <div className="sp-brand">{storeName.toUpperCase()}</div>}
              <div className="sp-title">{previewProduct?.name}</div>
              {(showPrice || hasArt) && (
                <div className={'sp-row ' + (hasArt ? 'both' : 'center')}>
                  {showPrice && <span className="sp-prc">{money(previewProduct?.sale_price)}</span>}
                  {hasArt && <span className="sp-art">{previewProduct.code}</span>}
                </div>
              )}
              <div className="sp-bar">
                <BarcodeSvg value={previewCode} barHeight={preset.barH} fontSize={11.5} />
              </div>
            </div>
            {products.length === 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => {
                  downloadBarcodeSvg(previewProduct);
                  notify?.('Штрихкод SVG сохранён');
                }}
              >
                <IconDownload size={14} /> Скачать SVG штрихкода
              </button>
            )}
          </div>

          <div className="label-controls">
            {printerInfo.available ? (
              <div className="direct-print-box">
                <div className="dp-head">
                  <span className={'dp-status ' + (selectedPrinter ? 'ok' : 'warn')}>
                    <span className="dp-dot" />
                    {selectedPrinter
                      ? (bridgeTarget ? 'Прямая печать Xprinter (мост активен)' : 'Прямая печать Xprinter (TSPL)')
                      : 'Принтер не выбран'}
                  </span>
                  {selectedPrinter && size !== 'a4' && (
                    <div className="dp-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={handleCalibrate}
                        disabled={calibrating || printing}
                        title="Выровнять датчик зазора между этикетками"
                      >
                        <IconRefresh size={13} /> {calibrating ? 'Калибровка…' : 'Калибровка'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        onClick={handleTestOne}
                        disabled={printing || calibrating}
                        title="Напечатать 1 пробную наклейку"
                      >
                        Тест 1 шт
                      </button>
                    </div>
                  )}
                </div>
                {printerInfo.printers.length > 0 && (
                  <div className="dp-row">
                    <select
                      value={selectedPrinter}
                      onChange={(e) => setSelectedPrinter(e.target.value)}
                      aria-label="Принтер для прямой печати"
                    >
                      {printerInfo.printers.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="direct-print-box offline">
                <div className="dp-head">
                  <span className="dp-status warn">
                    <span className="dp-dot" />
                    {checkingBridge ? 'Ищу Xprinter на компьютере…' : 'Локальный мост Xprinter не запущен'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={detectPrinters}
                    disabled={checkingBridge}
                  >
                    <IconRefresh size={13} /> Проверить
                  </button>
                </div>
                <div className="dp-offline-note">
                  Чтобы печатать с Render ровно без «about:blank», запустите <b>start_printer_bridge.bat</b> на ноутбуке и нажмите «Проверить».
                </div>
              </div>
            )}

            <div className="field">
              <label>Размер этикетки (Xprinter / бумага)</label>
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                {Object.values(LABEL_PRESETS).map((pr) => (
                  <option key={pr.id} value={pr.id}>{pr.label}</option>
                ))}
              </select>
            </div>

            <div className="label-checks">
              <label className="chk">
                <input type="checkbox" checked={showStore} onChange={(e) => setShowStore(e.target.checked)} />
                <span>Магазин</span>
              </label>
              <label className="chk">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                <span>Цена</span>
              </label>
              <label className="chk">
                <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} />
                <span>Артикул</span>
              </label>
              {canDirectPrint && (
                <label className="chk">
                  <input type="checkbox" checked={flip180} onChange={(e) => setFlip180(e.target.checked)} />
                  <span>Развернуть 180°</span>
                </label>
              )}
            </div>

            <div className="label-qty-head">
              <span>Тираж наклеек: <b>{totalLabels} шт</b></span>
              <div className="act">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllCopies('one')}>По 1 шт</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllCopies('stock')}>По остатку</button>
              </div>
            </div>

            <div className="label-items-list">
              {products.map((p) => (
                <div className="label-item-row" key={p.id}>
                  <div className="label-item-info">
                    <b>{p.name}</b>
                    <small className="mono">{resolveBarcodeValue(p)} · ост. {p.quantity} шт</small>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={copiesMap[p.id] ?? 1}
                    onChange={(e) => setCopiesMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            {printErr && <div className="dp-err">{printErr}</div>}

            <div className="xprinter-tip">
              <IconInfo size={15} />
              {canDirectPrint ? (
                <span>
                  Печать идёт <b>напрямую в {selectedPrinter}</b> (TSPL, {preset.w}×{preset.h} мм) — ровно по наклейке, без окна браузера и без надписи «about:blank». Если лента съехала — нажмите <b>Калибровка</b>.
                </span>
              ) : (
                <span>
                  В окне печати браузера выберите принтер <b>Xprinter</b>, размер <b>60×40 мм</b> (или {preset.w}×{preset.h} мм), поля — <b>Нет</b>, масштаб — <b>100%</b> и снимите галочку <b>Колонтитулы</b>.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          {canDirectPrint ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={handleBrowserPrint} disabled={totalLabels <= 0 || printing}>
                Через браузер
              </button>
              <button type="button" className="btn btn-primary" onClick={handleDirectPrint} disabled={totalLabels <= 0 || printing}>
                <IconPrinter size={15} /> {printing ? 'Печатаю…' : `Печать на Xprinter (${totalLabels} шт)`}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleBrowserPrint} disabled={totalLabels <= 0}>
              <IconPrinter size={15} /> Печать через браузер ({totalLabels} шт)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
