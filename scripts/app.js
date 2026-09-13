/* ============================= SETUP ============================= */
if (typeof Chart === 'undefined') {
  document.body.innerHTML = '<div style="padding:60px 24px; font-family:sans-serif; color:#E7EAEE; background:#0E1217; min-height:100vh;">' +
    '<h2 style="margin-bottom:10px;">Dashboard failed to initialize</h2>' +
    '<p style="color:#9AA5B1;">The charting library did not load. Try reloading the file, or open it in a different browser.</p></div>';
  throw new Error('Chart.js failed to load — aborting dashboard init.');
}
const L = DATA.lookups;
const RC = DATA.record_cols;
const IDX = Object.fromEntries(RC.map((c,i)=>[c,i]));
const RECORDS = DATA.records;
const VALID_STATUSES_EXCLUDE = ['Cancelled','Returned'];
const isValidRow = r => !VALID_STATUSES_EXCLUDE.includes(L.status[r[IDX.status]]);

Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#9AA5B1';
Chart.defaults.borderColor = '#262F3A';
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.animation = false; // performance: skip animation on frequent filter re-renders

const PALETTE = ['#4FD1C5','#F0A857','#9B8CF2','#6FCF97','#E5626B','#5B9BD5','#D9A441','#7FD9E8'];
const gridOpt = { color:'#1E2630' };

function fmtMoney(v, compact=true){
  if(v===null||v===undefined||isNaN(v)) return '—';
  const sign = v<0 ? '-' : '';
  v = Math.abs(v);
  if(compact){
    if(v>=1e9) return sign+'$'+(v/1e9).toFixed(2)+'B';
    if(v>=1e6) return sign+'$'+(v/1e6).toFixed(2)+'M';
    if(v>=1e3) return sign+'$'+(v/1e3).toFixed(1)+'K';
  }
  return sign+'$'+v.toLocaleString('en-US',{maximumFractionDigits:0});
}
function fmtNum(v){ if(v===null||v===undefined||isNaN(v)) return '—'; return Math.round(v).toLocaleString('en-US'); }
function fmtPct(v,d=1){ if(v===null||v===undefined||isNaN(v)||!isFinite(v)) return '—'; return v.toFixed(d)+'%'; }
function fmtDate(v){ if(!v) return '—'; const [y,m,d]=v.split('-'); const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${d} ${MN[parseInt(m,10)-1]} ${y}`; }
function slug(s){ return String(s).replace(/[^a-zA-Z0-9]+/g,'-'); }
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ============================= DATE UTILITIES (UTC-safe, string based) ============================= */
function toUTC(dateStr){ const [y,m,d]=dateStr.split('-').map(Number); return Date.UTC(y,m-1,d); }
function fromUTC(ts){ return new Date(ts).toISOString().slice(0,10); }
function addDays(dateStr, days){ return fromUTC(toUTC(dateStr)+days*86400000); }
function daysBetween(a,b){ return Math.round((toUTC(b)-toUTC(a))/86400000); }
function daysInMonth(y,m){ return new Date(Date.UTC(y,m,0)).getUTCDate(); }
function startOfMonth(dateStr){ const [y,m]=dateStr.split('-'); return `${y}-${m}-01`; }
function startOfQuarter(dateStr){ const [y,m]=dateStr.split('-').map(Number); const sm=Math.floor((m-1)/3)*3+1; return `${y}-${String(sm).padStart(2,'0')}-01`; }
function startOfYear(dateStr){ return `${dateStr.split('-')[0]}-01-01`; }
function shiftYear(dateStr, delta){ let [y,m,d]=dateStr.split('-').map(Number); y+=delta; d=Math.min(d, daysInMonth(y,m)); return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function shiftMonth(dateStr, delta){ let [y,m,d]=dateStr.split('-').map(Number); m+=delta; while(m>12){m-=12;y++;} while(m<1){m+=12;y--;} d=Math.min(d,daysInMonth(y,m)); return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function isoWeekStart(dateStr){ const t=toUTC(dateStr); const dow=(new Date(t).getUTCDay()+6)%7; return fromUTC(t-dow*86400000); }
function quarterLabel(dateStr){ const [y,m]=dateStr.split('-').map(Number); return `${y}-Q${Math.floor((m-1)/3)+1}`; }

/* Returns {curFrom,curTo,prevFrom,prevTo,pyFrom,pyTo,label} for a given period mode */
function getEffectiveRange(mode, filterFrom, filterTo){
  const asOf = DATA.meta.date_max;
  let curFrom, curTo, prevFrom, prevTo, pyFrom, pyTo, label;
  if(mode==='mtd'){
    curFrom = startOfMonth(asOf); curTo = asOf;
    prevFrom = shiftMonth(curFrom,-1); prevTo = shiftMonth(curTo,-1);
    pyFrom = shiftYear(curFrom,-1); pyTo = shiftYear(curTo,-1);
    label = 'Month to Date';
  } else if(mode==='qtd'){
    curFrom = startOfQuarter(asOf); curTo = asOf;
    prevFrom = shiftMonth(curFrom,-3); prevTo = shiftMonth(curTo,-3);
    pyFrom = shiftYear(curFrom,-1); pyTo = shiftYear(curTo,-1);
    label = 'Quarter to Date';
  } else if(mode==='ytd'){
    curFrom = startOfYear(asOf); curTo = asOf;
    prevFrom = shiftYear(curFrom,-1); prevTo = shiftYear(curTo,-1);
    pyFrom = prevFrom; pyTo = prevTo;
    label = 'Year to Date';
  } else {
    curFrom = filterFrom; curTo = filterTo;
    const len = daysBetween(curFrom,curTo)+1;
    prevTo = addDays(curFrom,-1); prevFrom = addDays(prevTo, -(len-1));
    pyFrom = shiftYear(curFrom,-1); pyTo = shiftYear(curTo,-1);
    label = 'Custom Range';
  }
  return {curFrom,curTo,prevFrom,prevTo,pyFrom,pyTo,label};
}

/* ============================= FILTER STATE ============================= */
const state = {
  dateFrom: DATA.meta.date_min, dateTo: DATA.meta.date_max,
  category:'All', subcategory:'All', region:'All', country:'All', segment:'All', channel:'All', status:'All',
  search:'', sortCol:'date', sortDir:'desc', page:1, pageSize:25,
  visibleCols: {order_id:true,date:true,category:true,subcategory:true,country:true,qty:true,sales:true,profit:true,status:true,payment:false,channel:false,discount:false,unit_price:false,processing_days:false},
  periodMode:'custom', compareMode:'prev_period',
  trendMetric:'sales', trendGranularity:'month', trendCompare:'none',
  productSort:'sales',
};

function buildSelect(id, label, options, dependentNote){
  return `<span class="flabel">${label}</span><select id="${id}"><option value="All">All</option>${options.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
}
function renderFilterBar(){
  const fb = document.getElementById('filterbar');
  const countryOptions = state.region==='All' ? L.country : L.country.filter(c=>countryToRegion[c]===state.region);
  const subOptions = state.category==='All' ? L.subcategory : subcatByCategory[state.category] || [];
  fb.innerHTML = `
    <span class="flabel">Date</span>
    <input type="date" id="fDateFrom" value="${state.dateFrom}" min="${DATA.meta.date_min}" max="${DATA.meta.date_max}">
    <span style="color:var(--text-dim)">→</span>
    <input type="date" id="fDateTo" value="${state.dateTo}" min="${DATA.meta.date_min}" max="${DATA.meta.date_max}">
    ${buildSelect('fCategory','Category', L.category)}
    ${buildSelect('fSubcategory','Sub-Cat', subOptions)}
    ${buildSelect('fRegion','Region', L.region)}
    ${buildSelect('fCountry','Country', countryOptions)}
    ${buildSelect('fSegment','Segment', L.segment)}
    ${buildSelect('fChannel','Channel', L.channel)}
    ${buildSelect('fStatus','Status', L.status)}
    <button class="filter-reset" id="fReset">Reset All</button>
    <span class="filter-count" id="fCount"></span>
  `;
  document.getElementById('fCategory').value = state.category;
  document.getElementById('fSubcategory').value = state.subcategory;
  document.getElementById('fRegion').value = state.region;
  document.getElementById('fCountry').value = state.country;
  document.getElementById('fSegment').value = state.segment;
  document.getElementById('fChannel').value = state.channel;
  document.getElementById('fStatus').value = state.status;
  ['fDateFrom','fDateTo','fCategory','fSubcategory','fRegion','fCountry','fSegment','fChannel','fStatus'].forEach(id=>{
    document.getElementById(id).addEventListener('change', onFilterChange);
  });
  document.getElementById('fReset').addEventListener('click', resetAllFilters);
}
function resetAllFilters(){
  state.dateFrom = DATA.meta.date_min; state.dateTo = DATA.meta.date_max;
  state.category='All'; state.subcategory='All'; state.region='All'; state.country='All';
  state.segment='All'; state.channel='All'; state.status='All'; state.page=1;
  renderFilterBar(); applyFiltersAndRender();
}
function onFilterChange(){
  const newCategory = document.getElementById('fCategory').value;
  if(newCategory !== state.category) state.subcategory = 'All';
  const newRegion = document.getElementById('fRegion').value;
  if(newRegion !== state.region) state.country = 'All';
  state.dateFrom = document.getElementById('fDateFrom').value;
  state.dateTo = document.getElementById('fDateTo').value;
  state.category = newCategory;
  state.subcategory = document.getElementById('fSubcategory').value;
  state.region = newRegion;
  state.country = document.getElementById('fCountry').value;
  state.segment = document.getElementById('fSegment').value;
  state.channel = document.getElementById('fChannel').value;
  state.status = document.getElementById('fStatus').value;
  state.page = 1;
  renderFilterBar(); // rebuild dependent dropdowns (subcategory/country options)
  applyFiltersAndRender();
}
function clearFilter(key){
  state[key] = 'All';
  if(key==='category') state.subcategory='All';
  if(key==='region') state.country='All';
  if(key==='dateRange'){ state.dateFrom = DATA.meta.date_min; state.dateTo = DATA.meta.date_max; }
  renderFilterBar(); applyFiltersAndRender();
}
function renderChips(){
  const chips = [];
  if(state.dateFrom!==DATA.meta.date_min || state.dateTo!==DATA.meta.date_max)
    chips.push({key:'dateRange', label:`Date: ${fmtDate(state.dateFrom)} → ${fmtDate(state.dateTo)}`});
  if(state.category!=='All') chips.push({key:'category', label:`Category: ${state.category}`});
  if(state.subcategory!=='All') chips.push({key:'subcategory', label:`Sub-Cat: ${state.subcategory}`});
  if(state.region!=='All') chips.push({key:'region', label:`Region: ${state.region}`});
  if(state.country!=='All') chips.push({key:'country', label:`Country: ${state.country}`});
  if(state.segment!=='All') chips.push({key:'segment', label:`Segment: ${state.segment}`});
  if(state.channel!=='All') chips.push({key:'channel', label:`Channel: ${state.channel}`});
  if(state.status!=='All') chips.push({key:'status', label:`Status: ${state.status}`});
  const el = document.getElementById('chipRow');
  if(chips.length===0){ el.innerHTML = `<span class="chip-empty">No filters active — showing all ${RECORDS.length.toLocaleString()} records</span>`; return; }
  el.innerHTML = `<span class="chip-empty">FILTERS:</span>` + chips.map(c=>`<span class="chip"><b>${esc(c.label)}</b><span class="x" data-key="${c.key}">✕</span></span>`).join('');
  el.querySelectorAll('.x').forEach(x=>x.addEventListener('click', ()=>clearFilter(x.dataset.key)));
}

/* Precompute lookup maps used for dependent dropdowns and drill-downs */
const countryToRegion = {};
RECORDS.forEach(r=>{ countryToRegion[L.country[r[IDX.country]]] = L.region[r[IDX.region]]; });
const subcatByCategory = {};
RECORDS.forEach(r=>{
  const cat = L.category[r[IDX.cat]], sub = L.subcategory[r[IDX.subcat]];
  if(!subcatByCategory[cat]) subcatByCategory[cat] = new Set();
  subcatByCategory[cat].add(sub);
});
Object.keys(subcatByCategory).forEach(k=> subcatByCategory[k] = [...subcatByCategory[k]].sort());
const customerFirstOrder = new Map();
RECORDS.forEach(r=>{
  const cid = r[IDX.customer_id], d = r[IDX.date];
  if(!customerFirstOrder.has(cid) || d < customerFirstOrder.get(cid)) customerFirstOrder.set(cid, d);
});

/* ============================= TABS ============================= */
const TABS = [
  {id:'overview', label:'Overview'}, {id:'trends', label:'Trends'}, {id:'products', label:'Products'},
  {id:'customers', label:'Customers'}, {id:'segments', label:'Segments'}, {id:'geo', label:'Geography'},
  {id:'profitability', label:'Profitability'}, {id:'operations', label:'Operations'},
  {id:'advanced', label:'Advanced Analytics'}, {id:'quality', label:'Data Quality'},
  {id:'insights', label:'Insights'}, {id:'table', label:'Detail Table'},
];
let activeTab = 'overview';
function renderTabs(){
  document.getElementById('tabs').innerHTML = TABS.map(t=>
    `<div class="tab ${t.id===activeTab?'active':''}" data-tab="${t.id}">${t.label}</div>`
  ).join('');
  document.querySelectorAll('.tab').forEach(el=>{
    el.addEventListener('click', ()=>{ activeTab = el.dataset.tab; renderTabs(); renderView(); });
  });
}
function goToTab(t){ activeTab = t; renderTabs(); renderView(); }

const chartInstances = {};
function makeChart(canvasId, config){
  const ctx = document.getElementById(canvasId);
  if(!ctx) return;
  if(chartInstances[canvasId]) chartInstances[canvasId].destroy();
  chartInstances[canvasId] = new Chart(ctx, config);
  return chartInstances[canvasId];
}

/* Lightweight inline SVG sparkline (avoids one Chart.js instance per KPI card) */
function sparkline(values, color){
  if(!values || values.length<2 || values.every(v=>v===0)) return `<div style="height:28px;"></div>`;
  const w=140,h=28,pad=2;
  const min=Math.min(...values), max=Math.max(...values);
  const range = (max-min)||1;
  const pts = values.map((v,i)=>{
    const x = pad + i*(w-2*pad)/(values.length-1);
    const y = h-pad - (v-min)/range*(h-2*pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length-1], first = values[0];
  const c = color || (last>=first ? '#4FD1C5' : '#E5626B');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6"/></svg>`;
}

/* ============================= GENERIC AGGREGATION HELPERS ============================= */
function inDateRange(r, from, to){ return r[IDX.date]>=from && r[IDX.date]<=to; }

/* Filters records by every state filter EXCEPT date */
function applyNonDateFilters(records){
  return records.filter(r=>{
    if(state.category!=='All' && L.category[r[IDX.cat]]!==state.category) return false;
    if(state.subcategory!=='All' && L.subcategory[r[IDX.subcat]]!==state.subcategory) return false;
    if(state.region!=='All' && L.region[r[IDX.region]]!==state.region) return false;
    if(state.country!=='All' && L.country[r[IDX.country]]!==state.country) return false;
    if(state.segment!=='All' && L.segment[r[IDX.seg]]!==state.segment) return false;
    if(state.channel!=='All' && L.channel[r[IDX.channel]]!==state.channel) return false;
    if(state.status!=='All' && L.status[r[IDX.status]]!==state.status) return false;
    return true;
  });
}
let NODATE = RECORDS, FILTERED = RECORDS;
function computeFiltered(){
  NODATE = applyNonDateFilters(RECORDS);
  FILTERED = NODATE.filter(r=>inDateRange(r, state.dateFrom, state.dateTo));
  const cEl = document.getElementById('fCount');
  if(cEl) cEl.innerHTML = `<b>${FILTERED.length.toLocaleString()}</b> / ${RECORDS.length.toLocaleString()} records`;
  renderChips();
}

function groupSum(records, keyIdx, keyLookup, valIdx, excludeInvalid=true){
  const m = new Map();
  for(const r of records){
    if(excludeInvalid && !isValidRow(r)) continue;
    const k = keyLookup ? keyLookup[r[keyIdx]] : r[keyIdx];
    const cur = m.get(k) || {sum:0, count:0, profit:0, cost:0};
    cur.sum += r[valIdx]; cur.count += 1; cur.profit += r[IDX.profit]; cur.cost += r[IDX.cost];
    m.set(k, cur);
  }
  return m;
}
function kpiSetFor(records){
  const total = records.length;
  const valid = records.filter(isValidRow);
  const revenue = valid.reduce((a,r)=>a+r[IDX.sales],0);
  const profit = valid.reduce((a,r)=>a+r[IDX.profit],0);
  const units = valid.reduce((a,r)=>a+r[IDX.qty],0);
  const cancelled = records.filter(r=>L.status[r[IDX.status]]==='Cancelled').length;
  const returned = records.filter(r=>L.status[r[IDX.status]]==='Returned').length;
  const custSet = new Set(records.map(r=>r[IDX.customer_id]));
  return {
    totalOrders: total, validOrders: valid.length,
    revenue, profit, margin: revenue? 100*profit/revenue : null,
    aov: valid.length? revenue/valid.length : null,
    uniqueCustomers: custSet.size, units,
    returnRate: total? 100*returned/total : null,
    cancelRate: total? 100*cancelled/total : null,
  };
}
function pctChange(cur, prev){ if(prev===null||prev===undefined||prev===0||cur===null) return null; return 100*(cur-prev)/Math.abs(prev); }

/* ============================= OVERVIEW ============================= */
function tplOverview(){
  return `
    <div class="section-title">Executive Overview</div>
    <div class="toggle-row">
      <span class="tlabel">Period</span>
      <div class="toggle-group" id="periodToggle">
        ${[['custom','Custom Range'],['mtd','MTD'],['qtd','QTD'],['ytd','YTD']].map(([k,l])=>`<button data-v="${k}" class="${state.periodMode===k?'active':''}">${l}</button>`).join('')}
      </div>
      <span class="tlabel">Compare vs</span>
      <div class="toggle-group" id="compareToggle">
        ${[['prev_period','Previous Period'],['prev_year','Previous Year']].map(([k,l])=>`<button data-v="${k}" class="${state.compareMode===k?'active':''}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="desc" id="periodRangeLabel" style="margin-bottom:14px;"></div>
    <div class="grid g-kpi" id="kpiGrid"></div>
    <div class="section-title">Snapshot</div>
    <div class="grid g-3">
      <div class="card"><h3>Revenue by Category</h3><div class="desc">Current period, valid orders only</div><div class="chart-wrap short"><canvas id="ovCat"></canvas></div></div>
      <div class="card"><h3>Top Regions</h3><div class="desc">Sales by region</div><div class="chart-wrap short"><canvas id="ovRegion"></canvas></div></div>
      <div class="card"><h3>Order Status Mix</h3><div class="desc">Share of all orders</div><div class="chart-wrap short"><canvas id="ovStatus"></canvas></div></div>
    </div>
    <div class="section-title">Revenue Trend</div>
    <div class="card"><div class="chart-wrap"><canvas id="ovTrend"></canvas></div></div>
  `;
}
function afterOverview(){
  document.querySelectorAll('#periodToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.periodMode=b.dataset.v; renderView(); }));
  document.querySelectorAll('#compareToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.compareMode=b.dataset.v; renderView(); }));

  const rng = getEffectiveRange(state.periodMode, state.dateFrom, state.dateTo);
  document.getElementById('periodRangeLabel').textContent =
    `${rng.label}: ${fmtDate(rng.curFrom)} → ${fmtDate(rng.curTo)}  ·  compared to ${state.compareMode==='prev_year' ? fmtDate(rng.pyFrom)+' → '+fmtDate(rng.pyTo) : fmtDate(rng.prevFrom)+' → '+fmtDate(rng.prevTo)}`;

  const curRecs = NODATE.filter(r=>inDateRange(r, rng.curFrom, rng.curTo));
  const prevRecs = NODATE.filter(r=>inDateRange(r, state.compareMode==='prev_year'?rng.pyFrom:rng.prevFrom, state.compareMode==='prev_year'?rng.pyTo:rng.prevTo));
  const cur = kpiSetFor(curRecs), prev = kpiSetFor(prevRecs);
  const compareLabel = state.compareMode==='prev_year' ? 'vs prior year' : 'vs previous period';

  // weekly series for sparklines, spanning the current period
  function weeklySeries(records, metricFn){
    const buckets = new Map();
    records.forEach(r=>{ const wk = isoWeekStart(r[IDX.date]); if(!buckets.has(wk)) buckets.set(wk, []); buckets.get(wk).push(r); });
    const weeks = [...buckets.keys()].sort();
    return weeks.map(w=>metricFn(buckets.get(w)));
  }
  const revSpark = weeklySeries(curRecs, rs=>rs.filter(isValidRow).reduce((a,r)=>a+r[IDX.sales],0));
  const profSpark = weeklySeries(curRecs, rs=>rs.filter(isValidRow).reduce((a,r)=>a+r[IDX.profit],0));
  const ordSpark = weeklySeries(curRecs, rs=>rs.length);
  const marginSpark = weeklySeries(curRecs, rs=>{ const v=rs.filter(isValidRow); const rev=v.reduce((a,r)=>a+r[IDX.sales],0); const pr=v.reduce((a,r)=>a+r[IDX.profit],0); return rev? 100*pr/rev : 0; });

  function kpiCard(label, val, curNum, prevNum, sub, sparkVals){
    const delta = pctChange(curNum, prevNum);
    const isNeg = delta!==null && delta<0;
    const arrow = delta===null ? '' : (delta>=0 ? '▲' : '▼');
    const cls = delta===null ? '' : (delta>=0 ? 'pos' : 'neg');
    return `<div class="kpi ${isNeg?'neg':''}">
      <div class="klabel">${label}</div>
      <div class="kval">${val}</div>
      <div class="ktrend"><span class="arrow ksub ${cls}">${arrow} ${delta===null?'—':Math.abs(delta).toFixed(1)+'%'}</span><span class="kcompare">${compareLabel}</span></div>
      ${sub?`<div class="kcompare">${sub}</div>`:''}
      <div class="kspark">${sparkVals?sparkline(sparkVals):''}</div>
    </div>`;
  }

  document.getElementById('kpiGrid').innerHTML = [
    kpiCard('Total Revenue', fmtMoney(cur.revenue), cur.revenue, prev.revenue, null, revSpark),
    kpiCard('Total Profit', fmtMoney(cur.profit), cur.profit, prev.profit, null, profSpark),
    kpiCard('Profit Margin %', fmtPct(cur.margin), cur.margin, prev.margin, null, marginSpark),
    kpiCard('Total Orders', fmtNum(cur.totalOrders), cur.totalOrders, prev.totalOrders, null, ordSpark),
    kpiCard('Valid Orders', fmtNum(cur.validOrders), cur.validOrders, prev.validOrders, `${fmtPct(100*cur.validOrders/(cur.totalOrders||1))} of total`),
    kpiCard('Avg Order Value', fmtMoney(cur.aov,false), cur.aov, prev.aov, null),
    kpiCard('Unique Customers', fmtNum(cur.uniqueCustomers), cur.uniqueCustomers, prev.uniqueCustomers),
    kpiCard('Units Sold', fmtNum(cur.units), cur.units, prev.units),
    kpiCard('Return Rate', fmtPct(cur.returnRate), cur.returnRate, prev.returnRate),
    kpiCard('Cancellation Rate', fmtPct(cur.cancelRate), cur.cancelRate, prev.cancelRate),
  ].join('');

  const catMap = groupSum(curRecs, IDX.cat, L.category, IDX.sales);
  const catArr = [...catMap.entries()].sort((a,b)=>b[1].sum-a[1].sum);
  makeChart('ovCat', {type:'bar', data:{labels:catArr.map(d=>d[0]), datasets:[{data:catArr.map(d=>d[1].sum), backgroundColor:PALETTE[0], borderRadius:2}]},
    options:{indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw,false)}}}, scales:{x:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}, y:{grid:{display:false}}}}});

  const regMap = groupSum(curRecs, IDX.region, L.region, IDX.sales);
  const regArr = [...regMap.entries()].sort((a,b)=>b[1].sum-a[1].sum);
  makeChart('ovRegion', {type:'bar', data:{labels:regArr.map(d=>d[0]), datasets:[{data:regArr.map(d=>d[1].sum), backgroundColor:PALETTE[1], borderRadius:2}]},
    options:{indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw,false)}}}, scales:{x:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}, y:{grid:{display:false}, ticks:{autoSkip:false}}}}});

  const statMap = new Map();
  curRecs.forEach(r=>{ const s=L.status[r[IDX.status]]; statMap.set(s,(statMap.get(s)||0)+1); });
  const statArr = [...statMap.entries()];
  makeChart('ovStatus', {type:'doughnut', data:{labels:statArr.map(d=>d[0]), datasets:[{data:statArr.map(d=>d[1]), backgroundColor:PALETTE, borderColor:'#0E1217', borderWidth:2}]},
    options:{plugins:{legend:{position:'bottom'}}, cutout:'62%'}});

  const monthMap = new Map();
  FILTERED.filter(isValidRow).forEach(r=>{ const m = r[IDX.date].slice(0,7); monthMap.set(m, (monthMap.get(m)||0)+r[IDX.sales]); });
  const months = [...monthMap.keys()].sort();
  makeChart('ovTrend', {type:'line', data:{labels:months, datasets:[{label:'Revenue', data:months.map(m=>monthMap.get(m)), borderColor:PALETTE[0], backgroundColor:'rgba(79,209,197,0.08)', fill:true, tension:.3, pointRadius:0, borderWidth:2}]},
    options:{plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw)}}}, scales:{x:{grid:{display:false}}, y:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}}}});
}

/* ============================= TRENDS ============================= */
const METRIC_DEFS = {
  sales:{label:'Revenue', fmt:v=>fmtMoney(v), agg:rs=>rs.filter(isValidRow).reduce((a,r)=>a+r[IDX.sales],0)},
  profit:{label:'Profit', fmt:v=>fmtMoney(v), agg:rs=>rs.filter(isValidRow).reduce((a,r)=>a+r[IDX.profit],0)},
  orders:{label:'Orders', fmt:v=>fmtNum(v), agg:rs=>rs.filter(isValidRow).length},
  customers:{label:'Customers', fmt:v=>fmtNum(v), agg:rs=>new Set(rs.map(r=>r[IDX.customer_id])).size},
  margin:{label:'Margin %', fmt:v=>fmtPct(v), agg:rs=>{ const v=rs.filter(isValidRow); const rev=v.reduce((a,r)=>a+r[IDX.sales],0); const pr=v.reduce((a,r)=>a+r[IDX.profit],0); return rev? 100*pr/rev : 0; }},
};
function bucketKey(dateStr, granularity){
  if(granularity==='day') return dateStr;
  if(granularity==='week') return isoWeekStart(dateStr);
  if(granularity==='month') return dateStr.slice(0,7);
  if(granularity==='quarter') return quarterLabel(dateStr);
  if(granularity==='year') return dateStr.slice(0,4);
  return dateStr.slice(0,7);
}
function buildSeries(records, granularity){
  const buckets = new Map();
  records.forEach(r=>{ const k = bucketKey(r[IDX.date], granularity); if(!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); });
  const keys = [...buckets.keys()].sort();
  const out = {};
  Object.keys(METRIC_DEFS).forEach(m=> out[m] = keys.map(k=>METRIC_DEFS[m].agg(buckets.get(k))));
  return {labels:keys, values:out};
}
function tplTrends(){
  return `
    <div class="section-title">Revenue &amp; Profit Trends</div>
    <div class="toggle-row">
      <span class="tlabel">Metric</span>
      <div class="toggle-group" id="metricToggle">${Object.entries(METRIC_DEFS).map(([k,d])=>`<button data-v="${k}" class="${state.trendMetric===k?'active':''}">${d.label}</button>`).join('')}</div>
      <span class="tlabel">Granularity</span>
      <div class="toggle-group" id="granToggle">${[['day','Day'],['week','Week'],['month','Month'],['quarter','Quarter'],['year','Year']].map(([k,l])=>`<button data-v="${k}" class="${state.trendGranularity===k?'active':''}">${l}</button>`).join('')}</div>
      <span class="tlabel">Compare</span>
      <div class="toggle-group" id="cmpToggle">${[['none','None'],['prev_period','Prev. Period'],['prev_year','Prev. Year']].map(([k,l])=>`<button data-v="${k}" class="${state.trendCompare===k?'active':''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card"><div class="chart-wrap tall"><canvas id="trMain"></canvas></div></div>
    <div class="section-title">Order Volume</div>
    <div class="card"><div class="chart-wrap short"><canvas id="trOrders"></canvas></div></div>
  `;
}
function afterTrends(){
  document.querySelectorAll('#metricToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.trendMetric=b.dataset.v; renderView(); }));
  document.querySelectorAll('#granToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.trendGranularity=b.dataset.v; renderView(); }));
  document.querySelectorAll('#cmpToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.trendCompare=b.dataset.v; renderView(); }));

  const gran = state.trendGranularity, metric = state.trendMetric, mdef = METRIC_DEFS[metric];
  const cur = buildSeries(FILTERED, gran);
  const datasets = [{label:mdef.label, data:cur.values[metric], borderColor:PALETTE[0], backgroundColor:'rgba(79,209,197,0.08)', fill:true, tension:.25, pointRadius:cur.labels.length>60?0:2, borderWidth:2}];

  let cmpValues = null;
  if(state.trendCompare!=='none'){
    const rng = getEffectiveRange('custom', state.dateFrom, state.dateTo);
    const cmpFrom = state.trendCompare==='prev_year'?rng.pyFrom:rng.prevFrom;
    const cmpTo = state.trendCompare==='prev_year'?rng.pyTo:rng.prevTo;
    const cmpRecs = NODATE.filter(r=>inDateRange(r, cmpFrom, cmpTo));
    const cmpSeries = buildSeries(cmpRecs, gran);
    cmpValues = cmpSeries.values[metric];
    const len = Math.max(cur.labels.length, cmpValues.length);
    const aligned = cur.labels.map((_,i)=> i<cmpValues.length? cmpValues[i] : null);
    datasets.push({label: state.trendCompare==='prev_year'?'Previous Year':'Previous Period', data:aligned, borderColor:PALETTE[1], borderDash:[4,3], tension:.25, pointRadius:0, borderWidth:1.5});
  }

  // supplementary series for rich tooltip
  const revSeries = cur.values.sales, profSeries = cur.values.profit, ordSeries = cur.values.orders, marginSeries = cur.values.margin;
  makeChart('trMain', {type:'line', data:{labels:cur.labels, datasets}, options:{
    plugins:{legend:{position:'top'}, tooltip:{callbacks:{
      label:(c)=> c.dataset.label+': '+mdef.fmt(c.raw),
      afterBody:(items)=>{
        const i = items[0].dataIndex;
        const growth = i>0 && revSeries[i-1] ? (100*(revSeries[i]-revSeries[i-1])/Math.abs(revSeries[i-1])).toFixed(1)+'%' : '—';
        return [`Revenue: ${fmtMoney(revSeries[i])}`, `Profit: ${fmtMoney(profSeries[i])}`, `Orders: ${fmtNum(ordSeries[i])}`, `Margin: ${fmtPct(marginSeries[i])}`, `Growth vs prior bucket: ${growth}`];
      }
    }}},
    scales:{x:{grid:{display:false}, ticks:{maxRotation:gran==='day'?60:0, autoSkip:true, maxTicksLimit:24}}, y:{grid:gridOpt, ticks:{callback:v=>mdef.fmt(v)}}}
  }});

  const ordCur = buildSeries(FILTERED, gran);
  makeChart('trOrders', {type:'bar', data:{labels:ordCur.labels, datasets:[{label:'Orders', data:ordCur.values.orders, backgroundColor:PALETTE[3], borderRadius:2}]},
    options:{plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}, ticks:{maxTicksLimit:24}}, y:{grid:gridOpt}}}});
}

/* ============================= PRODUCTS ============================= */
function tplProducts(){
  const crumbs = [`<span class="crumb" data-lvl="all">All Products</span>`];
  if(state.category!=='All') crumbs.push(`<span class="sep">›</span><span class="crumb" data-lvl="cat">${esc(state.category)}</span>`);
  if(state.subcategory!=='All') crumbs.push(`<span class="sep">›</span><span>${esc(state.subcategory)}</span>`);
  return `
    <div class="section-title">Product Analytics</div>
    <div class="breadcrumb">${crumbs.join('')}</div>
    <div class="grid g-2">
      <div class="card"><h3>${state.category==='All'?'Revenue by Category':'Revenue by Sub-Category'}</h3><div class="desc">Click a bar to drill down</div><div class="chart-wrap"><canvas id="pCat"></canvas></div></div>
      <div class="card"><h3>${state.category==='All'?'Margin % by Category':'Margin % by Sub-Category'}</h3><div class="chart-wrap"><canvas id="pMargin"></canvas></div></div>
    </div>
    <div class="section-title">Pareto Analysis — Products</div>
    <div class="card"><div class="desc" id="paretoDesc"></div><div class="chart-wrap"><canvas id="pPareto"></canvas></div></div>
    <div class="grid g-2">
      <div class="card">
        <h3>Top Products</h3>
        <div class="toggle-row" style="margin-bottom:10px;"><div class="toggle-group" id="prodSortToggle">${[['sales','Revenue'],['profit','Profit'],['qty','Units']].map(([k,l])=>`<button data-v="${k}" class="${state.productSort===k?'active':''}">${l}</button>`).join('')}</div></div>
        <div class="table-scroll"><table class="data"><thead><tr><th>Product</th><th>Category</th><th>Revenue</th><th>Profit</th><th>Units</th></tr></thead><tbody id="topProdBody"></tbody></table></div>
      </div>
      <div class="card">
        <h3>Bottom Products by Revenue</h3><div class="desc">Lowest-selling products in the current filter (min. 3 orders)</div>
        <div class="table-scroll"><table class="data"><thead><tr><th>Product</th><th>Category</th><th>Revenue</th><th>Profit</th><th>Units</th></tr></thead><tbody id="botProdBody"></tbody></table></div>
      </div>
    </div>
    <div class="card">
      <h3>Lowest-Margin Products</h3><div class="desc">Products with the weakest average profit margin (min. 3 orders)</div>
      <div class="table-scroll"><table class="data"><thead><tr><th>Product</th><th>Category</th><th>Avg Margin %</th><th>Revenue</th></tr></thead><tbody id="lowMarginBody"></tbody></table></div>
    </div>
  `;
}
function productAgg(records){
  const m = new Map();
  records.filter(isValidRow).forEach(r=>{
    const k = L.product[r[IDX.product]];
    const cur = m.get(k) || {name:k, category:L.category[r[IDX.cat]], sales:0, profit:0, qty:0, orders:0};
    cur.sales += r[IDX.sales]; cur.profit += r[IDX.profit]; cur.qty += r[IDX.qty]; cur.orders += 1;
    m.set(k, cur);
  });
  return [...m.values()];
}
function afterProducts(){
  document.querySelectorAll('.breadcrumb .crumb').forEach(c=>c.addEventListener('click', ()=>{
    if(c.dataset.lvl==='all'){ state.category='All'; state.subcategory='All'; }
    else if(c.dataset.lvl==='cat'){ state.subcategory='All'; }
    renderFilterBar(); applyFiltersAndRender();
  }));
  document.querySelectorAll('#prodSortToggle button').forEach(b=>b.addEventListener('click', ()=>{ state.productSort=b.dataset.v; renderView(); }));

  const dimIdx = state.category==='All' ? IDX.cat : IDX.subcat;
  const dimLookup = state.category==='All' ? L.category : L.subcategory;
  const dimMap = groupSum(FILTERED, dimIdx, dimLookup, IDX.sales);
  const dimArr = [...dimMap.entries()].sort((a,b)=>b[1].sum-a[1].sum);
  const catChart = makeChart('pCat', {type:'bar', data:{labels:dimArr.map(d=>d[0]), datasets:[{data:dimArr.map(d=>d[1].sum), backgroundColor:PALETTE[0], borderRadius:2}]},
    options:{indexAxis:'y', onClick:(evt,els)=>{ if(!els.length) return; const label = dimArr[els[0].index][0];
        if(state.category==='All'){ state.category = label; } else { state.subcategory = label; }
        renderFilterBar(); applyFiltersAndRender();
      },
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw,false)}}}, scales:{x:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}, y:{grid:{display:false}, ticks:{autoSkip:false}}}}});

  const marginArr = dimArr.map(([k,v])=>[k, v.sum? 100*v.profit/v.sum : 0]);
  makeChart('pMargin', {type:'bar', data:{labels:marginArr.map(d=>d[0]), datasets:[{data:marginArr.map(d=>d[1]), backgroundColor:PALETTE[2], borderRadius:2}]},
    options:{indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtPct(c.raw)}}}, scales:{x:{grid:gridOpt, ticks:{callback:v=>v+'%'}}, y:{grid:{display:false}, ticks:{autoSkip:false}}}}});

  const products = productAgg(FILTERED).sort((a,b)=>b.sales-a.sales);
  const totalRev = products.reduce((a,p)=>a+p.sales,0);
  const top20count = Math.max(1, Math.ceil(products.length*0.2));
  const top20rev = products.slice(0,top20count).reduce((a,p)=>a+p.sales,0);
  const paretoPct = totalRev? 100*top20rev/totalRev : 0;
  document.getElementById('paretoDesc').innerHTML = `The top 20% of products (${top20count} of ${products.length}) generate <b class="metric-support">${fmtPct(paretoPct)}</b> of total revenue in the current filter.`;
  let cum = 0;
  const paretoLabels = products.slice(0,20).map(p=>p.name);
  const paretoCum = products.slice(0,20).map(p=>{ cum+=p.sales; return totalRev? round1(100*cum/totalRev) : 0; });
  makeChart('pPareto', {data:{labels:paretoLabels, datasets:[
    {type:'bar', label:'Revenue', data:products.slice(0,20).map(p=>p.sales), backgroundColor:PALETTE[0], order:2},
    {type:'line', label:'Cumulative %', data:paretoCum, borderColor:PALETTE[1], yAxisID:'y1', tension:.2, pointRadius:2, order:1},
  ]}, options:{plugins:{legend:{position:'top'}}, scales:{x:{grid:{display:false}, ticks:{maxRotation:45,minRotation:45, font:{size:9}}}, y:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}, y1:{position:'right', grid:{display:false}, min:0,max:100, ticks:{callback:v=>v+'%'}}}}});

  const sortKey = state.productSort;
  const topProducts = [...products].sort((a,b)=>b[sortKey]-a[sortKey]).slice(0,15);
  document.getElementById('topProdBody').innerHTML = topProducts.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${fmtMoney(p.sales,false)}</td><td>${fmtMoney(p.profit,false)}</td><td>${fmtNum(p.qty)}</td></tr>`).join('') || emptyRow(5);

  const eligible = products.filter(p=>p.orders>=3);
  const bottomProducts = [...eligible].sort((a,b)=>a.sales-b.sales).slice(0,10);
  document.getElementById('botProdBody').innerHTML = bottomProducts.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${fmtMoney(p.sales,false)}</td><td>${fmtMoney(p.profit,false)}</td><td>${fmtNum(p.qty)}</td></tr>`).join('') || emptyRow(5);

  const lowMargin = [...eligible].map(p=>({...p, margin: p.sales? 100*p.profit/p.sales : 0})).sort((a,b)=>a.margin-b.margin).slice(0,10);
  document.getElementById('lowMarginBody').innerHTML = lowMargin.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${fmtPct(p.margin)}</td><td>${fmtMoney(p.sales,false)}</td></tr>`).join('') || emptyRow(4);
}
function round1(v){ return Math.round(v*10)/10; }
function emptyRow(cols){ return `<tr><td colspan="${cols}"><div class="empty-state">No records match the current filters.</div></td></tr>`; }

/* ============================= CUSTOMERS ============================= */
function tplCustomers(){
  return `
    <div class="section-title">Customer Intelligence</div>
    <div class="grid g-kpi" id="custKpiGrid"></div>
    <div class="section-title">RFM Segmentation <span class="badge">Full dataset — RFM requires complete purchase history</span></div>
    <div class="card">
      <div class="chart-wrap short"><canvas id="rfmChart"></canvas></div>
      <div class="table-scroll" style="margin-top:14px;">
        <table class="data"><thead><tr><th>Segment</th><th>Customers</th><th>% of Customers</th><th>Revenue</th><th>Orders</th><th>Avg Order Value</th></tr></thead>
        <tbody>${DATA.rfm_segments.map(s=>`<tr><td><span class="seg-chip seg-${slug(s.segment)}">${s.segment}</span></td><td>${fmtNum(s.customers)}</td><td>${fmtPct(s.pct_customers)}</td><td>${fmtMoney(s.revenue)}</td><td>${fmtNum(s.orders)}</td><td>${fmtMoney(s.avg_order_value,false)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="desc" style="margin-top:10px;">Champions = recent, frequent, high-spend. At Risk = were frequent buyers but haven't ordered recently. Lost = low recency, frequency, and spend across their full history.</div>
    </div>
    <div class="section-title">Cohort Retention <span class="badge">Full dataset, by first-purchase month</span></div>
    <div class="card">
      <div class="desc">% of each cohort's customers who placed at least one order in each month following their first purchase. Cohorts with fewer than 15 customers are omitted for statistical stability.</div>
      <div class="table-scroll" style="margin-top:10px;" id="cohortWrap"></div>
    </div>
  `;
}
function afterCustomers(){
  const custSet = new Set(FILTERED.map(r=>r[IDX.customer_id]));
  const rng = getEffectiveRange('custom', state.dateFrom, state.dateTo);
  let newCount=0, returningCount=0;
  custSet.forEach(cid=>{ if(customerFirstOrder.get(cid) >= rng.curFrom) newCount++; else returningCount++; });
  const validFiltered = FILTERED.filter(isValidRow);
  const revenue = validFiltered.reduce((a,r)=>a+r[IDX.sales],0);
  const orders = validFiltered.length;
  document.getElementById('custKpiGrid').innerHTML = [
    ['Total Customers', fmtNum(custSet.size)],
    ['New Customers', fmtNum(newCount), 'first order within current filter range'],
    ['Returning Customers', fmtNum(returningCount), 'ordered before current range began'],
    ['Avg Customer Value', fmtMoney(custSet.size? revenue/custSet.size : 0,false)],
    ['Revenue per Customer', fmtMoney(custSet.size? revenue/custSet.size : 0,false)],
    ['Orders per Customer', (custSet.size? (orders/custSet.size).toFixed(2) : '—')],
  ].map(([label,val,sub])=>`<div class="kpi"><div class="klabel">${label}</div><div class="kval">${val}</div>${sub?`<div class="ksub">${sub}</div>`:''}</div>`).join('');

  const segs = DATA.rfm_segments;
  makeChart('rfmChart', {type:'bar', data:{labels:segs.map(s=>s.segment), datasets:[{label:'Customers', data:segs.map(s=>s.customers), backgroundColor:PALETTE, borderRadius:2}]},
    options:{plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}, ticks:{maxRotation:20,minRotation:20, font:{size:10}}}, y:{grid:gridOpt}}}});

  const cm = DATA.cohort_matrix;
  const maxOffset = Math.max(...cm.map(r=>r.retention.length))-1;
  let html = '<table class="heatmap"><tr><th class="rowhead">Cohort</th><th>Size</th>'+Array.from({length:maxOffset+1},(_,i)=>`<th>M${i}</th>`).join('')+'</tr>';
  cm.forEach(row=>{
    html += `<tr><td class="rowhead">${row.cohort}</td><td class="rowhead">${row.size}</td>`;
    for(let i=0;i<=maxOffset;i++){
      const v = row.retention[i];
      if(v===undefined){ html += `<td class="empty">—</td>`; continue; }
      const alpha = Math.max(0.08, v/100);
      html += `<td style="background:rgba(79,209,197,${alpha})">${v}%</td>`;
    }
    html += '</tr>';
  });
  html += '</table>';
  document.getElementById('cohortWrap').innerHTML = html;
}

/* ============================= SEGMENTS ============================= */
function tplSegments(){
  return `
    <div class="section-title">Customer Segment, Channel &amp; Payment</div>
    <div class="grid g-3">
      <div class="card"><h3>Customer Segment</h3><div class="chart-wrap short"><canvas id="sgSeg"></canvas></div></div>
      <div class="card"><h3>Sales Channel</h3><div class="chart-wrap short"><canvas id="sgChan"></canvas></div></div>
      <div class="card"><h3>Payment Method</h3><div class="chart-wrap short"><canvas id="sgPay"></canvas></div></div>
    </div>
    <div class="section-title">Segment Performance Detail</div>
    <div class="card">
      <div class="table-scroll"><table class="data"><thead><tr><th>Segment</th><th>Revenue</th><th>Profit</th><th>Margin %</th><th>Orders</th><th>AOV</th></tr></thead><tbody id="segDetailBody"></tbody></table></div>
    </div>
  `;
}
function afterSegments(){
  const segMap = groupSum(FILTERED, IDX.seg, L.segment, IDX.sales);
  const segArr = [...segMap.entries()];
  makeChart('sgSeg', {type:'doughnut', data:{labels:segArr.map(d=>d[0]), datasets:[{data:segArr.map(d=>d[1].sum), backgroundColor:PALETTE, borderColor:'#0E1217', borderWidth:2}]}, options:{plugins:{legend:{position:'bottom'}}, cutout:'62%'}});

  const chanMap = groupSum(FILTERED, IDX.channel, L.channel, IDX.sales);
  const chanArr = [...chanMap.entries()];
  makeChart('sgChan', {type:'doughnut', data:{labels:chanArr.map(d=>d[0]), datasets:[{data:chanArr.map(d=>d[1].sum), backgroundColor:PALETTE.slice(1), borderColor:'#0E1217', borderWidth:2}]}, options:{plugins:{legend:{position:'bottom'}}, cutout:'62%'}});

  const payMap = new Map();
  FILTERED.forEach(r=>{ const p=L.payment[r[IDX.payment]]; payMap.set(p,(payMap.get(p)||0)+1); });
  const payArr = [...payMap.entries()].sort((a,b)=>b[1]-a[1]);
  makeChart('sgPay', {type:'bar', data:{labels:payArr.map(d=>d[0]), datasets:[{data:payArr.map(d=>d[1]), backgroundColor:PALETTE[4], borderRadius:2}]},
    options:{indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{grid:gridOpt}, y:{grid:{display:false}, ticks:{font:{size:10}, autoSkip:false}}}}});

  document.getElementById('segDetailBody').innerHTML = segArr.sort((a,b)=>b[1].sum-a[1].sum).map(([name,v])=>
    `<tr><td>${esc(name)}</td><td>${fmtMoney(v.sum,false)}</td><td>${fmtMoney(v.profit,false)}</td><td>${fmtPct(v.sum?100*v.profit/v.sum:0)}</td><td>${fmtNum(v.count)}</td><td>${fmtMoney(v.count?v.sum/v.count:0,false)}</td></tr>`
  ).join('') || emptyRow(6);
}

/* ============================= GEOGRAPHY ============================= */
function tplGeo(){
  const crumbs = [`<span class="crumb" data-lvl="global">Global</span>`];
  if(state.region!=='All') crumbs.push(`<span class="sep">›</span><span class="crumb" data-lvl="region">${esc(state.region)}</span>`);
  if(state.country!=='All') crumbs.push(`<span class="sep">›</span><span>${esc(state.country)}</span>`);
  const level = state.country!=='All' ? 'city' : (state.region!=='All' ? 'country' : 'region');
  const heading = {region:'Revenue by Region', country:`Revenue by Country — ${state.region}`, city:`Revenue by City — ${state.country}`}[level];
  return `
    <div class="section-title">Geographical Analysis</div>
    <div class="breadcrumb">${crumbs.join('')}</div>
    <div class="desc" style="margin-bottom:10px;">State/Province-level detail is <span class="not-avail">not available</span> in this dataset — the finest available granularity is city.</div>
    <div class="grid g-2">
      <div class="card"><h3>${heading}</h3><div class="desc">Click a bar to drill down and cross-filter the dashboard</div><div class="chart-wrap tall"><canvas id="geoMain"></canvas></div></div>
      <div class="card">
        <h3>Performance Detail</h3>
        <div class="table-scroll"><table class="data"><thead><tr><th>${level==='region'?'Region':level==='country'?'Country':'City'}</th><th>Revenue</th><th>Profit</th><th>Margin %</th><th>Orders</th><th>Customers</th><th>Return Rate</th></tr></thead><tbody id="geoDetailBody"></tbody></table></div>
      </div>
    </div>
  `;
}
function afterGeo(){
  document.querySelectorAll('.breadcrumb .crumb').forEach(c=>c.addEventListener('click', ()=>{
    if(c.dataset.lvl==='global'){ state.region='All'; state.country='All'; }
    else if(c.dataset.lvl==='region'){ state.country='All'; }
    renderFilterBar(); applyFiltersAndRender();
  }));
  const level = state.country!=='All' ? 'city' : (state.region!=='All' ? 'country' : 'region');
  const dimIdx = level==='region'?IDX.region : level==='country'?IDX.country : IDX.city;
  const dimLookup = level==='region'?L.region : level==='country'?L.country : L.city;

  // build full stats (revenue, profit, orders, customers, return rate) per dimension value
  const m = new Map();
  FILTERED.forEach(r=>{
    const k = dimLookup[r[dimIdx]];
    const cur = m.get(k) || {sales:0, profit:0, orders:0, customers:new Set(), returned:0, total:0};
    cur.total += 1;
    if(isValidRow(r)){ cur.sales += r[IDX.sales]; cur.profit += r[IDX.profit]; cur.orders += 1; cur.customers.add(r[IDX.customer_id]); }
    if(L.status[r[IDX.status]]==='Returned') cur.returned += 1;
    m.set(k, cur);
  });
  let arr = [...m.entries()].map(([k,v])=>({name:k, sales:v.sales, profit:v.profit, orders:v.orders, customers:v.customers.size, returnRate: v.total? 100*v.returned/v.total : 0, margin: v.sales? 100*v.profit/v.sales : 0}))
    .filter(d=>d.name!=='Unknown').sort((a,b)=>b.sales-a.sales);
  if(level==='city') arr = arr.slice(0,20);

  makeChart('geoMain', {type:'bar', data:{labels:arr.map(d=>d.name), datasets:[{data:arr.map(d=>d.sales), backgroundColor:PALETTE[0], borderRadius:2}]},
    options:{indexAxis:'y', onClick:(evt,els)=>{ if(!els.length || level==='city') return; const label = arr[els[0].index].name;
        if(level==='region'){ state.region = label; } else if(level==='country'){ state.country = label; }
        renderFilterBar(); applyFiltersAndRender();
      },
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw)}}}, scales:{x:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}, y:{grid:{display:false}, ticks:{autoSkip:false, font:{size:10}}}}}});

  document.getElementById('geoDetailBody').innerHTML = arr.map(d=>
    `<tr><td>${esc(d.name)}</td><td>${fmtMoney(d.sales,false)}</td><td>${fmtMoney(d.profit,false)}</td><td>${fmtPct(d.margin)}</td><td>${fmtNum(d.orders)}</td><td>${fmtNum(d.customers)}</td><td>${fmtPct(d.returnRate)}</td></tr>`
  ).join('') || emptyRow(7);
}

/* ============================= PROFITABILITY ============================= */
function tplProfitability(){
  return `
    <div class="section-title">Profitability Overview</div>
    <div class="grid g-kpi" id="profKpiGrid"></div>
    <div class="grid g-2">
      <div class="card"><h3>Profit Margin by Category</h3><div class="chart-wrap"><canvas id="profCat"></canvas></div></div>
      <div class="card"><h3>Profit Margin by Region</h3><div class="chart-wrap"><canvas id="profRegion"></canvas></div></div>
    </div>
    <div class="card"><h3>Discount % vs. Profit Margin %</h3><div class="desc">Each point is one order in the current filter (sampled up to 600 for readability)</div><div class="chart-wrap"><canvas id="profScatter"></canvas></div></div>
    <div class="grid g-2">
      <div class="card">
        <h3>High Revenue, Low Margin</h3><div class="desc">Categories above median revenue but below median margin — candidates for cost or pricing review</div>
        <div class="table-scroll"><table class="data"><thead><tr><th>Category</th><th>Revenue</th><th>Margin %</th></tr></thead><tbody id="hrlmBody"></tbody></table></div>
      </div>
      <div class="card">
        <h3>Low Revenue, High Margin</h3><div class="desc">Categories below median revenue but above median margin — candidates for growth investment</div>
        <div class="table-scroll"><table class="data"><thead><tr><th>Category</th><th>Revenue</th><th>Margin %</th></tr></thead><tbody id="lrhmBody"></tbody></table></div>
      </div>
    </div>
  `;
}
function afterProfitability(){
  const valid = FILTERED.filter(isValidRow);
  const revenue = valid.reduce((a,r)=>a+r[IDX.sales],0);
  const cost = valid.reduce((a,r)=>a+r[IDX.cost],0);
  const profit = valid.reduce((a,r)=>a+r[IDX.profit],0);
  const avgDiscount = valid.length? 100*valid.reduce((a,r)=>a+r[IDX.discount],0)/valid.length : 0;
  const cancelledReturnedRevenueLoss = FILTERED.filter(r=>!isValidRow(r)).reduce((a,r)=>a+r[IDX.sales],0);
  document.getElementById('profKpiGrid').innerHTML = [
    ['Revenue', fmtMoney(revenue)], ['Cost', fmtMoney(cost)], ['Gross Profit', fmtMoney(profit)],
    ['Profit Margin %', fmtPct(revenue?100*profit/revenue:0)], ['Avg Profit / Order', fmtMoney(valid.length?profit/valid.length:0,false)],
    ['Avg Discount %', fmtPct(avgDiscount)], ['Return/Cancel Revenue Impact', fmtMoney(cancelledReturnedRevenueLoss), 'forgone revenue, excluded from totals above'],
  ].map(([l,v,s])=>`<div class="kpi"><div class="klabel">${l}</div><div class="kval">${v}</div>${s?`<div class="ksub">${s}</div>`:''}</div>`).join('');

  const catMap = groupSum(FILTERED, IDX.cat, L.category, IDX.sales);
  const catArr = [...catMap.entries()].map(([k,v])=>[k, v.sum?100*v.profit/v.sum:0, v.sum]).sort((a,b)=>b[1]-a[1]);
  makeChart('profCat', {type:'bar', data:{labels:catArr.map(d=>d[0]), datasets:[{data:catArr.map(d=>d[1]), backgroundColor:PALETTE[2], borderRadius:2}]},
    options:{plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtPct(c.raw)}}}, scales:{x:{grid:{display:false}, ticks:{maxRotation:20,minRotation:20,font:{size:10}}}, y:{grid:gridOpt, ticks:{callback:v=>v+'%'}}}}});

  const regMap = groupSum(FILTERED, IDX.region, L.region, IDX.sales);
  const regArr = [...regMap.entries()].map(([k,v])=>[k, v.sum?100*v.profit/v.sum:0]).sort((a,b)=>b[1]-a[1]);
  makeChart('profRegion', {type:'bar', data:{labels:regArr.map(d=>d[0]), datasets:[{data:regArr.map(d=>d[1]), backgroundColor:PALETTE[5], borderRadius:2}]},
    options:{plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmtPct(c.raw)}}}, scales:{x:{grid:{display:false}, ticks:{maxRotation:20,minRotation:20,font:{size:9}}}, y:{grid:gridOpt, ticks:{callback:v=>v+'%'}}}}});

  const sample = valid.length>600 ? valid.filter((_,i)=>i%Math.ceil(valid.length/600)===0) : valid;
  makeChart('profScatter', {type:'scatter', data:{datasets:[{label:'Orders', data:sample.map(r=>({x:round1(r[IDX.discount]*100), y:round1(r[IDX.sales]?100*r[IDX.profit]/r[IDX.sales]:0)})), backgroundColor:'rgba(79,209,197,0.5)', pointRadius:3}]},
    options:{plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>`Discount ${c.raw.x}% · Margin ${c.raw.y}%`}}}, scales:{x:{grid:gridOpt, title:{display:true,text:'Discount %'}}, y:{grid:gridOpt, title:{display:true,text:'Profit margin %'}}}}});

  const revs = catArr.map(d=>d[2]), margins = catArr.map(d=>d[1]);
  const medRev = median(revs), medMargin = median(margins);
  const hrlm = catArr.filter(d=>d[2]>medRev && d[1]<medMargin).sort((a,b)=>b[2]-a[2]);
  const lrhm = catArr.filter(d=>d[2]<medRev && d[1]>medMargin).sort((a,b)=>b[1]-a[1]);
  document.getElementById('hrlmBody').innerHTML = hrlm.map(d=>`<tr><td>${esc(d[0])}</td><td>${fmtMoney(d[2],false)}</td><td>${fmtPct(d[1])}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty-state">No categories meet this criteria in the current filter.</div></td></tr>`;
  document.getElementById('lrhmBody').innerHTML = lrhm.map(d=>`<tr><td>${esc(d[0])}</td><td>${fmtMoney(d[2],false)}</td><td>${fmtPct(d[1])}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty-state">No categories meet this criteria in the current filter.</div></td></tr>`;
}
function median(arr){ if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); const mid=Math.floor(s.length/2); return s.length%2? s[mid] : (s[mid-1]+s[mid])/2; }

/* ============================= OPERATIONS ============================= */
function tplOperations(){
  return `
    <div class="section-title">Order &amp; Operations Analytics</div>
    <div class="grid g-kpi" id="opsKpiGrid"></div>
    <div class="grid g-2">
      <div class="card"><h3>Order Status Mix</h3><div class="chart-wrap"><canvas id="opsStatus"></canvas></div></div>
      <div class="card"><h3>Cancellation &amp; Return Rate Over Time</h3><div class="desc">Monthly, % of all orders in that month</div><div class="chart-wrap"><canvas id="opsRateTrend"></canvas></div></div>
    </div>
    <div class="card"><h3>Order Processing Time</h3><div class="desc">Days between order date and ship date, by order status. Orders with no ship date (e.g. still processing) are excluded.</div><div class="chart-wrap"><canvas id="opsProcessing"></canvas></div></div>
  `;
}
function afterOperations(){
  const total = FILTERED.length;
  const cancelled = FILTERED.filter(r=>L.status[r[IDX.status]]==='Cancelled').length;
  const returned = FILTERED.filter(r=>L.status[r[IDX.status]]==='Returned').length;
  const delivered = FILTERED.filter(r=>L.status[r[IDX.status]]==='Delivered').length;
  const withShip = FILTERED.filter(r=>r[IDX.processing_days]>=0);
  const avgProc = withShip.length? withShip.reduce((a,r)=>a+r[IDX.processing_days],0)/withShip.length : null;
  document.getElementById('opsKpiGrid').innerHTML = [
    ['Total Orders', fmtNum(total)], ['Delivered', fmtNum(delivered), fmtPct(total?100*delivered/total:0)+' of total'],
    ['Cancellation Rate', fmtPct(total?100*cancelled/total:0)], ['Return Rate', fmtPct(total?100*returned/total:0)],
    ['Avg Processing Time', avgProc!==null? avgProc.toFixed(1)+' days' : '—', 'order date → ship date'],
  ].map(([l,v,s])=>`<div class="kpi"><div class="klabel">${l}</div><div class="kval">${v}</div>${s?`<div class="ksub">${s}</div>`:''}</div>`).join('');

  const statMap = new Map();
  FILTERED.forEach(r=>{ const s=L.status[r[IDX.status]]; statMap.set(s,(statMap.get(s)||0)+1); });
  const statArr = [...statMap.entries()];
  makeChart('opsStatus', {type:'doughnut', data:{labels:statArr.map(d=>d[0]), datasets:[{data:statArr.map(d=>d[1]), backgroundColor:PALETTE, borderColor:'#0E1217', borderWidth:2}]}, options:{plugins:{legend:{position:'bottom'}}, cutout:'60%'}});

  const monthMap = new Map();
  FILTERED.forEach(r=>{ const m=r[IDX.date].slice(0,7); if(!monthMap.has(m)) monthMap.set(m,{total:0,cancelled:0,returned:0}); const o=monthMap.get(m); o.total++; if(L.status[r[IDX.status]]==='Cancelled')o.cancelled++; if(L.status[r[IDX.status]]==='Returned')o.returned++; });
  const months = [...monthMap.keys()].sort();
  makeChart('opsRateTrend', {type:'line', data:{labels:months, datasets:[
    {label:'Cancellation Rate %', data:months.map(m=>round1(100*monthMap.get(m).cancelled/monthMap.get(m).total)), borderColor:PALETTE[4], tension:.3, pointRadius:0, borderWidth:2},
    {label:'Return Rate %', data:months.map(m=>round1(100*monthMap.get(m).returned/monthMap.get(m).total)), borderColor:PALETTE[1], tension:.3, pointRadius:0, borderWidth:2},
  ]}, options:{plugins:{legend:{position:'top'}}, scales:{x:{grid:{display:false}}, y:{grid:gridOpt, ticks:{callback:v=>v+'%'}}}}});

  const byStatus = {};
  withShip.forEach(r=>{ const s=L.status[r[IDX.status]]; if(!byStatus[s]) byStatus[s]=[]; byStatus[s].push(r[IDX.processing_days]); });
  const statusLabels = Object.keys(byStatus);
  makeChart('opsProcessing', {type:'bar', data:{labels:statusLabels, datasets:[{label:'Avg processing days', data:statusLabels.map(s=>round1(byStatus[s].reduce((a,v)=>a+v,0)/byStatus[s].length)), backgroundColor:PALETTE[3], borderRadius:2}]},
    options:{plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.raw+' days'}}}, scales:{x:{grid:{display:false}}, y:{grid:gridOpt, title:{display:true,text:'days'}}}}});
}

/* ============================= ADVANCED ANALYTICS ============================= */
function tplAdvanced(){
  return `
    <div class="section-title">Forecasting <span class="badge">Full dataset — daily revenue, linear trend</span></div>
    <div class="card">
      <div class="toggle-row"><span class="tlabel">Horizon</span><div class="toggle-group" id="fcHorizon">${[['30d','30 days'],['60d','60 days'],['90d','90 days']].map(([k,l])=>`<button data-v="${k}" class="${(state.fcHorizon||'30d')===k?'active':''}">${l}</button>`).join('')}</div></div>
      <div class="chart-wrap tall"><canvas id="advForecast"></canvas></div>
      <div class="desc" style="margin-top:8px;">Solid line is <b style="color:var(--teal)">ACTUAL</b> daily revenue (last 90 days). Dashed line is a <b style="color:var(--amber)">FORECAST</b> from a linear trend fit, with a shaded ~80% confidence band. This is a simple trend projection, not a seasonal or ML model — treat it as directional.</div>
    </div>
    <div class="section-title">Anomaly Detection <span class="badge">Statistically calculated, full dataset</span></div>
    <div class="card" id="anomalyWrap"></div>
    <div class="section-title">Revenue Change Decomposition</div>
    <div class="card">
      <div class="desc">Uses the same Period / Compare settings as Overview. Switch tabs to change them.</div>
      <div id="decompWrap"></div>
    </div>
  `;
}
function afterAdvanced(){
  state.fcHorizon = state.fcHorizon || '30d';
  document.querySelectorAll('#fcHorizon button').forEach(b=>b.addEventListener('click', ()=>{ state.fcHorizon=b.dataset.v; renderView(); }));
  const fd = DATA.forecast_daily;
  const h = fd.horizons[state.fcHorizon];
  const futureLabels = h.forecast.map((_,i)=>`+${i+1}d`);
  const allLabels = [...fd.history_dates, ...futureLabels];
  const actualData = [...fd.history_sales, ...Array(h.forecast.length).fill(null)];
  const lastActual = fd.history_sales[fd.history_sales.length-1];
  const forecastData = [...Array(fd.history_sales.length-1).fill(null), lastActual, ...h.forecast];
  const upperData = [...Array(fd.history_sales.length-1).fill(null), lastActual, ...h.upper];
  const lowerData = [...Array(fd.history_sales.length-1).fill(null), lastActual, ...h.lower];
  makeChart('advForecast', {type:'line', data:{labels:allLabels, datasets:[
    {label:'Upper bound', data:upperData, borderColor:'transparent', backgroundColor:'rgba(240,168,87,0.10)', fill:'+1', pointRadius:0, tension:.2},
    {label:'Lower bound', data:lowerData, borderColor:'transparent', fill:false, pointRadius:0, tension:.2},
    {label:'ACTUAL', data:actualData, borderColor:PALETTE[0], pointRadius:0, borderWidth:2, tension:.2},
    {label:'FORECAST', data:forecastData, borderColor:PALETTE[1], borderDash:[5,3], pointRadius:0, borderWidth:2, tension:.2},
  ]}, options:{plugins:{legend:{labels:{filter:item=>item.text!=='Upper bound' && item.text!=='Lower bound'}}, tooltip:{callbacks:{label:c=>fmtMoney(c.raw)}}}, scales:{x:{grid:{display:false}, ticks:{maxTicksLimit:16}}, y:{grid:gridOpt, ticks:{callback:v=>fmtMoney(v)}}}}});

  // Anomaly detection: monthly revenue z-score + category deviation + return-rate deviation
  const monthMap = new Map();
  RECORDS.filter(isValidRow).forEach(r=>{ const m=r[IDX.date].slice(0,7); monthMap.set(m,(monthMap.get(m)||0)+r[IDX.sales]); });
  const months = [...monthMap.keys()].sort();
  const vals = months.map(m=>monthMap.get(m));
  const mean = vals.reduce((a,v)=>a+v,0)/vals.length;
  const std = Math.sqrt(vals.reduce((a,v)=>a+(v-mean)**2,0)/vals.length);
  const revAnomalies = months.map((m,i)=>({m, v:vals[i], z:(vals[i]-mean)/std})).filter(a=>Math.abs(a.z)>1.3);

  const catMonthMap = new Map();
  RECORDS.filter(isValidRow).forEach(r=>{ const cat=L.category[r[IDX.cat]]; const m=r[IDX.date].slice(0,7); const key=cat+'|'+m; catMonthMap.set(key,(catMonthMap.get(key)||0)+r[IDX.sales]); });
  const lastMonth = months[months.length-1], prevMonths = months.slice(-4,-1);
  const catAnomalies = [];
  L.category.forEach(cat=>{
    const lastVal = catMonthMap.get(cat+'|'+lastMonth)||0;
    const trailingAvg = prevMonths.length? prevMonths.reduce((a,m)=>a+(catMonthMap.get(cat+'|'+m)||0),0)/prevMonths.length : 0;
    if(trailingAvg>0){ const dev = 100*(lastVal-trailingAvg)/trailingAvg; if(Math.abs(dev)>20) catAnomalies.push({cat, dev, lastVal, trailingAvg}); }
  });

  const overallReturnRate = 100*RECORDS.filter(r=>L.status[r[IDX.status]]==='Returned').length/RECORDS.length;
  const catReturnAnomalies = [];
  L.category.forEach(cat=>{
    const rows = RECORDS.filter(r=>L.category[r[IDX.cat]]===cat);
    const rate = 100*rows.filter(r=>L.status[r[IDX.status]]==='Returned').length/rows.length;
    if(rate > overallReturnRate*1.4) catReturnAnomalies.push({cat, rate});
  });

  let html = '';
  revAnomalies.forEach(a=>{ html += anomalyCard(a.z>0?'🟢':'🔴', `Revenue ${a.z>0?'spike':'drop'} in ${a.m}`, `Monthly revenue of ${fmtMoney(a.v)} is ${Math.abs(a.z).toFixed(1)}σ ${a.z>0?'above':'below'} the ${vals.length}-month average of ${fmtMoney(mean)}.`); });
  catAnomalies.forEach(a=>{ html += anomalyCard(a.dev<0?'🔴':'🟡', `${a.cat} revenue anomaly`, `${a.cat} revenue in ${lastMonth} (${fmtMoney(a.lastVal)}) is ${Math.abs(a.dev).toFixed(1)}% ${a.dev<0?'below':'above'} its trailing 3-month average (${fmtMoney(a.trailingAvg)}).`); });
  catReturnAnomalies.forEach(a=>{ html += anomalyCard('🟡', `${a.cat} return-rate anomaly`, `${a.cat} return rate (${fmtPct(a.rate)}) is significantly above the overall return rate of ${fmtPct(overallReturnRate)}.`); });
  document.getElementById('anomalyWrap').innerHTML = html || `<div class="empty-state">No statistically significant anomalies detected in the full dataset.</div>`;

  // Revenue decomposition — reuse Overview's period/compare state
  const rng = getEffectiveRange(state.periodMode, state.dateFrom, state.dateTo);
  const curRecs = NODATE.filter(r=>inDateRange(r, rng.curFrom, rng.curTo));
  const prevFrom = state.compareMode==='prev_year'?rng.pyFrom:rng.prevFrom, prevTo = state.compareMode==='prev_year'?rng.pyTo:rng.prevTo;
  const prevRecs = NODATE.filter(r=>inDateRange(r, prevFrom, prevTo));
  const curK = kpiSetFor(curRecs), prevK = kpiSetFor(prevRecs);
  const ordersDelta = curK.validOrders - prevK.validOrders;
  const aovCur = curK.aov||0, aovPrev = prevK.aov||0;
  const volumeEffect = ordersDelta * aovPrev;
  const priceEffect = (aovCur-aovPrev) * curK.validOrders;
  const totalDelta = curK.revenue - prevK.revenue;
  const reconciled = Math.abs((volumeEffect+priceEffect) - totalDelta) < 1;

  const catCur = groupSum(curRecs, IDX.cat, L.category, IDX.sales);
  const catPrev = groupSum(prevRecs, IDX.cat, L.category, IDX.sales);
  const catDeltas = L.category.map(cat=>({cat, delta:(catCur.get(cat)?.sum||0)-(catPrev.get(cat)?.sum||0)})).sort((a,b)=>b.delta-a.delta);

  if(prevK.revenue===0 && curK.revenue===0){
    document.getElementById('decompWrap').innerHTML = `<div class="empty-state">No revenue in either period to decompose.</div>`;
  } else {
    document.getElementById('decompWrap').innerHTML = `
      <div class="grid g-3" style="margin-bottom:14px;">
        <div class="kpi"><div class="klabel">Previous Revenue</div><div class="kval">${fmtMoney(prevK.revenue)}</div></div>
        <div class="kpi"><div class="klabel">Current Revenue</div><div class="kval">${fmtMoney(curK.revenue)}</div></div>
        <div class="kpi ${totalDelta<0?'neg':''}"><div class="klabel">Total Change</div><div class="kval">${totalDelta>=0?'+':''}${fmtMoney(totalDelta)}</div></div>
      </div>
      <div class="qbar-row"><div class="qbar-label">Volume effect</div><div style="flex:1; font-family:var(--font-mono); font-size:12px; color:${volumeEffect>=0?'var(--teal)':'var(--red)'}">${volumeEffect>=0?'+':''}${fmtMoney(volumeEffect)} <span style="color:var(--text-dim)">(order count change: ${ordersDelta>=0?'+':''}${ordersDelta} orders × prior AOV)</span></div></div>
      <div class="qbar-row"><div class="qbar-label">Price / AOV effect</div><div style="flex:1; font-family:var(--font-mono); font-size:12px; color:${priceEffect>=0?'var(--teal)':'var(--red)'}">${priceEffect>=0?'+':''}${fmtMoney(priceEffect)} <span style="color:var(--text-dim)">(AOV change: ${fmtMoney(aovCur-aovPrev,false)} × current order count)</span></div></div>
      <div class="reconcile-ok" style="margin:6px 0 16px;">${reconciled?'✓ Volume + Price effects reconcile exactly to the total revenue change.':'Note: rounding differences may appear.'}</div>
      <h3 style="margin-bottom:8px;">By Category (alternate lens — exact partition of the same total change)</h3>
      ${catDeltas.map(d=>`<div class="qbar-row"><div class="qbar-label">${d.cat}</div><div style="flex:1; font-family:var(--font-mono); font-size:12px; color:${d.delta>=0?'var(--teal)':'var(--red)'}">${d.delta>=0?'+':''}${fmtMoney(d.delta)}</div></div>`).join('')}
    `;
  }
}
function anomalyCard(icon, title, body){
  return `<div class="insight-card" style="margin-bottom:10px;"><span style="font-size:15px;">${icon}</span> <b>${title}</b><br><span style="color:var(--text-mid); font-size:12.5px;">${body}</span></div>`;
}

/* ============================= DATA QUALITY ============================= */
function tplQuality(){
  const q = DATA.quality;
  return `
    <div class="section-title">Data Quality Center <span class="badge">Full dataset, pre → post cleaning</span></div>
    <div class="grid g-kpi">
      <div class="kpi"><div class="klabel">Total Rows (raw)</div><div class="kval">${fmtNum(q.raw_rows)}</div><div class="ksub">${q.raw_cols} columns</div></div>
      <div class="kpi"><div class="klabel">Clean Rows</div><div class="kval">${fmtNum(q.clean_rows)}</div><div class="ksub">${q.rows_removed_total} removed</div></div>
      <div class="kpi"><div class="klabel">Completeness</div><div class="kval">${fmtPct(q.completeness_pct,2)}</div></div>
      <div class="kpi"><div class="klabel">Validity</div><div class="kval">${fmtPct(q.validity_pct,2)}</div></div>
      <div class="kpi"><div class="klabel">Uniqueness</div><div class="kval">${fmtPct(q.uniqueness_pct,2)}</div></div>
      <div class="kpi"><div class="klabel">Data Quality Score</div><div class="kval">${q.quality_score}/100</div></div>
      <div class="kpi"><div class="klabel">Last Refresh</div><div class="kval" style="font-size:16px;">${q.last_refresh}</div></div>
    </div>
    <div class="section-title">Issues Found &amp; Remediated</div>
    <div class="card">
      ${qbar('Missing cells (raw)', q.missing_cells_raw, q.raw_rows*q.raw_cols, q.missing_pct_raw+'%')}
      ${qbar('Exact duplicate rows removed', q.duplicate_rows_removed, q.raw_rows, fmtNum(q.duplicate_rows_removed))}
      ${qbar('Negative-quantity entries corrected', q.invalid_quantity_fixed, q.raw_rows, fmtNum(q.invalid_quantity_fixed))}
      ${qbar('Zero-price rows dropped (unrecoverable)', q.invalid_price_dropped, q.raw_rows, fmtNum(q.invalid_price_dropped))}
      ${qbar('Statistical outliers flagged (kept, IQR method)', q.outliers_flagged, q.clean_rows, fmtNum(q.outliers_flagged))}
      <div class="desc" style="margin-top:6px;">Inconsistent category text was normalized; missing categorical fields were labeled "Unknown" rather than dropped, to preserve order-level revenue history.</div>
    </div>
    <div class="section-title">Column-Level Data Quality</div>
    <div class="card">
      <div class="table-scroll"><table class="data"><thead><tr><th>Column</th><th>Data Type</th><th>Null %</th><th>Unique %</th><th>Invalid %</th><th>Status</th></tr></thead>
      <tbody>${q.column_quality.map(c=>`<tr><td>${c.column}</td><td>${c.dtype}</td><td>${fmtPct(c.null_pct)}</td><td>${fmtPct(c.unique_pct)}</td><td>${fmtPct(c.invalid_pct)}</td><td><span class="status-pill status-${c.status==='Good'?'Delivered':c.status==='Minor Issues'?'Processing':'Cancelled'}">${c.status}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `;
}
function qbar(label, val, total, display){
  const pct = Math.min(100, 100*val/total);
  return `<div class="qbar-row"><div class="qbar-label">${label}</div><div class="qbar-track"><div class="qbar-fill" style="width:${pct}%"></div></div><div class="qbar-val">${display}</div></div>`;
}

/* ============================= INSIGHTS ============================= */
function tplInsights(){ return `<div class="section-title">Automated Business Insights <span class="badge">Computed from filtered dataset where noted, else full dataset</span></div><div id="insightsWrap" class="grid" style="grid-template-columns:1fr; gap:10px;"></div>`; }
function afterInsights(){
  const insights = [];
  const push = (cat,icon,text) => insights.push({cat,icon,text});

  const validAll = RECORDS.filter(isValidRow);
  const catMap = groupSum(RECORDS, IDX.cat, L.category, IDX.sales);
  const catArr = [...catMap.entries()].sort((a,b)=>b[1].sum-a[1].sum);
  if(catArr.length){ push('Growth','📈', `${catArr[0][0]} generated the highest revenue overall at ${fmtMoney(catArr[0][1].sum)}.`); }
  const bottom = catArr[catArr.length-1];
  if(bottom){ push('Risks','⚠️', `${bottom[0]} generated the lowest category revenue at ${fmtMoney(bottom[1].sum)} — worth reviewing assortment or pricing.`); }

  const regMap = groupSum(RECORDS, IDX.region, L.region, IDX.sales);
  const regArr = [...regMap.entries()].sort((a,b)=>b[1].sum-a[1].sum);
  if(regArr.length) push('Geography','🌎', `${regArr[0][0]} contributed the largest regional revenue at ${fmtMoney(regArr[0][1].sum)}.`);

  const products = productAgg(RECORDS);
  const totalRev = products.reduce((a,p)=>a+p.sales,0);
  const sorted = [...products].sort((a,b)=>b.sales-a.sales);
  const top20 = Math.ceil(sorted.length*0.2);
  const top20rev = sorted.slice(0,top20).reduce((a,p)=>a+p.sales,0);
  push('Products','📦', `The top 20% of products (${top20} of ${sorted.length}) generate ${fmtPct(totalRev?100*top20rev/totalRev:0)} of total revenue.`);

  const catMargins = catArr.map(([k,v])=>({cat:k, sales:v.sum, margin: v.sum?100*v.profit/v.sum:0}));
  const avgMargin = catMargins.reduce((a,c)=>a+c.margin,0)/catMargins.length;
  const highRevLowMargin = catMargins.filter(c=>c.sales > median(catMargins.map(x=>x.sales)) && c.margin < avgMargin).sort((a,b)=>b.sales-a.sales)[0];
  if(highRevLowMargin) push('Profitability','💰', `${highRevLowMargin.cat} has above-median revenue but a below-average profit margin of ${fmtPct(highRevLowMargin.margin)} (dataset avg: ${fmtPct(avgMargin)}).`);

  const cancelledReturnedRate = 100*RECORDS.filter(r=>!isValidRow(r)).length/RECORDS.length;
  push('Risks','⚠️', `${fmtPct(cancelledReturnedRate)} of all orders are cancelled or returned — a direct revenue-recovery opportunity.`);

  const champions = DATA.rfm_segments.find(s=>s.segment==='Champions');
  if(champions) push('Customers','👥', `Champions make up ${fmtPct(champions.pct_customers)} of customers but generate ${fmtMoney(champions.revenue)} in revenue at a ${fmtMoney(champions.avg_order_value,false)} average order value.`);
  const atRisk = DATA.rfm_segments.find(s=>s.segment==='At Risk');
  if(atRisk) push('Opportunities','💡', `${fmtNum(atRisk.customers)} customers are classified "At Risk" (previously frequent, now inactive) representing ${fmtMoney(atRisk.revenue)} in historical revenue — a re-engagement target.`);

  push('Customers','👥', `${DATA.cohort.repeat_customer_rate_pct}% of customers have purchased in more than one calendar month; ${DATA.cohort.one_time_pct}% remain one-time buyers.`);

  // discount vs margin insight
  const highDiscount = validAll.filter(r=>r[IDX.discount]>=0.2);
  const lowDiscount = validAll.filter(r=>r[IDX.discount]<0.2);
  const avgMarginHigh = highDiscount.length? 100*highDiscount.reduce((a,r)=>a+r[IDX.profit],0)/highDiscount.reduce((a,r)=>a+r[IDX.sales],0) : null;
  const avgMarginLow = lowDiscount.length? 100*lowDiscount.reduce((a,r)=>a+r[IDX.profit],0)/lowDiscount.reduce((a,r)=>a+r[IDX.sales],0) : null;
  if(avgMarginHigh!==null && avgMarginLow!==null) push('Risks','⚠️', `Orders with discounts of 20% or more show a ${fmtPct(avgMarginHigh)} average margin, versus ${fmtPct(avgMarginLow)} for orders discounted less than 20%.`);

  const fd = DATA.forecast_daily;
  const h = fd.horizons['30d'];
  const trendDir = h.forecast[h.forecast.length-1] >= h.forecast[0] ? 'upward' : 'downward';
  push('Growth','📈', `The 30-day revenue forecast trend is ${trendDir}, based on a linear fit over the trailing 90 days.`);

  const CATS = ['Growth','Profitability','Products','Customers','Geography','Risks','Opportunities'];
  document.getElementById('insightsWrap').innerHTML = CATS.filter(c=>insights.some(i=>i.cat===c)).map(cat=>
    insights.filter(i=>i.cat===cat).map(i=>`<div class="insight-card"><span class="insight-cat">${i.icon} ${cat}</span><br>${i.text}</div>`).join('')
  ).join('');
}

/* ============================= DETAIL TABLE ============================= */
const ALL_COLS = [
  {key:'order_id', label:'Order ID', always:true}, {key:'date', label:'Date'}, {key:'seg', label:'Segment', lk:'segment'},
  {key:'country', label:'Country', lk:'country'}, {key:'cat', label:'Category', lk:'category'}, {key:'subcat', label:'Sub-Category', lk:'subcategory'},
  {key:'product', label:'Product', lk:'product'}, {key:'qty', label:'Qty'}, {key:'unit_price', label:'Unit Price', money:true},
  {key:'discount', label:'Discount', pct:true}, {key:'sales', label:'Sales', money:true}, {key:'profit', label:'Profit', money:true},
  {key:'payment', label:'Payment', lk:'payment'}, {key:'status', label:'Status', statusPill:true}, {key:'channel', label:'Channel', lk:'channel'},
  {key:'processing_days', label:'Processing Days'},
];
function tplTable(){
  const visible = ALL_COLS.filter(c=>c.always || state.visibleCols[c.key]!==false);
  return `
    <div class="section-title">Detail Table</div>
    <div class="card">
      <div class="table-toolbar">
        <input type="text" id="tblSearch" placeholder="Search order id, product, category, country…" value="${esc(state.search)}">
        <span style="color:var(--text-dim); font-size:11.5px;" id="tblCount"></span>
        <span class="flabel">Rows</span>
        <select id="pageSizeSel">${[10,25,50,100].map(n=>`<option value="${n}" ${state.pageSize===n?'selected':''}>${n}</option>`).join('')}</select>
        <div class="col-toggle-menu">
          <button class="btn" id="colToggleBtn">Columns ▾</button>
          <div class="col-toggle-panel" id="colTogglePanel">
            ${ALL_COLS.filter(c=>!c.always).map(c=>`<label><input type="checkbox" data-col="${c.key}" ${state.visibleCols[c.key]?'checked':''}> ${c.label}</label>`).join('')}
          </div>
        </div>
        <button class="btn primary" id="tblExport" style="margin-left:auto;">Export CSV (filtered)</button>
      </div>
      <div class="desc" style="margin-bottom:8px;">Shift+click a column header to add it as a secondary sort key.</div>
      <div class="table-scroll">
        <table class="data" id="dataTable">
          <thead><tr>${visible.map(c=>`<th data-col="${c.key}">${c.label}</th>`).join('')}</tr></thead>
          <tbody id="tblBody"></tbody>
        </table>
      </div>
      <div class="pager" id="tblPager"></div>
    </div>
  `;
}
state.sortCols = state.sortCols || [{col:'date', dir:'desc'}];
function afterTable(){
  document.getElementById('tblSearch').addEventListener('input', (e)=>{ state.search = e.target.value.toLowerCase(); state.page=1; renderTable(); });
  document.getElementById('pageSizeSel').addEventListener('change', (e)=>{ state.pageSize = parseInt(e.target.value,10); state.page=1; renderTable(); });
  document.getElementById('colToggleBtn').addEventListener('click', ()=>document.getElementById('colTogglePanel').classList.toggle('open'));
  document.querySelectorAll('#colTogglePanel input').forEach(cb=>cb.addEventListener('change', ()=>{ state.visibleCols[cb.dataset.col] = cb.checked; renderView(); }));
  document.querySelectorAll('#dataTable thead th').forEach(th=>{
    th.addEventListener('click', (e)=>{
      const col = th.dataset.col;
      if(e.shiftKey){
        const existing = state.sortCols.find(s=>s.col===col);
        if(existing) existing.dir = existing.dir==='asc'?'desc':'asc';
        else state.sortCols.push({col, dir:'asc'});
      } else {
        state.sortCols = [{col, dir: (state.sortCols[0]?.col===col && state.sortCols[0].dir==='desc') ? 'asc' : 'desc'}];
      }
      renderTable();
    });
  });
  document.getElementById('tblExport').addEventListener('click', exportCSV);
  renderTable();
}
function cellValue(r, col){
  if(col==='order_id') return r[0];
  const i = IDX[col];
  const colDef = ALL_COLS.find(c=>c.key===col);
  if(colDef && colDef.lk) return L[colDef.lk][r[i]];
  return r[i];
}
function tableRows(){
  let rows = FILTERED;
  if(state.search){
    const s = state.search;
    rows = rows.filter(r=> r[0].toLowerCase().includes(s) || L.category[r[IDX.cat]].toLowerCase().includes(s) ||
      L.country[r[IDX.country]].toLowerCase().includes(s) || L.subcategory[r[IDX.subcat]].toLowerCase().includes(s) ||
      L.product[r[IDX.product]].toLowerCase().includes(s));
  }
  const sorts = state.sortCols;
  rows = [...rows].sort((a,b)=>{
    for(const {col,dir} of sorts){
      let av = cellValue(a,col), bv = cellValue(b,col);
      let cmp;
      if(typeof av==='number') cmp = av-bv; else cmp = String(av).localeCompare(String(bv));
      if(cmp!==0) return dir==='asc'? cmp : -cmp;
    }
    return 0;
  });
  return rows;
}
function renderTable(){
  const rows = tableRows();
  const visible = ALL_COLS.filter(c=>c.always || state.visibleCols[c.key]!==false);
  document.getElementById('tblCount').textContent = `${rows.length.toLocaleString()} matching rows`;
  const totalPages = Math.max(1, Math.ceil(rows.length/state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const startI = (state.page-1)*state.pageSize;
  const pageRows = rows.slice(startI, startI+state.pageSize);
  document.getElementById('tblBody').innerHTML = pageRows.map(r=>{
    return '<tr>'+visible.map(c=>{
      let v = cellValue(r,c.key);
      if(c.key==='date') v = fmtDate(v);
      else if(c.money) v = fmtMoney(v,false);
      else if(c.pct) v = fmtPct(v*100);
      else if(c.statusPill) v = `<span class="status-pill status-${v}">${v}</span>`;
      else if(c.key==='processing_days') v = v<0 ? '—' : v+'d';
      return `<td>${v}</td>`;
    }).join('')+'</tr>';
  }).join('') || `<tr><td colspan="${visible.length}"><div class="empty-state">No records match the current filters.</div></td></tr>`;
  document.getElementById('tblPager').innerHTML = `
    <button id="pFirst" ${state.page===1?'disabled':''}>« First</button>
    <button id="pPrev" ${state.page===1?'disabled':''}>‹ Prev</button>
    <span>Page ${state.page} / ${totalPages}</span>
    <button id="pNext" ${state.page===totalPages?'disabled':''}>Next ›</button>
    <button id="pLast" ${state.page===totalPages?'disabled':''}>Last »</button>
  `;
  document.getElementById('pFirst').onclick=()=>{state.page=1; renderTable();};
  document.getElementById('pPrev').onclick=()=>{state.page--; renderTable();};
  document.getElementById('pNext').onclick=()=>{state.page++; renderTable();};
  document.getElementById('pLast').onclick=()=>{state.page=totalPages; renderTable();};
}
function exportCSV(){
  const rows = tableRows();
  const visible = ALL_COLS.filter(c=>c.always || state.visibleCols[c.key]!==false);
  const lines = [visible.map(c=>c.label).join(',')];
  rows.forEach(r=>{
    lines.push(visible.map(c=>{
      let v = cellValue(r,c.key);
      if(typeof v==='string' && v.includes(',')) v = `"${v}"`;
      return v;
    }).join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'filtered_orders.csv';
  a.click();
}

/* ============================= VIEW ROUTER ============================= */
function renderView(){
  const main = document.getElementById('main');
  const routes = {
    overview: [tplOverview, afterOverview], trends: [tplTrends, afterTrends], products: [tplProducts, afterProducts],
    customers: [tplCustomers, afterCustomers], segments: [tplSegments, afterSegments], geo: [tplGeo, afterGeo],
    profitability: [tplProfitability, afterProfitability], operations: [tplOperations, afterOperations],
    advanced: [tplAdvanced, afterAdvanced], quality: [tplQuality, null], insights: [tplInsights, afterInsights],
    table: [tplTable, afterTable],
  };
  const [tpl, after] = routes[activeTab];
  main.innerHTML = tpl();
  if(after) after();
}

/* ============================= INIT ============================= */
function applyFiltersAndRender(){ computeFiltered(); renderView(); }
document.getElementById('refreshTxt').textContent = 'last refresh ' + DATA.quality.last_refresh + ' · ' + fmtDate(DATA.meta.date_min) + ' → ' + fmtDate(DATA.meta.date_max);
renderTabs();
renderFilterBar();
computeFiltered();
renderView();
