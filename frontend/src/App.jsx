import React, { useState, useEffect, useCallback } from 'react';

/* ============================ helpers ============================ */
const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';
const num = (n) => new Intl.NumberFormat('ru-RU').format(n || 0);
const todayISO = () => new Date().toISOString().slice(0, 10);
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const monthFull = (m) => { const [y, mo] = m.split('-'); return MONTHS[Number(mo) - 1] + ' ' + y; };
const shortMonth = (m) => SHORT[Number(m.split('-')[1]) - 1];
const EMOJI = [
  [/джинс|брюк|штаны|лосин/i, '👖'], [/куртк|пуховик|пальт/i, '🧥'],
  [/юбк/i, '🩱'], [/кофт|кардиган|свитер|трикотаж/i, '🧶'],
  [/блуз|рубашк|футбол|топ/i, '👚'], [/плать|сарафан/i, '👗'],
  [/обув|ботинок|сапог/i, '👠'], [/сумк|аксессуар/i, '👜'],
];
const emojiFor = (name) => { for (const [re, em] of EMOJI) if (re.test(name)) return em; return '✨'; };
const GRADS = [
  ['#fde4ea', '#f8ece4'], ['#f0e6f3', '#f7f0f8'], ['#f8e9dc', '#fbf2e9'],
  ['#e2efe8', '#f0f7f2'], ['#f7e4ec', '#fcf0f5'], ['#e8eaf6', '#f2f3fb'],
];
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

/* ============================ small parts ============================ */
function Logo({ light, onClick }) {
  return (
    <span className={'logo' + (light ? ' light' : '')} onClick={onClick}>
      <span className="cherry">🍒</span>Vishenka<i>.</i>
    </span>
  );
}

function Toast({ text }) { return <div className={'toast' + (text ? ' show' : '')}>{text}</div>; }

function Stat({ icon, label, value, foot, tone }) {
  return <div className={'stat ' + (tone || '')}>
    <div className="ic">{icon}</div><div className="l">{label}</div>
    <div className="v">{value}</div><div className="f">{foot}</div>
  </div>;
}

/* ============================ Product modal ============================ */
function ProductModal({ product, categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: product?.name || '',
    code: product?.code || '',
    category: product?.category || 'Прочие',
    purchase_price: product?.purchase_price ?? 0,
    sale_price: product?.sale_price ?? 0,
    quantity: product?.quantity ?? 0,
  });
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
        name: form.name.trim(), code: form.code.trim(),
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
      onSaved(publish ? 'Товар выставлен на витрину' : (product ? 'Товар обновлён' : 'Товар сохранён в черновики'));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{product ? 'Редактировать товар' : 'Новый товар'}</h2>
        <p className="sub">Заполни данные и загрузи фотографии — их можно несколько</p>
        <div className="form-row">
          <div className="field full"><label>Название *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Например: Джинсы Басик черный" /></div>
          <div className="field"><label>Код товара (свой)</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Например: VS-1042" /></div>
          <div className="field"><label>Категория</label><input list="cat-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="field"><label>Количество, шт</label><input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
          <div className="field"><label>Закупка, сом / шт</label><input type="number" min="0" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></div>
          <div className="field"><label>Продажа, сом / шт</label><input type="number" min="0" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} /></div>
        </div>

        <div className="photo-block">
          <label>Фотографии товара (до 10)</label>
          <div className="photo-grid">
            {existing.map((p) => <div className="photo-thumb" key={p.id}><img src={p.url} alt="фото товара" /><button type="button" onClick={() => removeExisting(p.id)}>×</button></div>)}
            {previews.map((src, i) => <div className="photo-thumb" key={'new' + i}><img src={src} alt="новое фото" /><button type="button" onClick={() => removeNew(i)}>×</button><span className="new-tag">новое</span></div>)}
            <label className="photo-add"><input type="file" accept="image/*" multiple onChange={pickFiles} /><span>＋</span><small>Добавить фото</small></label>
          </div>
        </div>

        <div className="err">{error}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy}>В черновики</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{busy ? 'Сохраняю…' : 'На витрину'}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ Showcase ============================ */
function Showcase({ catalog, categories, onAdmin, query, setQuery, cat, setCat }) {
  const list = catalog.filter((p) =>
    (cat === 'Все' || p.category === cat) &&
    (!query || p.name.toLowerCase().includes(query) || (p.code || '').toLowerCase().includes(query))
  );
  const chooseCat = (c) => {
    setCat(c);
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div id="site">
      <header className="topbar">
        <div className="container topbar-in">
          <div><Logo /><span className="logo-sub">store · женская одежда</span></div>
          <nav className="nav-links">
            <a href="#catalog">Каталог</a>
            <a href="#" onClick={(e) => { e.preventDefault(); onAdmin(); }}>Для продавца</a>
          </nav>
          <button className="btn-seller" onClick={onAdmin}><span className="status-dot" />Для продавца</button>
        </div>
      </header>

      <section className="hero">
        <div className="blob a" /><div className="blob b" />
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">Vishenka Store · новая коллекция</div>
            <h1>Одежда, в которой<br /><em>ты — это ты</em></h1>
            <p className="lead">Изысканные вещи для каждого дня. Актуальные модели, честные цены в сомах и presence, которое всегда видно.</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#catalog">Смотреть каталог →</a>
              <button className="btn btn-ghost" onClick={onAdmin}>Панель управления</button>
            </div>
            <div className="hero-search">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={query} onChange={(e) => setQuery(e.target.value.toLowerCase())} placeholder="Найти джинсы, куртку или по коду…" />
            </div>
          </div>
          <div className="showcase">
            <div className="showcase-main"><div className="big">🍒</div></div>
            <div className="float-card one"><span>✨</span> Новинки каждую неделю</div>
            <div className="float-card two"><span>🤍</span> Качество, которое видно</div>
            <div className="float-card three"><span>📦</span> Всегда в наличии</div>
          </div>
        </div>
      </section>

      <main className="container catalog-sec" id="catalog">
        <div className="sec-head">
          <div><h2>Каталог</h2><p>{list.length} товаров · выбери категорию — каталог покажется сам</p></div>
          <div className="filters">
            {['Все', ...categories].map((c) => (
              <button key={c} className={'chip' + (c === cat ? ' active' : '')} onClick={() => chooseCat(c)}>{c}</button>
            ))}
          </div>
        </div>
        {list.length === 0 ? <div className="empty-state"><div className="e">🛍️</div><p>В этой категории пока пусто или ничего не найдено.</p></div> : (
          <div className="grid">
            {list.map((p, i) => {
              const g = GRADS[i % GRADS.length], q = p.quantity || 0;
              const badge = q <= 0 ? 'Нет в наличии' : q <= 3 ? 'Осталось ' + q + ' шт' : 'В наличии ' + q + ' шт';
              return (
                <article className="card" key={p.id} style={{ animationDelay: Math.min(i * 35, 350) + 'ms' }}>
                  <div className="card-img" style={{ background: `linear-gradient(145deg, ${g[0]}, ${g[1]})` }}>
                    {p.photos?.length ? <img className="card-photo" src={p.photos[0].url} alt={p.name} /> : <span className="emoji">{emojiFor(p.name)}</span>}
                    <span className={'badge ' + (q <= 0 ? 'out' : q <= 3 ? 'low' : '')}>{badge}</span>
                    {p.photos?.length > 1 && <span className="photo-count">📷 {p.photos.length}</span>}
                  </div>
                  <div className="card-body">
                    <div className="card-cat">{p.category}</div>
                    <div className="card-name">{p.name}</div>
                    <div className="card-foot"><span className="price">{money(p.sale_price)}</span><span className="qty">{q} шт</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
      <footer><div className="container"><Logo /><p>Каталог обновляется автоматически · Цены указаны в сомах (KGS)</p></div></footer>
    </div>
  );
}

/* ============================ Sales table ============================ */
function SalesTable({ list, onDelete }) {
  if (!list.length) return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24, fontSize: 12 }}>Продаж пока нет</p>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Дата</th><th>Товар</th><th>Кол-во</th><th>Выручка</th><th>Себестоимость</th><th>Прибыль</th>{onDelete && <th></th>}</tr></thead>
    <tbody>{list.map((s) => {
      const rev = (s.quantity || 0) * (s.unit_price || 0), cost = (s.quantity || 0) * (s.unit_cost || 0);
      return <tr key={s.id}>
        <td>{s.sale_date}</td><td>{s.product_name}</td><td>{s.quantity} шт</td>
        <td style={{ fontWeight: 700 }}>{money(rev)}</td><td>{money(cost)}</td>
        <td style={{ color: 'var(--green)', fontWeight: 800 }}>{money(rev - cost)}</td>
        {onDelete && <td><button className="btn btn-danger btn-sm" onClick={() => onDelete(s.id)}>🗑</button></td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

/* ============================ Stats panel ============================ */
function StatsPanel({ stats }) {
  const [period, setPeriod] = useState('today');
  const d = stats?.[period] || { sold: 0, deals: 0, revenue: 0, cost: 0, profit: 0 };
  const label = PERIODS.find((p) => p.key === period)?.label;
  return (
    <div className="panel period-panel">
      <div className="period-head">
        <div><h3>Статистика продаж</h3><p className="sub">Обновляется сразу после каждой продажи</p></div>
        <span className="live">● live</span>
      </div>
      <div className="period-tabs">
        {PERIODS.map((p) => <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
      </div>
      <div className="period-caption">Период: <b>{label}</b></div>
      <div className="period-grid">
        <div className="metric"><span className="m-ic">👗</span><div className="m-l">Продано вещей</div><div className="m-v">{num(d.sold)} шт</div></div>
        <div className="metric"><span className="m-ic">💰</span><div className="m-l">Выручка</div><div className="m-v">{money(d.revenue)}</div></div>
        <div className="metric"><span className="m-ic">📦</span><div className="m-l">Затраты на закупку</div><div className="m-v">{money(d.cost)}</div></div>
        <div className="metric profit"><span className="m-ic">📈</span><div className="m-l">Прибыль</div><div className="m-v">{money(d.profit)}</div></div>
      </div>
      <div className="period-foot">Количество сделок за период: <b>{num(d.deals)}</b></div>
    </div>
  );
}

/* ============================ Admin ============================ */
function Admin({ data, stats, categories, onExit, onSite, refresh, notify }) {
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Все');
  const [saleQuery, setSaleQuery] = useState('');
  const [saleProductId, setSaleProductId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [saleErr, setSaleErr] = useState('');
  const [dataErr, setDataErr] = useState('');
  const [passErr, setPassErr] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');

  const products = data.products || [], sales = data.sales || [];
  const reports = data.reports || [], dash = data.dashboard || {};
  const titles = { overview: 'Обзор', products: 'Товары', sales: 'Продажи', reports: 'Отчёты', data: 'База данных' };

  const setStatus = async (id, status) => {
    try { await api(`/api/products/${id}/status`, { method: 'POST', body: { status } }); await refresh(); notify('Статус обновлён'); }
    catch (e) { notify(e.message); }
  };
  const removeProduct = async (id) => {
    if (!window.confirm('Удалить товар вместе с фотографиями?')) return;
    await api('/api/products/' + id, { method: 'DELETE' }); await refresh(); notify('Товар удалён');
  };
  const removeSale = async (id) => {
    if (!window.confirm('Удалить продажу? Товар вернётся на склад.')) return;
    await api('/api/sales/' + id, { method: 'DELETE' }); await refresh(); notify('Продажа удалена');
  };

  const matches = products.filter((p) => {
    const q = saleQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q);
  });

  const submitSale = async () => {
    setSaleErr('');
    const pid = saleProductId || (matches.length === 1 ? matches[0].id : '');
    try {
      await api('/api/sales', { method: 'POST', body: { product_id: Number(pid), quantity: Number(saleQty), date: saleDate } });
      setSaleQuery(''); setSaleProductId(''); setSaleQty('1');
      await refresh(); notify('Продажа записана — статистика обновлена');
    } catch (e) { setSaleErr(e.message); }
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

  // график
  const months = (dash.months || []).slice().reverse();
  let chart = <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: '60px 0' }}>Пока нет продаж — запиши первую в разделе «Продажи»</p>;
  if (months.length && months.some((m) => m.revenue > 0)) {
    const max = Math.max(...months.map((m) => m.revenue)) || 1, W = 520, H = 170, step = W / months.length;
    const pts = months.map((m, i) => [i * step + step / 2, H - (m.revenue / max) * (H - 24)]);
    const line = pts.map((p) => p.join(',')).join(' ');
    const area = `M${pts[0][0]},${H} L${pts.map((p) => p.join(',')).join(' L')} L${pts[pts.length - 1][0]},${H} Z`;
    chart = <svg viewBox={`0 0 ${W} ${H + 26}`} preserveAspectRatio="none">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a32b45" stopOpacity=".3" /><stop offset="1" stopColor="#a32b45" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#ag)" /><polyline points={line} fill="none" stroke="#a32b45" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke="#a32b45" strokeWidth="2.5" /><text x={p[0]} y={H + 20} textAnchor="middle" fontSize="10" fill="#8d7f7b">{shortMonth(months[i].month)}</text></g>)}
    </svg>;
  }

  const filtered = products.filter((p) =>
    (activeCat === 'Все' || p.category === activeCat) &&
    (!productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || (p.code || '').toLowerCase().includes(productSearch.toLowerCase()))
  );
  const chosen = products.find((p) => String(p.id) === String(saleProductId));

  return (
    <div id="admin">
      <aside className="side">
        <Logo light />
        <div className="side-tag">Vishenka Store · управление</div>
        <nav className="side-nav">
          {[['overview', '📊', 'Обзор'], ['products', '👗', 'Товары'], ['sales', '💰', 'Продажи'], ['reports', '📅', 'Отчёты'], ['data', '🗄️', 'База данных']].map(([key, ic, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span className="ic">{ic}</span><span>{label}</span></button>
          ))}
        </nav>
        <div className="side-foot">
          <button onClick={onExit}><span className="ic">🚪</span><span>Выйти</span></button>
          <a href="#" onClick={(e) => { e.preventDefault(); onSite(); }}>Открыть витрину ↗</a>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-top"><h1>{titles[tab]}</h1><div className="meta">💾 PostgreSQL · {products.length} товаров · {sales.length} продаж</div></div>
        <div className="admin-body">
          {tab === 'overview' && <section className="tab active">
            <StatsPanel stats={stats} />
            <div className="stats">
              <Stat icon="👗" label="Товаров в базе" value={num(dash.total_products)} foot={`${dash.published || 0} на витрине · ${dash.drafts || 0} черновиков`} />
              <Stat icon="📦" label="Остаток на складе" value={num(dash.stock) + ' шт'} foot={money(dash.stock_cost) + ' по закупке'} tone="a" />
              <Stat icon="💎" label="Стоимость остатка" value={money(dash.stock_sale)} foot="если продать всё" />
              <Stat icon="🍒" label="Сегодня продано" value={num(stats?.today?.sold) + ' шт'} foot={money(stats?.today?.revenue)} tone="g" />
            </div>
            <div className="cols">
              <div className="panel"><h3>Выручка по месяцам</h3><p className="sub">Динамика продаж, сом</p><div className="chart">{chart}</div></div>
              <div className="panel"><h3>Заканчивается</h3><p className="sub">Остаток 3 шт или меньше</p>
                {(dash.low_stock || []).length ? dash.low_stock.map((p) => <div className="mini-row" key={p.id}><span>{p.name}</span><span className={'pill ' + (p.quantity <= 0 ? 'out' : 'low')}>{p.quantity} шт</span></div>) : <p style={{ color: 'var(--muted)', fontSize: 12, padding: '16px 0' }}>Всё в порядке 👌</p>}
              </div>
            </div>
            <div className="panel"><h3>Последние продажи</h3><p className="sub">Свежие операции</p><SalesTable list={dash.recent_sales || []} /></div>
          </section>}

          {tab === 'products' && <section className="tab active">
            <div className="cat-filter">
              <span>Категория:</span>
              {['Все', ...categories].map((c) => <button key={c} className={'chip' + (c === activeCat ? ' active' : '')} onClick={() => setActiveCat(c)}>{c}</button>)}
            </div>
            <div className="tbl-tools">
              <input className="field" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="🔍 Поиск по названию или коду…" />
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => setModal({ product: null })}>＋ Добавить товар</button>
            </div>
            <div className="panel"><div className="table-wrap"><table>
              <thead><tr><th>№</th><th>Код</th><th>Название</th><th>Категория</th><th>Закупка</th><th>Продажа</th><th>Кол-во</th><th>Наценка</th><th>Сумма закупки</th><th>Сумма продажи</th><th>Фото</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>{filtered.map((p, i) => <tr key={p.id}>
                <td className="muted">{i + 1}</td>
                <td><span className="code">{p.code || '—'}</span></td>
                <td><b>{p.name}</b></td>
                <td><span className="pill cat">{p.category}</span></td>
                <td>{money(p.purchase_price)}</td><td className="price-cell">{money(p.sale_price)}</td>
                <td><span className={'pill ' + (p.quantity <= 0 ? 'out' : p.quantity <= 3 ? 'low' : 'ok')}>{p.quantity} шт</span></td>
                <td style={{ color: 'var(--green)', fontWeight: 700 }}>{p.markup}%</td>
                <td>{money(p.purchase_total)}</td><td style={{ fontWeight: 700 }}>{money(p.sale_total)}</td>
                <td>{p.photos?.length ? <span className="photo-pill">📷 {p.photos.length}</span> : <span className="muted">—</span>}</td>
                <td><span className={'pill ' + STATUS[p.status].cls}>{STATUS[p.status].label}</span></td>
                <td><div className="act">
                  <button className="btn btn-ghost btn-sm" title="Редактировать и загрузить фото" onClick={() => setModal({ product: p })}>✎</button>
                  {p.status !== 'published'
                    ? <button className="btn btn-primary btn-sm" onClick={() => setStatus(p.id, 'published')}>На витрину</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p.id, 'draft')}>Снять</button>}
                  <button className="btn btn-danger btn-sm" onClick={() => removeProduct(p.id)}>🗑</button>
                </div></td>
              </tr>)}</tbody>
            </table></div>
            {!filtered.length && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 30, fontSize: 12 }}>В этой категории товаров нет</p>}
            </div>
          </section>}

          {tab === 'sales' && <section className="tab active">
            <div className="panel" style={{ maxWidth: 640 }}>
              <h3>Оформить продажу</h3><p className="sub">Ищи по названию или по коду товара</p>
              <div className="field"><label>Поиск товара</label>
                <input value={saleQuery} placeholder="Введи название или код…" onChange={(e) => { setSaleQuery(e.target.value); setSaleProductId(''); }} />
              </div>
              {matches.length > 0 && <div className="sale-list">
                {matches.slice(0, 8).map((p) => <button key={p.id} className={'sale-item' + (String(saleProductId) === String(p.id) ? ' selected' : '')} onClick={() => { setSaleProductId(p.id); setSaleQuery(p.name); }}>
                  <span className="sale-code">{p.code || '—'}</span><span className="sale-name">{p.name}</span><span className="sale-stock">{p.quantity} шт · {money(p.sale_price)}</span>
                </button>)}
              </div>}
              {chosen && <div className="chosen">Выбран: <b>{chosen.name}</b> {chosen.code && <span className="code">{chosen.code}</span>}</div>}
              <div className="form-row">
                <div className="field"><label>Количество, шт</label><input type="number" min="1" value={saleQty} onChange={(e) => setSaleQty(e.target.value)} /></div>
                <div className="field"><label>Дата</label><input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></div>
              </div>
              <div className="modal-actions"><button className="btn btn-primary" onClick={submitSale}>Записать продажу</button></div>
              <div className="err">{saleErr}</div>
            </div>
            <div className="panel"><h3>История продаж</h3><p className="sub">Всего записей: {sales.length}</p><SalesTable list={sales} onDelete={removeSale} /></div>
          </section>}

          {tab === 'reports' && <section className="tab active">
            <div className="notice"><span style={{ fontSize: 24 }}>🤖</span><div><b>Отчёты создаются сами</b><br />Каждый месяц система считает продажи, выручку, прибыль и остатки.</div></div>
            <div className="reports-grid">{reports.length ? reports.map((r, i) => <div className="report" key={r.month}>
              <div className="m">{monthFull(r.month)}{i === 0 && <span>последний</span>}</div>
              <div className="g">
                <div className="it"><div className="l">Продано</div><div className="v">{num(r.sold_pieces)} шт</div></div>
                <div className="it"><div className="l">Сделок</div><div className="v">{num(r.deals)}</div></div>
                <div className="it"><div className="l">Выручка</div><div className="v">{money(r.revenue)}</div></div>
                <div className="it"><div className="l">Затраты</div><div className="v">{money(r.cost)}</div></div>
                <div className="it pr"><div className="l">Прибыль</div><div className="v">{money(r.profit)}</div></div>
              </div>
              <div className="best">{r.best_seller ? <>Хит: <b>{r.best_seller}</b> — {r.best_seller_qty} шт</> : 'Нет данных'}</div>
              <div className="best" style={{ border: 'none', paddingTop: 5 }}>Остаток сейчас: <b>{num(dash.stock)} шт</b></div>
            </div>) : <div className="panel"><p style={{ color: 'var(--muted)', fontSize: 12 }}>Отчётов пока нет — запиши первую продажу.</p></div>}</div>
          </section>}

          {tab === 'data' && <section className="tab active">
            <div className="cols">
              <div className="panel">
                <h3>Надёжное хранение</h3><p className="sub">PostgreSQL — настоящая база данных</p>
                <div className="info-box">
                  <b>База:</b> PostgreSQL 17, база <b>ademi</b><br />
                  <b>Товаров:</b> {products.length} · <b>Продаж:</b> {sales.length}<br />
                  <b>Фото:</b> хранятся прямо в базе (до 10 на товар)<br />
                  <b>Публикация:</b> товар виден покупателям только после «На витрину»<br />
                  Все изменения сохраняются сразу.
                </div>
                <div className="data-actions">
                  <button className="btn btn-primary" onClick={exportBackup}>⬇ Скачать копию базы</button>
                  <label className="btn btn-ghost" style={{ position: 'relative', overflow: 'hidden' }}>⬆ Загрузить копию<input type="file" accept=".json,application/json" onChange={importBackup} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} /></label>
                </div>
                <div className="err">{dataErr}</div>
              </div>
              <div className="panel">
                <h3>Пароль</h3><p className="sub">Сменить пароль входа в админку</p>
                <div className="field"><label>Старый пароль</label><input type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} /></div>
                <div className="field"><label>Новый пароль</label><input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></div>
                <div className="modal-actions"><button className="btn btn-ghost" onClick={changePass}>Сменить пароль</button></div>
                <div className="err">{passErr}</div>
              </div>
            </div>
            <div className="panel"><h3>Как пользоваться</h3><p className="sub" style={{ lineHeight: 2, fontSize: 12 }}>
              1. В «Товарах» добавь товар, придумай ему код и загрузи несколько фото.<br />
              2. Сохрани в черновики, проверь, затем нажми «На витрину».<br />
              3. В «Продажах» ищи товар по названию или коду и записывай продажу.<br />
              4. На «Обзоре» сразу видно статистику за сегодня, вчера, неделю, месяц и всё время.
            </p></div>
          </section>}
        </div>
      </div>
      {modal && <ProductModal product={modal.product} categories={categories} onClose={() => setModal(null)} onSaved={(msg) => { setModal(null); refresh(); notify(msg); }} />}
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
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('Все');
  const [adminData, setAdminData] = useState({ products: [], sales: [], reports: [], dashboard: {} });
  const [stats, setStats] = useState(null);
  const [fatal, setFatal] = useState('');

  const notify = useCallback((text) => { setToast(text); setTimeout(() => setToast(''), 2800); }, []);

  const loadPublic = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api('/api/catalog'), api('/api/meta')]);
      setCatalog(c.products); setCategories(m.categories || []); setFatal('');
    } catch (e) { setFatal('Не удалось подключиться к серверу. Запусти start.bat и открой http://localhost:8000/'); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [p, s, d, r, st] = await Promise.all([
        api('/api/products'), api('/api/sales'), api('/api/dashboard'), api('/api/reports'), api('/api/stats'),
      ]);
      setAdminData({ products: p.products, sales: s.sales, dashboard: d, reports: r.reports });
      setStats(st);
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
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    authToken = ''; localStorage.removeItem('ademi_token'); setAuthed(false); setView('site');
  };

  return <>
    {fatal && <div className="fatal">{fatal}</div>}
    {view === 'site'
      ? <Showcase catalog={catalog} categories={categories} onAdmin={openAdmin} query={query} setQuery={setQuery} cat={cat} setCat={setCat} />
      : <Admin data={adminData} stats={stats} categories={categories} onExit={exit} onSite={() => setView('site')} refresh={refresh} notify={notify} />}

    {loginOpen && <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setLoginOpen(false); }}>
      <div className="modal login-modal">
        <div className="login-mark">🍒</div>
        <h2>Вход в панель</h2>
        <p className="sub">Vishenka Store · управление магазином</p>
        <div className="field"><label>Пароль</label><input type="password" autoFocus value={loginPass} onChange={(e) => setLoginPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }} /></div>
        <div className="err">{loginErr}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setLoginOpen(false)}>Отмена</button>
          <button className="btn btn-primary" onClick={doLogin}>Войти</button>
        </div>
      </div>
    </div>}
    <Toast text={toast} />
  </>;
}
