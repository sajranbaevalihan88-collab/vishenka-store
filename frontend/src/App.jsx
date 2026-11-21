import React, { useState, useEffect, useCallback } from 'react';
import logoImg from './assets/logo.jpg';
import BarcodeSvg from './components/BarcodeSvg';
import LabelPrintModal from './components/LabelPrintModal';
import PosTerminal from './components/PosTerminal';
import ShowcaseProductModal from './components/ShowcaseProductModal';
import {
  IconPos, IconChart, IconHanger, IconCalendar, IconSettings, IconLogout,
  IconExternal, IconSearch, IconPlus, IconEdit, IconTrash, IconBarcode,
  IconPrinter, IconRefresh, IconDownload, IconUpload, IconCamera, IconBox,
  IconTrend, IconCash, IconBag, IconArrowRight, IconScan, IconInfo,
} from './components/Icons';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { makeRandomEan13, normalizeScannedCode, playScanOk, playScanError } from './utils/barcode';
import { PAYMENT_LABELS, resolveBarcodeValue } from './utils/print';

/* ============================ helpers ============================ */
const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';
const num = (n) => new Intl.NumberFormat('ru-RU').format(n || 0);
const todayISO = () => new Date().toISOString().slice(0, 10);
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const monthFull = (m) => { const [y, mo] = m.split('-'); return MONTHS[Number(mo) - 1] + ' ' + y; };
const shortMonth = (m) => SHORT[Number(m.split('-')[1]) - 1];
const STATUS = {
  draft: { label: 'Черновик', cls: 'low' },
  review: { label: 'На проверке', cls: 'review' },
  published: { label: 'На витрине', cls: 'ok' },
};
const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'all', label: 'Всё время' },
];

/* ============================ API ============================ */
let authToken = localStorage.getItem('ademi_token') || '';

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = 'Bearer ' + authToken;
  const isRaw = options.body instanceof Blob;
  if (options.body !== undefined && !isRaw) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : (isRaw ? options.body : JSON.stringify(options.body)),
  });
  if (res.status === 401) { authToken = ''; localStorage.removeItem('ademi_token'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'Ошибка сервера');
  return data;
}

/* ============================ Brand Logo ============================ */
function BrandLogo({ size = 'md', light = false, onClick }) {
  return (
    <span className={`brand-lockup ${size} ${light ? 'light' : ''}`} onClick={onClick}>
      <span className="brand-avatar">
        <img src={logoImg} alt="Vishenka Store" />
      </span>
      <span className="brand-words">
        <span className="bw-main">VISHENKA</span>
        <span className="bw-sub">STORE</span>
      </span>
    </span>
  );
}

function Toast({ text }) { return <div className={'toast' + (text ? ' show' : '')}>{text}</div>; }

function Stat({ Icon, label, value, foot, tone }) {
  return (
    <div className={'stat ' + (tone || '')}>
      <div className="stat-head">
        <div className="l">{label}</div>
        <div className="ic"><Icon size={16} /></div>
      </div>
      <div className="v num">{value}</div>
      <div className="f">{foot}</div>
    </div>
  );
}

/* ============================ Product modal ============================ */
function ProductModal({ product, initialBarcode, categories, onClose, onSaved, onPrintLabel }) {
  const [form, setForm] = useState(() => ({
    name: product?.name || '',
    code: product?.code || '',
    barcode: product ? resolveBarcodeValue(product) : (initialBarcode || makeRandomEan13()),
    category: product?.category || 'Прочие',
    purchase_price: product?.purchase_price ?? 0,
    sale_price: product?.sale_price ?? 0,
    quantity: product?.quantity ?? 0,
  }));
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [existing, setExisting] = useState(product?.photos || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickFiles = (e) => {
    const chosen = Array.from(e.target.files || []);
    const free = Math.max(0, 10 - existing.length + removed.length - files.length);
    const next = chosen.slice(0, free);
    setFiles((f) => [...f, ...next]);
    setPreviews((p) => [...p, ...next.map((f) => URL.createObjectURL(f))]);
    e.target.value = '';
  };
  const removeExisting = (id) => { setExisting((l) => l.filter((p) => p.id !== id)); setRemoved((l) => [...l, id]); };
  const removeNew = (i) => {
    URL.revokeObjectURL(previews[i]);
    setFiles((l) => l.filter((_, idx) => idx !== i));
    setPreviews((l) => l.filter((_, idx) => idx !== i));
  };

  const save = async (publish) => {
    if (!form.name.trim()) { setError('Введите название товара'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim(),
        barcode: normalizeScannedCode(form.barcode) || makeRandomEan13(),
        category: form.category || 'Прочие',
        purchase_price: Number(form.purchase_price) || 0,
        sale_price: Number(form.sale_price) || 0,
        quantity: Number(form.quantity) || 0,
        status: product?.status || 'draft',
      };
      const res = await api(product ? '/api/products/' + product.id : '/api/products', {
        method: product ? 'PUT' : 'POST', body: payload,
      });
      const pid = res.product.id;
      for (const id of removed) await api(`/api/products/${pid}/photos/${id}`, { method: 'DELETE' });
      for (const file of files) {
        await api(`/api/products/${pid}/photos?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', body: file, headers: { 'Content-Type': file.type || 'image/jpeg' },
        });
      }
      if (publish) await api(`/api/products/${pid}/status`, { method: 'POST', body: { status: 'published' } });
      onSaved(
        publish ? 'Товар выставлен на витрину' : (product ? 'Товар обновлён' : 'Товар сохранён в черновики'),
        res.product
      );
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        <h2>{product ? 'Редактировать товар' : 'Новый товар'}</h2>
        <p className="sub">Штрихкод EAN-13 создан автоматически — можно оставить его или отсканировать заводскую бирку</p>

        <div className="form-row">
          <div className="field full">
            <label>Название *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Например: Джинсы Басик черный" />
          </div>
          <div className="field">
            <label>Штрихкод (EAN-13 / скан с бирки)</label>
            <div className="barcode-input-row">
              <input
                className="mono"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="2000000000015"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Сгенерировать новый штрихкод EAN-13"
                onClick={() => setForm((f) => ({ ...f, barcode: makeRandomEan13() }))}
              >
                <IconRefresh size={14} /> Новый
              </button>
            </div>
          </div>
          <div className="field">
            <label>Артикул (свой код)</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Например: VS-1042" />
          </div>
          <div className="field">
            <label>Категория</label>
            <input list="cat-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field">
            <label>Количество, шт</label>
            <input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </div>
          <div className="field">
            <label>Закупка, сом / шт</label>
            <input type="number" min="0" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
          </div>
          <div className="field">
            <label>Продажа, сом / шт</label>
            <input type="number" min="0" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
          </div>
        </div>

        {form.barcode && (
          <div className="modal-barcode-preview">
            <div className="mbp-svg">
              <BarcodeSvg value={form.barcode} barHeight={40} fontSize={10.5} />
            </div>
            <div className="mbp-info">
              <b>Готовый штрихкод для Xprinter</b>
              <small>После сохранения распечатайте этикетку и считывайте её USB-сканером на кассе.</small>
              {product && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => onPrintLabel?.([{ ...product, ...form }])}
                >
                  <IconPrinter size={14} /> Печать этикетки
                </button>
              )}
            </div>
          </div>
        )}

        <div className="photo-block">
          <label>Фотографии товара (до 10)</label>
          <div className="photo-grid">
            {existing.map((p) => (
              <div className="photo-thumb" key={p.id}>
                <img src={p.url} alt="фото товара" />
                <button type="button" onClick={() => removeExisting(p.id)}>×</button>
              </div>
            ))}
            {previews.map((src, i) => (
              <div className="photo-thumb" key={'new' + i}>
                <img src={src} alt="новое фото" />
                <button type="button" onClick={() => removeNew(i)}>×</button>
                <span className="new-tag">новое</span>
              </div>
            ))}
            <label className="photo-add">
              <input type="file" accept="image/*" multiple onChange={pickFiles} />
              <IconPlus size={20} />
              <small>Фото</small>
            </label>
          </div>
        </div>

        <div className="err">{error}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>В черновики</button>
          <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{busy ? 'Сохраняю…' : 'На витрину'}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ Showcase ============================ */
function Showcase({ catalog, categories, onAdmin, query, setQuery, cat, setCat }) {
  const [activeProduct, setActiveProduct] = useState(null);

  const list = catalog.filter((p) =>
    (cat === 'Все' || p.category === cat) &&
    (!query ||
      p.name.toLowerCase().includes(query) ||
      (p.code || '').toLowerCase().includes(query) ||
      (p.barcode || '').toLowerCase().includes(query))
  );

  // Показываем только категории, в которых реально есть товары на витрине
  const activeCategories = categories.filter((c) => catalog.some((p) => p.category === c));
  const quickCats = activeCategories.slice(0, 7);

  const chooseCat = (c) => {
    setCat(c);
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div id="site">
      <header className="topbar">
        <div className="container topbar-in">
          <div className="topbar-brand">
            <BrandLogo light size="sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
            <span className="logo-sub">бутик женской одежды</span>
          </div>
          <nav className="nav-links">
            <a href="#catalog">Каталог</a>
            <a href="#" onClick={(e) => { e.preventDefault(); onAdmin(); }}>Касса</a>
          </nav>
          <button className="btn-seller" onClick={onAdmin}>
            Для продавца
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">VISHENKA STORE · СЕЗОННАЯ КОЛЛЕКЦИЯ</div>
            <h1>Женская одежда<br /><em>с характером</em></h1>
            <p className="lead">
              Отобранные модели в наличии, актуальные цены в сомах и мгновенное обновление остатков прямо с кассы бутика.
            </p>
            <div className="hero-actions">
              <a className="btn btn-gold" href="#catalog">
                Перейти в каталог <IconArrowRight size={15} />
              </a>
              <button className="btn btn-velvet-outline" onClick={onAdmin}>
                Панель продавца
              </button>
            </div>
            <div className="hero-search">
              <IconSearch size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.toLowerCase())}
                placeholder="Поиск по названию или артикулу…"
              />
            </div>
          </div>

          <div className="showcase">
            <div className="crest-frame">
              <div className="crest-inner">
                <img src={logoImg} alt="Vishenka Store" className="crest-logo" />
              </div>
            </div>
          </div>
        </div>

        <div className="hero-strip">
          <div className="container hero-strip-in">
            <div><span>В каталоге</span><b>{catalog.length} моделей</b></div>
            <div><span>Категории</span><b>{activeCategories.length || categories.length} разделов</b></div>
            <div><span>Валюта</span><b>Сом (KGS)</b></div>
            <div><span>Наличие</span><b>Обновляется онлайн</b></div>
          </div>
        </div>
      </section>

      <main className="container catalog-sec" id="catalog">
        <div className="sec-head">
          <div>
            <div className="sec-kicker">КОЛЛЕКЦИЯ</div>
            <h2>Каталог</h2>
            <p>{list.length} моделей · нажмите на товар для просмотра фотографий</p>
          </div>
          <div className="catalog-controls">
            <div className="filters-row">
              {['Все', ...quickCats].map((c) => (
                <button key={c} className={'chip' + (c === cat ? ' active' : '')} onClick={() => chooseCat(c)}>
                  {c}
                </button>
              ))}
            </div>
            {activeCategories.length > 7 && (
              <select
                className="cat-select"
                value={cat}
                onChange={(e) => chooseCat(e.target.value)}
                aria-label="Все категории"
              >
                <option value="Все">Все категории ({activeCategories.length})</option>
                {activeCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {list.length === 0 ? (
          <div className="empty-state">
            <div className="e"><IconBag size={36} /></div>
            <p>В этой категории пока нет товаров или ничего не найдено.</p>
          </div>
        ) : (
          <div className="grid">
            {list.map((p) => {
              const q = p.quantity || 0;
              const badge = q <= 0 ? 'Нет в наличии' : q <= 3 ? `Осталось ${q}` : `В наличии · ${q}`;
              return (
                <article
                  className="card clickable"
                  key={p.id}
                  onClick={() => setActiveProduct(p)}
                >
                  <div className="card-img">
                    {p.photos?.length ? (
                      <img className="card-photo" src={p.photos[0].url} alt={p.name} />
                    ) : (
                      <span className="card-empty-ic"><IconHanger size={38} /></span>
                    )}
                    <span className={'badge ' + (q <= 0 ? 'out' : q <= 3 ? 'low' : '')}>{badge}</span>
                    {p.photos?.length > 1 && (
                      <span className="photo-count"><IconCamera size={12} /> {p.photos.length}</span>
                    )}
                  </div>
                  <div className="card-body">
                    <div className="card-cat">{p.category}</div>
                    <div className="card-name">{p.name}</div>
                    <div className="card-foot">
                      <span className="price num">{money(p.sale_price)}</span>
                      <span className="qty">{p.code || `${q} шт`}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer>
        <div className="container footer-in">
          <BrandLogo light size="md" />
          <div className="footer-rule" />
          <p>Vishenka Store · Цены указаны в сомах (KGS) · Наличие обновляется автоматически</p>
        </div>
      </footer>

      {activeProduct && (
        <ShowcaseProductModal
          product={activeProduct}
          onClose={() => setActiveProduct(null)}
        />
      )}
    </div>
  );
}

/* ============================ Sales table ============================ */
function SalesTable({ list, onDelete }) {
  if (!list.length) return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24, fontSize: 12 }}>Продаж пока нет</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Чек</th>
            <th>Товар</th>
            <th>Кол-во</th>
            <th>Оплата</th>
            <th>Выручка</th>
            <th>Прибыль</th>
            {onDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const rev = s.line_total ?? Math.max(0, (s.quantity || 0) * (s.unit_price || 0) - (s.discount || 0));
            const cost = (s.quantity || 0) * (s.unit_cost || 0);
            const prof = s.profit ?? (rev - cost);
            const pm = s.payment_method || 'cash';
            return (
              <tr key={s.id}>
                <td className="num">{s.sale_date}</td>
                <td>{s.receipt_no ? <span className="code mono">{s.receipt_no}</span> : <span className="muted">—</span>}</td>
                <td><b>{s.product_name}</b></td>
                <td className="num">{s.quantity} шт</td>
                <td><span className={'pill pay-' + pm}>{PAYMENT_LABELS[pm] || pm}</span></td>
                <td className="num" style={{ fontWeight: 700 }}>{money(rev)}</td>
                <td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{money(prof)}</td>
                {onDelete && (
                  <td>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => onDelete(s.id)}>
                      <IconTrash size={14} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ Stats panel ============================ */
function StatsPanel({ stats }) {
  const [period, setPeriod] = useState('today');
  const d = stats?.[period] || { sold: 0, deals: 0, revenue: 0, cost: 0, profit: 0, by_payment: {} };
  const label = PERIODS.find((p) => p.key === period)?.label;
  const bp = d.by_payment || {};

  return (
    <div className="panel period-panel">
      <div className="period-head">
        <div>
          <h3>Статистика продаж</h3>
          <p className="sub">Обновляется после каждой оплаты на кассе</p>
        </div>
        <span className="live"><span className="pulse-dot" /> Live</span>
      </div>
      <div className="period-tabs">
        {PERIODS.map((p) => (
          <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="period-caption">Период: <b>{label}</b></div>
      <div className="period-grid">
        <div className="metric"><div className="m-l">Продано вещей</div><div className="m-v num">{num(d.sold)} шт</div></div>
        <div className="metric"><div className="m-l">Выручка</div><div className="m-v num">{money(d.revenue)}</div></div>
        <div className="metric"><div className="m-l">Себестоимость</div><div className="m-v num">{money(d.cost)}</div></div>
        <div className="metric profit"><div className="m-l">Чистая прибыль</div><div className="m-v num">{money(d.profit)}</div></div>
      </div>
      <div className="period-foot">
        <span>Чеков: <b className="num">{num(d.deals)}</b></span>
        <span className="pay-breakdown num">
          <span>Наличные: <b>{money(bp.cash || 0)}</b></span>
          <span>QR / Перевод: <b>{money(bp.qr || 0)}</b></span>
          <span>Карта: <b>{money(bp.card || 0)}</b></span>
          {(bp.mixed || 0) > 0 && <span>Смешанная: <b>{money(bp.mixed)}</b></span>}
        </span>
      </div>
    </div>
  );
}

/* ============================ Admin ============================ */
function Admin({ data, stats, apiVersion, storeSettings, setStoreSettings, categories, onExit, onSite, refresh, notify }) {
  const [tab, setTab] = useState('pos');
  const [modal, setModal] = useState(null);
  const [labelModalProducts, setLabelModalProducts] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Все');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pendingScan, setPendingScan] = useState(null);
  const [globalScanPopup, setGlobalScanPopup] = useState(null);
  const [dataErr, setDataErr] = useState('');
  const [passErr, setPassErr] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [settingsForm, setSettingsForm] = useState(storeSettings || {});
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (storeSettings) setSettingsForm(storeSettings);
  }, [storeSettings]);

  const products = data.products || [];
  const sales = data.sales || [];
  const reports = data.reports || [];
  const dash = data.dashboard || {};
  const soundOn = storeSettings?.sound_enabled !== false;
  const serverOutdated = apiVersion !== null && apiVersion < 2;

  const titles = {
    pos: 'Касса и оплата',
    overview: 'Обзор магазина',
    products: 'Товары и штрихкоды',
    reports: 'Отчёты по месяцам',
    data: 'Настройки и база',
  };

  useBarcodeScanner({
    enabled: !modal && !labelModalProducts,
    onScan: (code) => {
      if (tab === 'pos') {
        setPendingScan({ code, ts: Date.now() });
        return;
      }
      const lc = code.toLowerCase();
      const found =
        products.find((p) => resolveBarcodeValue(p).toLowerCase() === lc) ||
        products.find((p) => (p.barcode || '').toLowerCase() === lc) ||
        products.find((p) => (p.code || '').toLowerCase() === lc);

      if (found) {
        playScanOk(soundOn);
        setGlobalScanPopup({ code, product: found });
      } else {
        playScanError(soundOn);
        setGlobalScanPopup({ code, product: null });
      }
    },
  });

  const setStatus = async (id, status) => {
    try { await api(`/api/products/${id}/status`, { method: 'POST', body: { status } }); await refresh(); notify('Статус обновлён'); }
    catch (e) { notify(e.message); }
  };
  const removeProduct = async (id) => {
    if (!window.confirm('Удалить товар вместе с фотографиями?')) return;
    await api('/api/products/' + id, { method: 'DELETE' });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    await refresh(); notify('Товар удалён');
  };
  const generateMissingBarcodes = async () => {
    try {
      const res = await api('/api/products/generate-barcodes', { method: 'POST' });
      await refresh();
      notify(res.updated ? `Присвоены штрихкоды EAN-13: ${res.updated} товарам` : 'У всех товаров уже есть штрихкоды');
    } catch (e) {
      notify(serverOutdated ? 'Сначала перезапустите start.bat (закройте чёрное окно и откройте заново)' : e.message);
    }
  };

  const exportBackup = async () => {
    const backup = await api('/api/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'vishenka-backup-' + todayISO() + '.json';
    a.click(); URL.revokeObjectURL(a.href); notify('Копия базы скачана');
  };
  const importBackup = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.confirm('Заменить текущие данные из файла?')) { e.target.value = ''; return; }
    try { await api('/api/restore', { method: 'POST', body: JSON.parse(await file.text()) }); setDataErr(''); await refresh(); notify('База восстановлена'); }
    catch (err) { setDataErr('Ошибка: ' + err.message); }
    e.target.value = '';
  };
  const changePass = async () => {
    try { await api('/api/change-password', { method: 'POST', body: { old_password: oldPass, new_password: newPass } }); setOldPass(''); setNewPass(''); setPassErr(''); notify('Пароль изменён'); }
    catch (e) { setPassErr(e.message); }
  };
  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await api('/api/store-settings', { method: 'POST', body: settingsForm });
      setStoreSettings(res.settings);
      notify('Настройки бутика и Xprinter сохранены');
    } catch (e) {
      notify(serverOutdated ? 'Перезапустите start.bat, чтобы активировать сохранение настроек' : e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const months = (dash.months || []).slice().reverse();
  let chart = <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: '60px 0' }}>Пока нет продаж — пробейте первый чек на кассе</p>;
  if (months.length && months.some((m) => m.revenue > 0)) {
    const max = Math.max(...months.map((m) => m.revenue)) || 1, W = 520, H = 170, step = W / months.length;
    const pts = months.map((m, i) => [i * step + step / 2, H - (m.revenue / max) * (H - 24)]);
    const line = pts.map((p) => p.join(',')).join(' ');
    const area = `M${pts[0][0]},${H} L${pts.map((p) => p.join(',')).join(' L')} L${pts[pts.length - 1][0]},${H} Z`;
    chart = (
      <svg viewBox={`0 0 ${W} ${H + 26}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7a1326" stopOpacity=".24" />
            <stop offset="1" stopColor="#7a1326" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ag)" />
        <polyline points={line} fill="none" stroke="#7a1326" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r="3.8" fill="#fff" stroke="#7a1326" strokeWidth="2.2" />
            <text x={p[0]} y={H + 20} textAnchor="middle" fontSize="10" fill="#7a6468">{shortMonth(months[i].month)}</text>
          </g>
        ))}
      </svg>
    );
  }

  const filtered = products.filter((p) => {
    const q = productSearch.trim().toLowerCase();
    const qNorm = normalizeScannedCode(productSearch).toLowerCase();
    const bc = resolveBarcodeValue(p).toLowerCase();
    return (
      (activeCat === 'Все' || p.category === activeCat) &&
      (statusFilter === 'all' || p.status === statusFilter) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        bc.includes(q) ||
        bc.includes(qNorm))
    );
  });

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleSelectAll = () => {
    const visibleIds = filtered.map((p) => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  };
  const selectedProducts = products.filter((p) => selectedIds.includes(p.id));

  const NAV = [
    ['pos', IconPos, 'Касса и оплата'],
    ['overview', IconChart, 'Обзор'],
    ['products', IconHanger, 'Товары и бирки'],
    ['reports', IconCalendar, 'Отчёты'],
    ['data', IconSettings, 'Настройки и БД'],
  ];

  return (
    <div id="admin">
      <aside className="side">
        <div className="side-brand">
          <BrandLogo light size="sm" />
        </div>
        <div className="side-tag">POS-КАССА И УЧЁТ</div>
        <nav className="side-nav">
          {NAV.map(([key, Icon, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              <span className="ic"><Icon size={17} /></span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button onClick={onExit}><span className="ic"><IconLogout size={16} /></span><span>Выйти</span></button>
          <a href="#" onClick={(e) => { e.preventDefault(); onSite(); }}>
            <span>Открыть витрину</span> <IconExternal size={13} />
          </a>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-top">
          <div className="admin-top-title">
            <img src={logoImg} alt="Vishenka Store" className="admin-top-logo" />
            <h1>{titles[tab]}</h1>
          </div>
          <div className="meta">
            <span>PostgreSQL</span>
            <span>·</span>
            <span className="num">{products.length} товаров</span>
            <span>·</span>
            <span className="num">{sales.length} операций</span>
          </div>
        </div>

        {serverOutdated && (
          <div className="restart-banner">
            <IconInfo size={18} />
            <div>
              <b>Требуется перезапуск start.bat</b> — сейчас работает старая версия Python-сервера, поэтому штрихкоды и касса ещё не активированы. Закройте чёрное окно <code>start.bat</code> и запустите его заново, затем обновите эту страницу (F5).
            </div>
          </div>
        )}

        {globalScanPopup && (
          <div className="global-scan-banner">
            {globalScanPopup.product ? (
              <>
                <div className="gsb-left">
                  <span className="gsb-ic"><IconScan size={20} /></span>
                  <div>
                    <div className="gsb-kicker">Штрихкод {globalScanPopup.code}</div>
                    <b>{globalScanPopup.product.name}</b> — {money(globalScanPopup.product.sale_price)} (ост. {globalScanPopup.product.quantity} шт)
                  </div>
                </div>
                <div className="act">
                  <button
                    className="btn btn-gold btn-sm"
                    onClick={() => {
                      const code = globalScanPopup.code;
                      setGlobalScanPopup(null);
                      setTab('pos');
                      setPendingScan({ code, ts: Date.now() });
                    }}
                  >
                    В кассу
                  </button>
                  <button
                    className="btn btn-velvet-outline btn-sm"
                    onClick={() => {
                      const p = globalScanPopup.product;
                      setGlobalScanPopup(null);
                      setModal({ product: p });
                    }}
                  >
                    Карточка
                  </button>
                  <button className="btn btn-velvet-outline btn-sm" onClick={() => setGlobalScanPopup(null)}>×</button>
                </div>
              </>
            ) : (
              <>
                <div className="gsb-left">
                  <span className="gsb-ic"><IconInfo size={20} /></span>
                  <div>
                    <div className="gsb-kicker">Штрихкод {globalScanPopup.code} не найден</div>
                    <b>Новый товар?</b> Можно сразу завести карточку с этим штрихкодом.
                  </div>
                </div>
                <div className="act">
                  <button
                    className="btn btn-gold btn-sm"
                    onClick={() => {
                      const code = globalScanPopup.code;
                      setGlobalScanPopup(null);
                      setModal({ product: null, initialBarcode: code });
                    }}
                  >
                    Создать товар
                  </button>
                  <button className="btn btn-velvet-outline btn-sm" onClick={() => setGlobalScanPopup(null)}>×</button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="admin-body">
          {tab === 'pos' && (
            <PosTerminal
              products={products}
              sales={sales}
              categories={categories}
              storeSettings={storeSettings}
              api={api}
              refresh={refresh}
              notify={notify}
              pendingScan={pendingScan}
              clearPendingScan={() => setPendingScan(null)}
              onCreateWithBarcode={(code) => setModal({ product: null, initialBarcode: code })}
              onPrintLabel={(list) => setLabelModalProducts(list)}
            />
          )}

          {tab === 'overview' && (
            <section className="tab active">
              <StatsPanel stats={stats} />
              <div className="stats">
                <Stat Icon={IconHanger} label="Товаров в базе" value={num(dash.total_products)} foot={`${dash.published || 0} на витрине · ${dash.drafts || 0} черновиков`} />
                <Stat Icon={IconBox} label="Остаток на складе" value={num(dash.stock) + ' шт'} foot={money(dash.stock_cost) + ' по закупке'} tone="a" />
                <Stat Icon={IconCash} label="Стоимость остатка" value={money(dash.stock_sale)} foot="по ценам продажи" />
                <Stat Icon={IconTrend} label="Сегодня продано" value={num(stats?.today?.sold) + ' шт'} foot={money(stats?.today?.revenue)} tone="g" />
              </div>
              <div className="cols">
                <div className="panel">
                  <h3>Выручка по месяцам</h3>
                  <p className="sub">Динамика продаж, сом</p>
                  <div className="chart">{chart}</div>
                </div>
                <div className="panel">
                  <h3>Заканчивается</h3>
                  <p className="sub">Остаток 3 шт или меньше</p>
                  {(dash.low_stock || []).length ? (
                    dash.low_stock.map((p) => (
                      <div className="mini-row" key={p.id}>
                        <span>{p.name}</span>
                        <span className={'pill ' + (p.quantity <= 0 ? 'out' : 'low')}>{p.quantity} шт</span>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: 'var(--muted)', fontSize: 12, padding: '16px 0' }}>Все позиции в достаточном количестве</p>
                  )}
                </div>
              </div>
              <div className="panel">
                <h3>Последние продажи</h3>
                <p className="sub">Свежие операции с кассы</p>
                <SalesTable list={dash.recent_sales || []} />
              </div>
            </section>
          )}

          {tab === 'products' && (
            <section className="tab active">
              <div className="tbl-tools">
                <div className="search-field">
                  <IconSearch size={15} />
                  <input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Поиск по названию, коду или штрихкоду…"
                  />
                </div>
                <select
                  className="cat-select"
                  value={activeCat}
                  onChange={(e) => setActiveCat(e.target.value)}
                >
                  <option value="Все">Все категории ({products.length})</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  className="cat-select sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Все статусы</option>
                  <option value="published">На витрине</option>
                  <option value="draft">Черновики</option>
                </select>
                <div style={{ flex: 1 }} />
                {selectedProducts.length > 0 && (
                  <button
                    className="btn btn-gold btn-sm"
                    onClick={() => setLabelModalProducts(selectedProducts)}
                  >
                    <IconPrinter size={15} /> Этикетки ({selectedProducts.length})
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={generateMissingBarcodes}
                  title="Присвоить EAN-13 товарам без штрихкода"
                >
                  <IconBarcode size={15} /> Штрихкоды всем
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setModal({ product: null })}>
                  <IconPlus size={15} /> Добавить товар
                </button>
              </div>

              <div className="panel table-panel">
                <div className="table-wrap">
                  <table className="products-table">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={filtered.length > 0 && filtered.every((p) => selectedIds.includes(p.id))}
                            onChange={toggleSelectAll}
                          />
                        </th>
                        <th>Товар / категория</th>
                        <th>Штрихкод</th>
                        <th>Закупка</th>
                        <th>Продажа</th>
                        <th>Остаток</th>
                        <th>Наценка</th>
                        <th>Статус</th>
                        <th style={{ textAlign: 'right' }}>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const bc = p.barcode || '';
                        return (
                          <tr key={p.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(p.id)}
                                onChange={() => toggleSelect(p.id)}
                              />
                            </td>
                            <td className="prod-cell">
                              <div className="prod-title-row">
                                <b>{p.name}</b>
                                {p.photos?.length > 0 && (
                                  <span className="photo-pill"><IconCamera size={11} /> {p.photos.length}</span>
                                )}
                              </div>
                              <div className="prod-sub">
                                <span>{p.category}</span>
                                {p.code && <><span>·</span><span className="mono">{p.code}</span></>}
                              </div>
                            </td>
                            <td>
                              {bc ? (
                                <span className="code mono">{bc}</span>
                              ) : (
                                <span className="code mono muted-code" title="Перезапустите start.bat для сохранения в БД">
                                  {resolveBarcodeValue(p)}
                                </span>
                              )}
                            </td>
                            <td className="num muted">{money(p.purchase_price)}</td>
                            <td className="num price-cell">{money(p.sale_price)}</td>
                            <td>
                              <span className={'pill num ' + (p.quantity <= 0 ? 'out' : p.quantity <= 3 ? 'low' : 'ok')}>
                                {p.quantity} шт
                              </span>
                            </td>
                            <td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{p.markup}%</td>
                            <td><span className={'pill ' + STATUS[p.status].cls}>{STATUS[p.status].label}</span></td>
                            <td>
                              <div className="act right">
                                <button
                                  className="btn btn-gold-soft btn-sm btn-icon"
                                  title="Печать штрихкод-этикетки на Xprinter"
                                  onClick={() => setLabelModalProducts([p])}
                                >
                                  <IconBarcode size={15} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm btn-icon"
                                  title="Редактировать товар"
                                  onClick={() => setModal({ product: p })}
                                >
                                  <IconEdit size={14} />
                                </button>
                                {p.status !== 'published' ? (
                                  <button className="btn btn-primary btn-sm" onClick={() => setStatus(p.id, 'published')}>
                                    На витрину
                                  </button>
                                ) : (
                                  <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p.id, 'draft')}>
                                    Снять
                                  </button>
                                )}
                                <button
                                  className="btn btn-danger btn-sm btn-icon"
                                  title="Удалить товар"
                                  onClick={() => removeProduct(p.id)}
                                >
                                  <IconTrash size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!filtered.length && (
                  <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 30, fontSize: 12 }}>
                    Товаров по выбранному фильтру не найдено
                  </p>
                )}
              </div>
            </section>
          )}

          {tab === 'reports' && (
            <section className="tab active">
              <div className="notice">
                <IconCalendar size={20} />
                <div>
                  <b>Автоматические ежемесячные отчёты</b><br />
                  Система учитывает скидки, возвраты и рассчитывает фактическую выручку, себестоимость и чистую прибыль.
                </div>
              </div>
              <div className="reports-grid">
                {reports.length ? reports.map((r, i) => (
                  <div className="report" key={r.month}>
                    <div className="m">{monthFull(r.month)}{i === 0 && <span>текущий</span>}</div>
                    <div className="g">
                      <div className="it"><div className="l">Продано</div><div className="v num">{num(r.sold_pieces)} шт</div></div>
                      <div className="it"><div className="l">Чеков</div><div className="v num">{num(r.deals)}</div></div>
                      <div className="it"><div className="l">Выручка</div><div className="v num">{money(r.revenue)}</div></div>
                      <div className="it"><div className="l">Затраты</div><div className="v num">{money(r.cost)}</div></div>
                      <div className="it pr"><div className="l">Чистая прибыль</div><div className="v num">{money(r.profit)}</div></div>
                    </div>
                    <div className="best">{r.best_seller ? <>Лидер продаж: <b>{r.best_seller}</b> ({r.best_seller_qty} шт)</> : 'Нет данных'}</div>
                    <div className="best" style={{ border: 'none', paddingTop: 5 }}>Остаток сейчас: <b className="num">{num(dash.stock)} шт</b></div>
                  </div>
                )) : (
                  <div className="panel"><p style={{ color: 'var(--muted)', fontSize: 12 }}>Отчётов пока нет — пробейте первый чек на кассе.</p></div>
                )}
              </div>
            </section>
          )}

          {tab === 'data' && (
            <section className="tab active">
              <div className="panel">
                <h3>Настройки бутика, QR-оплаты и Xprinter</h3>
                <p className="sub">Реквизиты и параметры печати для термоэтикеток и кассовых чеков</p>
                <div className="form-row">
                  <div className="field">
                    <label>Название магазина</label>
                    <input
                      value={settingsForm.store_name || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, store_name: e.target.value })}
                      placeholder="Vishenka Store"
                    />
                  </div>
                  <div className="field">
                    <label>Телефон магазина</label>
                    <input
                      value={settingsForm.store_phone || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, store_phone: e.target.value })}
                      placeholder="+996 ..."
                    />
                  </div>
                  <div className="field full">
                    <label>Адрес бутика (для шапки чека)</label>
                    <input
                      value={settingsForm.store_address || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, store_address: e.target.value })}
                      placeholder="Например: г. Бишкек, ..."
                    />
                  </div>
                  <div className="field">
                    <label>Банк / сервис для QR-оплаты</label>
                    <input
                      value={settingsForm.qr_bank_name || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, qr_bank_name: e.target.value })}
                      placeholder="MBank / O!Деньги / Элсом"
                    />
                  </div>
                  <div className="field">
                    <label>Номер телефона / счёта для перевода</label>
                    <input
                      value={settingsForm.qr_account || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, qr_account: e.target.value })}
                      placeholder="+996 (555) ..."
                    />
                  </div>
                  <div className="field">
                    <label>Размер этикетки Xprinter</label>
                    <select
                      value={settingsForm.label_size || '58x40'}
                      onChange={(e) => setSettingsForm({ ...settingsForm, label_size: e.target.value })}
                    >
                      <option value="58x40">58 × 40 мм (Xprinter стандарт)</option>
                      <option value="58x30">58 × 30 мм</option>
                      <option value="40x30">40 × 30 мм</option>
                      <option value="30x20">30 × 20 мм</option>
                      <option value="a4">Лист A4 (сетка)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Ширина чековой ленты</label>
                    <select
                      value={settingsForm.receipt_width || '58mm'}
                      onChange={(e) => setSettingsForm({ ...settingsForm, receipt_width: e.target.value })}
                    >
                      <option value="58mm">58 мм</option>
                      <option value="80mm">80 мм</option>
                    </select>
                  </div>
                </div>
                <div className="label-checks" style={{ marginTop: 8 }}>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={settingsForm.sound_enabled !== false}
                      onChange={(e) => setSettingsForm({ ...settingsForm, sound_enabled: e.target.checked })}
                    />
                    <span>Звуковой сигнал при сканировании и оплате</span>
                  </label>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={Boolean(settingsForm.auto_print_receipt)}
                      onChange={(e) => setSettingsForm({ ...settingsForm, auto_print_receipt: e.target.checked })}
                    />
                    <span>Открывать печать чека сразу после оплаты</span>
                  </label>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? 'Сохраняю…' : 'Сохранить настройки'}
                  </button>
                </div>
              </div>

              <div className="cols">
                <div className="panel">
                  <h3>Резервное копирование</h3>
                  <p className="sub">PostgreSQL — экспорт товаров, штрихкодов, продаж и фото</p>
                  <div className="info-box">
                    <b>База данных:</b> PostgreSQL (Vishenka Store)<br />
                    <b>Товаров:</b> {products.length} · <b>Операций продаж:</b> {sales.length}<br />
                    <b>Штрихкоды:</b> стандарт EAN-13 (автогенерация и печать на Xprinter)<br />
                    <b>Фотографии:</b> хранятся в базе (до 10 на товар)
                  </div>
                  <div className="data-actions">
                    <button className="btn btn-primary" onClick={exportBackup}>
                      <IconDownload size={15} /> Скачать копию
                    </button>
                    <label className="btn btn-ghost" style={{ position: 'relative', overflow: 'hidden' }}>
                      <IconUpload size={15} /> Загрузить копию
                      <input type="file" accept=".json,application/json" onChange={importBackup} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                    </label>
                  </div>
                  <div className="err">{dataErr}</div>
                </div>
                <div className="panel">
                  <h3>Смена пароля</h3>
                  <p className="sub">Пароль входа в кассу и панель управления</p>
                  <div className="field"><label>Старый пароль</label><input type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} /></div>
                  <div className="field"><label>Новый пароль</label><input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></div>
                  <div className="modal-actions"><button className="btn btn-ghost" onClick={changePass}>Обновить пароль</button></div>
                  <div className="err">{passErr}</div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {modal && (
        <ProductModal
          product={modal.product}
          initialBarcode={modal.initialBarcode}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); refresh(); notify(msg); }}
          onPrintLabel={(list) => setLabelModalProducts(list)}
        />
      )}

      {labelModalProducts && (
        <LabelPrintModal
          products={labelModalProducts}
          storeSettings={storeSettings}
          onClose={() => setLabelModalProducts(null)}
          notify={notify}
        />
      )}
    </div>
  );
}

/* ============================ App ============================ */
export default function App() {
  const [authed, setAuthed] = useState(!!authToken);
  const [view, setView] = useState('site');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [toast, setToast] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState([]);
  const [apiVersion, setApiVersion] = useState(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('Все');
  const [adminData, setAdminData] = useState({ products: [], sales: [], reports: [], dashboard: {} });
  const [stats, setStats] = useState(null);
  const [storeSettings, setStoreSettings] = useState({
    store_name: 'Vishenka Store',
    label_size: '58x40',
    receipt_width: '58mm',
    sound_enabled: true,
    auto_print_receipt: false,
  });
  const [fatal, setFatal] = useState('');

  const notify = useCallback((text) => { setToast(text); setTimeout(() => setToast(''), 3000); }, []);

  const loadPublic = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api('/api/catalog'), api('/api/meta')]);
      setCatalog(c.products);
      setCategories(m.categories || []);
      setApiVersion(m.api_version || 1);
      setFatal('');
    } catch {
      setFatal('Не удалось подключиться к серверу. Запустите start.bat и откройте http://localhost:8000/');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [p, s, d, r, st, ss, m] = await Promise.all([
        api('/api/products'),
        api('/api/sales'),
        api('/api/dashboard'),
        api('/api/reports'),
        api('/api/stats'),
        api('/api/store-settings').catch(() => ({ settings: null })),
        api('/api/meta').catch(() => null),
      ]);
      setAdminData({ products: p.products, sales: s.sales, dashboard: d, reports: r.reports });
      setStats(st);
      if (ss?.settings) setStoreSettings(ss.settings);
      if (m) setApiVersion(m.api_version || 1);
      setCatalog((await api('/api/catalog')).products);
    } catch (e) { notify(e.message); }
  }, [notify]);

  useEffect(() => { loadPublic(); }, [loadPublic]);
  useEffect(() => { if (authed && view === 'admin') refresh(); }, [authed, view, refresh]);

  const doLogin = async () => {
    setLoginErr('');
    try {
      const res = await api('/api/login', { method: 'POST', body: { password: loginPass } });
      authToken = res.token; localStorage.setItem('ademi_token', authToken);
      setAuthed(true); setLoginOpen(false); setLoginPass(''); setView('admin');
    } catch (e) { setLoginErr(e.message); }
  };
  const openAdmin = () => { if (!authed) { setLoginOpen(true); return; } setView('admin'); window.scrollTo(0, 0); };
  const exit = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    authToken = ''; localStorage.removeItem('ademi_token'); setAuthed(false); setView('site');
  };

  return (
    <>
      {fatal && <div className="fatal">{fatal}</div>}
      {view === 'site' ? (
        <Showcase catalog={catalog} categories={categories} onAdmin={openAdmin} query={query} setQuery={setQuery} cat={cat} setCat={setCat} />
      ) : (
        <Admin
          data={adminData}
          stats={stats}
          apiVersion={apiVersion}
          storeSettings={storeSettings}
          setStoreSettings={setStoreSettings}
          categories={categories}
          onExit={exit}
          onSite={() => setView('site')}
          refresh={refresh}
          notify={notify}
        />
      )}

      {loginOpen && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setLoginOpen(false); }}>
          <div className="modal login-modal">
            <div className="login-crest">
              <img src={logoImg} alt="Vishenka Store" />
            </div>
            <h2>Вход для продавца</h2>
            <p className="sub">Vishenka Store · касса и управление</p>
            <div className="field">
              <label>Пароль</label>
              <input
                type="password"
                autoFocus
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              />
            </div>
            <div className="err">{loginErr}</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setLoginOpen(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={doLogin}>Войти</button>
            </div>
          </div>
        </div>
      )}
      <Toast text={toast} />
    </>
  );
}
