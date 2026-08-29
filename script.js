(() => {
  'use strict';

  const STORAGE_KEY = 'jelanie_finmodel_mvp_v1';
  const MONTHS = Array.from({ length: 12 }, (_, i) => `М${i + 1}`);
  const scenarios = {
    conservative: { price: 4490, rtShare: 20, marketingShare: 30, acquiringShare: 3, serviceCost: 350, fixedCosts: 700000, startupInvestment: 1500000, orders: [80,120,180,260,360,480,620,760,900,1050,1200,1400] },
    base: { price: 4990, rtShare: 20, marketingShare: 25, acquiringShare: 3, serviceCost: 300, fixedCosts: 700000, startupInvestment: 1500000, orders: [150,250,400,600,800,1000,1200,1400,1600,1800,2000,2500] },
    growth: { price: 5490, rtShare: 20, marketingShare: 22, acquiringShare: 3, serviceCost: 300, fixedCosts: 850000, startupInvestment: 2000000, orders: [250,400,650,900,1200,1550,1900,2300,2700,3100,3500,4000] }
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const nonNegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const formatNumber = (value, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
  const formatMoney = value => `${formatNumber(value)} ₽`;
  const formatPercent = value => Number.isFinite(value) ? `${formatNumber(value * 100, 1)}%` : '-';
  const compactMoney = value => {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${sign}${formatNumber(abs / 1e9, 1)} млрд ₽`;
    if (abs >= 1e6) return `${sign}${formatNumber(abs / 1e6, 1)} млн ₽`;
    if (abs >= 1e3) return `${sign}${formatNumber(abs / 1e3, 1)} тыс. ₽`;
    return `${sign}${formatNumber(abs)} ₽`;
  };
  const axisMoney = value => {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e6) return `${sign}${formatNumber(abs / 1e6, 1)}м`;
    if (abs >= 1e3) return `${sign}${formatNumber(abs / 1e3)}к`;
    return `${sign}${formatNumber(abs)}`;
  };

  function normalize(value) {
    const keys = ['price','rtShare','marketingShare','acquiringShare','serviceCost','fixedCosts','startupInvestment'];
    const valid = value && typeof value === 'object' && Array.isArray(value.orders) && value.orders.length === 12 && keys.every(k => Number.isFinite(Number(value[k])));
    if (!valid) return clone(scenarios.base);
    const result = {};
    keys.forEach(k => result[k] = nonNegative(value[k]));
    result.orders = value.orders.map(v => Math.round(nonNegative(v)));
    return result;
  }

  function loadState() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (error) { return clone(scenarios.base); }
  }

  let state = loadState();
  let latest = null;
  let toastTimer;
  let resizeTimer;
  const modelInputs = [...document.querySelectorAll('[data-model]')];
  const monthInputs = [...document.querySelectorAll('[data-month]')];
  const scenarioButtons = [...document.querySelectorAll('[data-scenario]')];

  function calculate() {
    const percentageCosts = (state.rtShare + state.marketingShare + state.acquiringShare) / 100;
    const variableCostPerOrder = state.price * percentageCosts + state.serviceCost;
    const contributionPerOrder = state.price - variableCostPerOrder;
    const contributionMargin = state.price > 0 ? contributionPerOrder / state.price : 0;
    let cumulativeCash = -state.startupInvestment;
    let minimumCash = cumulativeCash;
    let paybackMonth = cumulativeCash >= 0 ? 0 : null;

    const rows = state.orders.map((orders, index) => {
      const revenue = orders * state.price;
      const rtCost = revenue * state.rtShare / 100;
      const marketingCost = revenue * state.marketingShare / 100;
      const acquiringCost = revenue * state.acquiringShare / 100;
      const serviceCost = orders * state.serviceCost;
      const variableCosts = rtCost + marketingCost + acquiringCost + serviceCost;
      const totalExpenses = variableCosts + state.fixedCosts;
      const operatingProfit = revenue - totalExpenses;
      cumulativeCash += operatingProfit;
      minimumCash = Math.min(minimumCash, cumulativeCash);
      if (paybackMonth === null && cumulativeCash >= 0) paybackMonth = index + 1;
      return { month:index + 1, orders, revenue, rtCost, marketingCost, acquiringCost, serviceCost, variableCosts, fixedCosts:state.fixedCosts, totalExpenses, operatingProfit, cumulativeCash };
    });

    const totals = rows.reduce((a, r) => {
      ['orders','revenue','rtCost','marketingCost','acquiringCost','serviceCost','variableCosts','fixedCosts','totalExpenses','operatingProfit'].forEach(k => a[k] += r[k]);
      return a;
    }, { orders:0,revenue:0,rtCost:0,marketingCost:0,acquiringCost:0,serviceCost:0,variableCosts:0,fixedCosts:0,totalExpenses:0,operatingProfit:0 });

    const fundingRequirement = Math.max(0, -minimumCash);
    const cashResult = totals.operatingProfit - state.startupInvestment;
    const operatingMargin = totals.revenue > 0 ? totals.operatingProfit / totals.revenue : 0;
    const roi = fundingRequirement > 0 ? cashResult / fundingRequirement : null;
    const breakEvenOrders = contributionPerOrder > 0 ? Math.ceil(state.fixedCosts / contributionPerOrder) : null;
    return { rows, totals, variableCostPerOrder, contributionPerOrder, contributionMargin, fundingRequirement, cashResult, operatingMargin, roi, paybackMonth, minimumCash, breakEvenOrders, breakEvenRevenue:breakEvenOrders === null ? null : breakEvenOrders * state.price };
  }

  function text(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function valueClass(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove('positive','negative','neutral');
    el.classList.add(value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');
  }
  function statesEqual(a,b) {
    const keys = ['price','rtShare','marketingShare','acquiringShare','serviceCost','fixedCosts','startupInvestment'];
    return keys.every(k => Number(a[k]) === Number(b[k])) && a.orders.every((v,i) => Number(v) === Number(b.orders[i]));
  }
  function updateScenarioButtons() {
    const active = Object.entries(scenarios).find(([,scenario]) => statesEqual(state, scenario))?.[0];
    scenarioButtons.forEach(button => button.classList.toggle('active', button.dataset.scenario === active));
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {} }
  function syncInputs() {
    modelInputs.forEach(input => input.value = state[input.dataset.model]);
    monthInputs.forEach(input => input.value = state.orders[Number(input.dataset.month)]);
  }

  function renderSummary(r) {
    const box = document.getElementById('model-summary');
    box.classList.remove('warning','negative');
    let html;
    if (r.contributionPerOrder <= 0) {
      box.classList.add('negative');
      html = '<strong>Модель неработоспособна:</strong> переменные расходы равны среднему чеку или превышают его.';
    } else if (r.paybackMonth !== null) {
      const period = r.paybackMonth === 0 ? 'сразу' : `в месяц ${r.paybackMonth}`;
      html = `При текущем сценарии проект окупается <strong>${period}</strong>. Требуемое финансирование: <strong>${compactMoney(r.fundingRequirement)}</strong>. Денежный результат года: <strong>${compactMoney(r.cashResult)}</strong>.`;
    } else {
      box.classList.add(r.cashResult >= 0 ? 'warning' : 'negative');
      html = `За 12 месяцев окупаемость <strong>не достигнута</strong>. Денежный результат: <strong>${compactMoney(r.cashResult)}</strong>.`;
    }
    document.getElementById('summary-text').innerHTML = html;
  }

  function renderWarning(r) {
    const el = document.getElementById('model-warning');
    let message = '';
    if (state.price <= 0) message = 'Средний чек должен быть больше нуля.';
    else if (r.contributionPerOrder <= 0) message = 'Каждый новый заказ увеличивает убыток. Увеличьте цену или сократите расходы.';
    else if (state.rtShare + state.marketingShare + state.acquiringShare >= 100) message = 'Сумма процентных расходов достигла 100% выручки или превысила ее.';
    el.hidden = !message;
    el.textContent = message;
  }

  function renderTable(r) {
    document.getElementById('forecast-body').innerHTML = r.rows.map(row => `<tr>
      <td>М${row.month}</td><td>${formatNumber(row.orders)}</td><td>${formatMoney(row.revenue)}</td><td>${formatMoney(row.rtCost)}</td><td>${formatMoney(row.marketingCost)}</td><td>${formatMoney(row.acquiringCost)}</td><td>${formatMoney(row.serviceCost)}</td><td>${formatMoney(row.totalExpenses)}</td><td class="${row.operatingProfit >= 0 ? 'positive' : 'negative'}">${formatMoney(row.operatingProfit)}</td><td class="${row.cumulativeCash >= 0 ? 'positive' : 'negative'}">${formatMoney(row.cumulativeCash)}</td>
    </tr>`).join('');
    const t = r.totals;
    document.getElementById('forecast-foot').innerHTML = `<tr><td>Итого</td><td>${formatNumber(t.orders)}</td><td>${formatMoney(t.revenue)}</td><td>${formatMoney(t.rtCost)}</td><td>${formatMoney(t.marketingCost)}</td><td>${formatMoney(t.acquiringCost)}</td><td>${formatMoney(t.serviceCost)}</td><td>${formatMoney(t.totalExpenses)}</td><td class="${t.operatingProfit >= 0 ? 'positive' : 'negative'}">${formatMoney(t.operatingProfit)}</td><td class="${r.cashResult >= 0 ? 'positive' : 'negative'}">${formatMoney(r.cashResult)}</td></tr>`;
  }

  function render() {
    latest = calculate();
    const r = latest;
    text('orders-total', formatNumber(r.totals.orders));
    text('preview-variable-cost', formatMoney(r.variableCostPerOrder));
    text('preview-variable-share', `${formatPercent(state.price ? r.variableCostPerOrder / state.price : 0)} от среднего чека`);
    text('preview-contribution', formatMoney(r.contributionPerOrder));
    text('preview-contribution-share', `${formatPercent(r.contributionMargin)} маржинальность`);
    document.getElementById('contribution-preview-card').classList.toggle('negative', r.contributionPerOrder <= 0);

    text('kpi-revenue', compactMoney(r.totals.revenue));
    text('kpi-revenue-note', `${formatNumber(r.totals.orders)} заказов`);
    text('kpi-operating-profit', compactMoney(r.totals.operatingProfit));
    text('kpi-funding', compactMoney(r.fundingRequirement));
    text('kpi-payback', r.paybackMonth === 0 ? 'Сразу' : r.paybackMonth ? `Месяц ${r.paybackMonth}` : 'Не достигнута');
    text('kpi-payback-note', r.paybackMonth === null ? 'В горизонте 12 месяцев' : 'По накопленному потоку');
    text('kpi-cash-result', compactMoney(r.cashResult));
    text('kpi-rt-income', compactMoney(r.totals.rtCost));
    text('kpi-operating-margin', formatPercent(r.operatingMargin));
    text('kpi-roi', r.roi === null ? (r.cashResult >= 0 ? 'Не требуется' : '-') : formatPercent(r.roi));
    valueClass('[data-kpi-card="operating"]', r.totals.operatingProfit);
    valueClass('[data-kpi-card="funding"]', r.fundingRequirement === 0 ? 1 : 0);
    valueClass('[data-kpi-card="payback"]', r.paybackMonth === null ? -1 : 1);
    valueClass('[data-kpi-card="cash"]', r.cashResult);
    valueClass('[data-kpi-card="rt"]', r.totals.rtCost);
    valueClass('[data-kpi-card="margin"]', r.operatingMargin);
    valueClass('[data-kpi-card="roi"]', r.roi === null ? r.cashResult : r.roi);

    text('unit-price', formatMoney(state.price));
    text('unit-variable', formatMoney(r.variableCostPerOrder));
    text('unit-contribution', formatMoney(r.contributionPerOrder));
    text('unit-margin', formatPercent(r.contributionMargin));
    text('unit-break-even', r.breakEvenOrders === null ? 'Недостижима' : `${formatNumber(r.breakEvenOrders)} заказов`);
    text('unit-break-even-revenue', r.breakEvenRevenue === null ? '-' : compactMoney(r.breakEvenRevenue));
    text('cash-min', compactMoney(r.minimumCash));
    text('cash-end', compactMoney(r.cashResult));

    const maxOrders = Math.max(...state.orders, 1);
    monthInputs.forEach((input,i) => input.closest('.month-field').style.setProperty('--month-scale', Math.max(.04, state.orders[i] / maxOrders).toFixed(4)));
    renderSummary(r); renderWarning(r); renderTable(r); drawCharts(r); updateScenarioButtons(); save();
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(300, Math.round(rect.width));
    const height = Math.max(220, Math.round(rect.height));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
    return {ctx,width,height};
  }

  function drawGrid(ctx,width,height,pad,min,max,steps=5) {
    const y = value => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
    ctx.font = '9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i=0;i<=steps;i++) {
      const value = max - (max-min)*i/steps, py = y(value);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(pad.left,py); ctx.lineTo(width-pad.right,py); ctx.stroke();
      ctx.fillStyle = 'rgba(154,165,184,.75)'; ctx.fillText(axisMoney(value),pad.left-7,py);
    }
    return y;
  }

  function drawMonthly(r) {
    const {ctx,width,height} = setupCanvas(document.getElementById('monthly-chart'));
    const pad={top:24,right:10,bottom:38,left:48}, vals=r.rows.flatMap(x=>[x.revenue,x.totalExpenses,x.operatingProfit]);
    let max=Math.max(...vals,1), min=Math.min(0,...r.rows.map(x=>x.operatingProfit)), range=Math.max(1,max-min); max+=range*.08; min-=range*.05;
    const y=drawGrid(ctx,width,height,pad,min,max), zero=y(0), chartW=width-pad.left-pad.right, slot=chartW/12, bw=Math.max(4,Math.min(13,slot*.25));
    r.rows.forEach((row,i)=>{const cx=pad.left+slot*i+slot/2;ctx.fillStyle='rgba(90,174,255,.82)';ctx.fillRect(cx-bw-2,y(row.revenue),bw,Math.max(1,zero-y(row.revenue)));ctx.fillStyle='rgba(125,109,255,.8)';ctx.fillRect(cx+2,y(row.totalExpenses),bw,Math.max(1,zero-y(row.totalExpenses)));ctx.fillStyle='rgba(154,165,184,.8)';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(MONTHS[i],cx,height-pad.bottom+13)});
    ctx.strokeStyle='#6ff0c2';ctx.lineWidth=2;ctx.beginPath();r.rows.forEach((row,i)=>{const px=pad.left+slot*i+slot/2,py=y(row.operatingProfit);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke();
  }

  function drawCash(r) {
    const {ctx,width,height}=setupCanvas(document.getElementById('cash-chart'));
    const pad={top:24,right:12,bottom:38,left:45}, values=[-state.startupInvestment,...r.rows.map(x=>x.cumulativeCash)];
    let max=Math.max(0,...values),min=Math.min(0,...values),range=Math.max(1,max-min);max+=range*.08;min-=range*.08;
    const y=drawGrid(ctx,width,height,pad,min,max,4),chartW=width-pad.left-pad.right,x=i=>pad.left+chartW*i/(values.length-1),zero=y(0);
    const gradient=ctx.createLinearGradient(0,pad.top,0,height-pad.bottom);gradient.addColorStop(0,'rgba(104,231,255,.2)');gradient.addColorStop(1,'rgba(125,109,255,.02)');ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.lineTo(x(values.length-1),zero);ctx.lineTo(x(0),zero);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ctx.strokeStyle='#68e7ff';ctx.lineWidth=2.2;ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.stroke();
    values.forEach((v,i)=>{ctx.fillStyle=v>=0?'#6ff0c2':'#ff7e91';ctx.beginPath();ctx.arc(x(i),y(v),2.4,0,Math.PI*2);ctx.fill()});
    ctx.fillStyle='rgba(154,165,184,.8)';ctx.textAlign='center';ctx.textBaseline='top';for(let i=1;i<values.length;i++){if(width<390&&i%2&&i<12)continue;ctx.fillText(MONTHS[i-1],x(i),height-pad.bottom+13)}
  }
  function drawCharts(r) { drawMonthly(r); drawCash(r); }

  function csvEscape(value) { const s=String(value??''); return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
  function exportCsv() {
    const r=latest||calculate(), rows=[['ФИНАНСОВАЯ МОДЕЛЬ MVP','Желание сквозь Вселенную'],[],['Вводная','Значение'],['Средний чек, руб.',state.price],['Доля РТ-64, %',state.rtShare],['Маркетинг, %',state.marketingShare],['Эквайринг, %',state.acquiringShare],['ИТ и сопровождение на заказ, руб.',state.serviceCost],['Постоянные расходы в месяц, руб.',state.fixedCosts],['Стартовые инвестиции, руб.',state.startupInvestment],[],['Период','Заказы','Выручка','РТ-64','Маркетинг','Эквайринг','ИТ и сопровождение','Постоянные расходы','Все расходы','Операционная прибыль','Накопленный поток']];
    r.rows.forEach(x=>rows.push([`М${x.month}`,x.orders,Math.round(x.revenue),Math.round(x.rtCost),Math.round(x.marketingCost),Math.round(x.acquiringCost),Math.round(x.serviceCost),Math.round(x.fixedCosts),Math.round(x.totalExpenses),Math.round(x.operatingProfit),Math.round(x.cumulativeCash)]));
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvEscape).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Jelanie_finmodel_MVP_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);showToast('Расчет CSV сформирован');
  }
  function showToast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200)}

  modelInputs.forEach(input=>{input.addEventListener('input',()=>{state[input.dataset.model]=nonNegative(input.value);render()});input.addEventListener('blur',()=>input.value=state[input.dataset.model])});
  monthInputs.forEach(input=>{input.addEventListener('input',()=>{state.orders[Number(input.dataset.month)]=Math.round(nonNegative(input.value));render()});input.addEventListener('blur',()=>input.value=state.orders[Number(input.dataset.month)])});
  scenarioButtons.forEach(button=>button.addEventListener('click',()=>{state=clone(scenarios[button.dataset.scenario]);syncInputs();render();showToast(`Сценарий «${button.textContent.trim()}» применен`)}));
  document.getElementById('reset-model').addEventListener('click',()=>{state=clone(scenarios.base);syncInputs();render();showToast('Базовые значения восстановлены')});
  document.getElementById('export-csv').addEventListener('click',exportCsv);document.getElementById('export-csv-secondary').addEventListener('click',exportCsv);document.getElementById('print-model').addEventListener('click',()=>window.print());
  const navToggle=document.getElementById('nav-toggle'),nav=document.getElementById('main-nav');navToggle.addEventListener('click',()=>{const active=navToggle.classList.toggle('active');nav.classList.toggle('active',active);navToggle.setAttribute('aria-expanded',String(active))});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{navToggle.classList.remove('active');nav.classList.remove('active');navToggle.setAttribute('aria-expanded','false')}));
  window.addEventListener('scroll',()=>document.querySelector('.site-header').classList.toggle('scrolled',window.scrollY>12),{passive:true});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>latest&&drawCharts(latest),120)});
  syncInputs();render();
})();
