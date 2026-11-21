import React, { useState, useMemo } from 'react';
import BarcodeSvg from './BarcodeSvg';
import { IconPrinter, IconDownload, IconInfo } from './Icons';
import { LABEL_PRESETS, printBarcodeLabels, downloadBarcodeSvg, resolveBarcodeValue } from '../utils/print';

const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';

export default function LabelPrintModal({ products, storeSettings, onClose, notify }) {
  const [size, setSize] = useState(storeSettings?.label_size || '58x40');
  const [showStore, setShowStore] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [copiesMap, setCopiesMap] = useState(() => {
    const initial = {};
    for (const p of products) {
      initial[p.id] = products.length === 1 ? Math.max(1, Math.min(p.quantity || 1, 20)) : Math.max(1, p.quantity || 1);
    }
    return initial;
  });

  const storeName = storeSettings?.store_name || 'Vishenka Store';
  const previewProduct = products[0];
  const previewCode = resolveBarcodeValue(previewProduct);
  const preset = LABEL_PRESETS[size] || LABEL_PRESETS['58x40'];
  const hasArt = showCode && Boolean(previewProduct?.code);

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

  const handlePrint = () => {
    const items = products
      .map((p) => ({ product: p, copies: Number(copiesMap[p.id]) || 0 }))
      .filter((x) => x.copies > 0);
    if (!items.length) {
      notify?.('Укажите количество этикеток больше нуля');
      return;
    }
    const ok = printBarcodeLabels(items, { size, storeName, showStore, showPrice, showCode });
    if (ok) notify?.(`Отправлено на печать: ${totalLabels} этик.`);
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide label-modal">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        <h2>Печать этикеток на Xprinter</h2>
        <p className="sub">
          Термоэтикетки со штрихкодом EAN-13 — считываются сканером в любой раскладке клавиатуры
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

            <div className="xprinter-tip">
              <IconInfo size={15} />
              <span>В окне печати выберите принтер <b>Xprinter</b>, поля — <b>Нет</b>, масштаб — <b>100%</b>.</span>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          <button type="button" className="btn btn-primary" onClick={handlePrint} disabled={totalLabels <= 0}>
            <IconPrinter size={15} /> Печать на Xprinter ({totalLabels} шт)
          </button>
        </div>
      </div>
    </div>
  );
}
