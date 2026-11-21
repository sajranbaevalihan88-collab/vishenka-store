import React, { useState } from 'react';
import { IconHanger } from './Icons';
import { resolveBarcodeValue } from '../utils/print';

const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';

export default function ShowcaseProductModal({ product, onClose }) {
  const photos = product?.photos || [];
  const [idx, setIdx] = useState(0);
  if (!product) return null;

  const q = product.quantity || 0;
  const active = photos[idx];
  const bc = resolveBarcodeValue(product);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide showcase-modal">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        <div className="sp-grid">
          <div className="sp-gallery">
            <div className="sp-main">
              {active ? (
                <img src={active.url} alt={product.name} />
              ) : (
                <div className="sp-placeholder"><IconHanger size={52} /></div>
              )}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    className="sp-nav prev"
                    onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
                  >‹</button>
                  <button
                    type="button"
                    className="sp-nav next"
                    onClick={() => setIdx((i) => (i + 1) % photos.length)}
                  >›</button>
                </>
              )}
            </div>
            {photos.length > 1 && (
              <div className="sp-thumbs">
                {photos.map((ph, i) => (
                  <button
                    type="button"
                    key={ph.id}
                    className={'sp-thumb' + (i === idx ? ' active' : '')}
                    onClick={() => setIdx(i)}
                  >
                    <img src={ph.url} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sp-info">
            <div className="sp-cat">{product.category}</div>
            <h2>{product.name}</h2>
            <div className="sp-price num">{money(product.sale_price)}</div>

            <div className="sp-meta-list">
              <div className="sp-meta-row">
                <span>Наличие</span>
                <b className={q <= 0 ? 'txt-red' : q <= 3 ? 'txt-amber' : 'txt-green'}>
                  {q <= 0 ? 'Нет в наличии' : q <= 3 ? `Осталось ${q} шт` : `В наличии (${q} шт)`}
                </b>
              </div>
              {product.code && (
                <div className="sp-meta-row">
                  <span>Артикул</span>
                  <span className="code">{product.code}</span>
                </div>
              )}
              {bc && (
                <div className="sp-meta-row">
                  <span>Штрихкод</span>
                  <span className="code mono">{bc}</span>
                </div>
              )}
            </div>

            <div className="sp-note">
              Наличие в бутике Vishenka Store обновляется автоматически после каждой продажи.
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>Закрыть</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
