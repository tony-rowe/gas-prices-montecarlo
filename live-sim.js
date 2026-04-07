(function(){
function seedFromString(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19)}return h>>>0}
function mulberry32(seed){return function(){seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296}}
function bm(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function pct(arr,p){const s=arr.slice().sort((a,b)=>a-b);const i=(p/100)*(s.length-1);const lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo)}
function round3(v){return+Number(v).toFixed(3)}

const NP=9000,DAYS=365,SNAP=[0,31,61,92,122,153,184,214,245,275,306,337,365],SNAP_SET=new Set(SNAP);
const STORAGE_KEY='gas-prices-montecarlo.eia-key';
const LIVE_SERIES=Object.freeze({brent:'PET.RBRTE.D',national:'PET.EMM_EPMR_PTE_NUS_DPG.W'});
const BASELINE=Object.freeze({brent:111.14,brentDate:'Apr 6, 2026',brentSource:'futures snapshot',national:4.110,nationalDate:'Apr 5, 2026',nationalSource:'AAA snapshot',oregon:4.988,eugene:4.931});
const BASELINE_PREMIUMS=Object.freeze({oregon:round3(BASELINE.oregon-BASELINE.national),eugene:round3(BASELINE.eugene-BASELINE.national),florenceOverEugene:0.49});

let BRENT0=BASELINE.brent;
let START=new Date('2026-04-06T00:00:00');
let DATE_LABELS=[];
let FLORENCE_CURRENT=0;
let FIXED=0;
let currentLoc='nat';
let chart=null;

const PRICE_SNAPSHOT={brentDate:BASELINE.brentDate,brentSource:BASELINE.brentSource,national:BASELINE.national,nationalDate:BASELINE.nationalDate,nationalSource:BASELINE.nationalSource,oregon:BASELINE.oregon,eugene:BASELINE.eugene};
const SC=[
  {key:'esc',name:'Escalation',tag:'Flows depressed 60+ days | GS $147+ risk',col:'#e85c4a',fill:'rgba(232,92,74,0.10)',mu:140,k:.003,sig:.027,jumpRate:.005,jumpMean:.09,jumpStd:.055,warPremium:40,warDecay:.003,sprHaircut:8,sprStart:40,sprEnd:140,ddCeil:142,ddHaircut:.08,reopenProb:.002},
  {key:'base',name:'Base case',tag:'GS 36-day outlook | Q4 $71 target',col:'#4a9edd',fill:'rgba(74,158,221,0.10)',mu:88,k:.005,sig:.022,jumpRate:.003,jumpMean:0,jumpStd:.05,warPremium:33,warDecay:.012,sprHaircut:13,sprStart:30,sprEnd:120,ddCeil:138,ddHaircut:.11,reopenProb:.012},
  {key:'de',name:'De-escalation',tag:'Navy corridor | GS $70s favorable case',col:'#2db88a',fill:'rgba(45,184,138,0.10)',mu:72,k:.009,sig:.018,jumpRate:.003,jumpMean:-.07,jumpStd:.04,warPremium:25.5,warDecay:.025,sprHaircut:16,sprStart:20,sprEnd:100,ddCeil:135,ddHaircut:.13,reopenProb:.025},
];
const LOC=[
  {key:'nat',name:'National Average',offset:0,current:0,amp:.18},
  {key:'eugene',name:'Eugene / Springfield, OR',offset:0,current:0,amp:.22},
  {key:'florence',name:'Florence, OR',offset:0,current:0,amp:.26},
];
const TITLES={
  nat:['National Average - Regime-Switching 12-Month Projection','Brent OU + regime transitions + SPR haircut + demand destruction + CARB seasonal | 9,000 seeded paths/scenario'],
  eugene:['Eugene / Springfield, OR - 12-Month Projection',''],
  florence:['Florence, OR - 12-Month Projection',''],
};
const RAW={},STATS={},MONO="'DM Mono',monospace";
const MS=[{idx:3,note:'Summer peak + war'},{idx:6,note:'Post-summer, fall blend'},{idx:9,note:'Winter trough'},{idx:12,note:'One year out'}];

function fmtDate(offset){const dt=new Date(START);dt.setDate(dt.getDate()+offset);return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})}
function formatLongDate(date){return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function updateDateLabels(){DATE_LABELS=SNAP.map(fmtDate)}
function syncDerivedState(){PRICE_SNAPSHOT.oregon=round3(PRICE_SNAPSHOT.national+BASELINE_PREMIUMS.oregon);PRICE_SNAPSHOT.eugene=round3(PRICE_SNAPSHOT.national+BASELINE_PREMIUMS.eugene);FLORENCE_CURRENT=round3(PRICE_SNAPSHOT.eugene+BASELINE_PREMIUMS.florenceOverEugene);FIXED=round3(PRICE_SNAPSHOT.national-((BRENT0/42)*1.12));LOC[0].offset=0;LOC[0].current=PRICE_SNAPSHOT.national;LOC[1].offset=round3(PRICE_SNAPSHOT.eugene-PRICE_SNAPSHOT.national);LOC[1].current=PRICE_SNAPSHOT.eugene;LOC[2].offset=round3(FLORENCE_CURRENT-PRICE_SNAPSHOT.national);LOC[2].current=FLORENCE_CURRENT;TITLES.eugene[1]=`+${LOC[1].offset.toFixed(2)}/gal calibrated premium | wider seasonal amplitude`;TITLES.florence[1]=`+${LOC[2].offset.toFixed(2)}/gal premium | coastal isolation | tourist summer surcharge`}
function seasonalDelta(day,loc){const amp=loc.amp;const raw=amp*Math.cos(2*Math.PI*(day+80-185)/365);const rawNow=amp*Math.cos(2*Math.PI*(80-185)/365);let delta=raw-rawNow;if(loc.key==='florence'){const shoulder=.09*Math.exp(-Math.pow(day-105,2)/(2*38*38));const shoulderNow=.09*Math.exp(-Math.pow(105,2)/(2*38*38));delta+=shoulder-shoulderNow}return delta}

function runScenario(sc){
  const rng=mulberry32(seedFromString(`scenario:${sc.key}:brent:${BRENT0.toFixed(3)}`));
  const out=Array.from({length:SNAP.length},()=>[]);
  for(let path=0;path<NP;path++){
    let logBrent=Math.log(BRENT0),snapIndex=0,reopened=false;
    out[snapIndex].push(BRENT0);snapIndex+=1;
    for(let day=1;day<=DAYS;day++){
      if(!reopened&&rng()<sc.reopenProb)reopened=true;
      const effectiveMu=reopened?sc.mu:sc.mu*(1+.15*Math.exp(-sc.warDecay*day));
      logBrent+=sc.k*(Math.log(effectiveMu)-logBrent)+sc.sig*bm(rng);
      if(rng()<sc.jumpRate)logBrent+=sc.jumpMean+sc.jumpStd*bm(rng);
      const warAdj=Math.log(1+(sc.warPremium/BRENT0)*Math.exp(-sc.warDecay*day));
      logBrent+=warAdj*.001;
      if(day>=sc.sprStart&&day<=sc.sprEnd){
        const sprFrac=(day-sc.sprStart)/(sc.sprEnd-sc.sprStart);
        const sprEffect=sc.sprHaircut*(1-Math.abs(sprFrac-.5)*2);
        logBrent-=(sprEffect/Math.exp(logBrent))*.018;
      }
      const brentValue=Math.exp(logBrent);
      if(brentValue>sc.ddCeil){const excess=brentValue-sc.ddCeil;logBrent-=(excess*sc.ddHaircut)/brentValue}
      logBrent=Math.max(logBrent,Math.log(50));
      logBrent=Math.min(logBrent,Math.log(200));
      if(SNAP_SET.has(day)){out[snapIndex].push(Math.exp(logBrent));snapIndex+=1}
    }
  }
  return out;
}

function b2g(brent,loc,day){const crackRatio=brent>130?1.12-.06*Math.min((brent-130)/70,1):1.12;const raw=(brent/42)*crackRatio+FIXED+loc.offset+seasonalDelta(day,loc);return Math.max(raw,1.5)}
function getStats(scKey,loc){return RAW[scKey].map((arr,snapIndex)=>{const day=SNAP[snapIndex],gas=arr.map(brent=>b2g(brent,loc,day));return{med:pct(gas,50),lo:pct(gas,2.5),hi:pct(gas,97.5),p5:pct(gas,5),p95:pct(gas,95)}})}

function renderMetrics(){
  const liveRegional=PRICE_SNAPSHOT.nationalSource.startsWith('EIA');
  document.getElementById('metric-national').textContent=`$${PRICE_SNAPSHOT.national.toFixed(2)}`;
  document.getElementById('metric-oregon').textContent=`$${PRICE_SNAPSHOT.oregon.toFixed(2)}`;
  document.getElementById('metric-eugene').textContent=`$${PRICE_SNAPSHOT.eugene.toFixed(2)}`;
  document.getElementById('metric-florence').textContent=`$${FLORENCE_CURRENT.toFixed(2)}`;
  document.getElementById('metric-brent').textContent=`$${BRENT0.toFixed(2)}`;
  document.getElementById('metric-national-note').textContent=`${PRICE_SNAPSHOT.nationalDate} ${PRICE_SNAPSHOT.nationalSource}`;
  document.getElementById('metric-oregon-note').textContent=liveRegional?'Live national + OR spread':'Apr 5 AAA snapshot';
  document.getElementById('metric-eugene-note').textContent=liveRegional?'Live national + Eugene spread':'Apr 5 AAA metro';
  document.getElementById('metric-florence-note').textContent=liveRegional?'Live Eugene + coastal spread':'Eugene + coastal premium';
  document.getElementById('metric-brent-note').textContent=`${PRICE_SNAPSHOT.brentDate} ${PRICE_SNAPSHOT.brentSource}`;
}

function renderNarrativeCopy(){
  document.getElementById('calibration-note').innerHTML=`<strong>Current calibration:</strong> Brent is anchored at <strong>$${BRENT0.toFixed(2)}/bbl</strong> as of ${PRICE_SNAPSHOT.brentDate}, while the national gasoline input is <strong>$${PRICE_SNAPSHOT.national.toFixed(2)}</strong> as of <strong>${PRICE_SNAPSHOT.nationalDate}</strong> from <strong>${PRICE_SNAPSHOT.nationalSource}</strong>. Oregon, Eugene, and Florence are layered on top with calibrated regional spreads. The fixed retail component is solved from the active snapshot so the model's day-zero output stays aligned with the displayed price level. <strong>Backtest:</strong> the March 21, 2026 version projected April 6 national medians of <strong>$3.96</strong> (escalation), <strong>$3.89</strong> (base), and <strong>$3.78</strong> (de-escalation) versus a realized <strong>$4.11</strong>, so the old center understated the move by roughly <strong>3.9% to 8.4%</strong>.`;
  document.getElementById('alignment-note').innerHTML=`The displayed \"today\" numbers come from the same inputs that anchor the simulation: <strong>Brent $${BRENT0.toFixed(2)}</strong> on ${PRICE_SNAPSHOT.brentDate} and a <strong>$${PRICE_SNAPSHOT.national.toFixed(2)}</strong> national gasoline input on ${PRICE_SNAPSHOT.nationalDate}. Oregon, Eugene, and Florence are derived from calibrated spreads on top of the national series because AAA does not expose a browser-safe API.`;
  document.getElementById('technical-calibration-note').textContent=PRICE_SNAPSHOT.nationalSource.startsWith('EIA')?`Current calibration note: the page pulled Brent and national gasoline browser-side from EIA, then solved the fixed retail component locally. Fixed is currently about $${FIXED.toFixed(2)}.`:`Current calibration note: fixed is solved from the April 5/6, 2026 Brent and AAA snapshot, which puts it at roughly $${FIXED.toFixed(2)} in the current version.`;
  document.getElementById('technical-fixed-note').textContent=`Fixed is recalculated from the active snapshot and is currently $${FIXED.toFixed(2)} per gallon before regional offsets and seasonal effects.`;
}

function renderRegimeRow(){
  const months=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
  document.getElementById('regime-row').innerHTML=months.map((month,index)=>{const day=SNAP[index],seas=seasonalDelta(day,LOC[0]),warPrem=(SC[1].warPremium*Math.exp(-SC[1].warDecay*day)/BRENT0)*.5,total=seas+warPrem,pos=`rgba(232,92,74,${Math.min(.08+Math.abs(total)*1.8,.45)})`,neg=`rgba(74,158,221,${Math.min(.08+Math.abs(total)*1.8,.45)})`,txt=total>=0?'#f0a090':'#80bde8',sign=total>=0?'+':'';return`<div class=\"rm\" style=\"background:${total>=0?pos:neg}\"><span class=\"rn\">${month}</span><span class=\"rv\" style=\"color:${txt}\">${sign}${total.toFixed(2)}</span></div>`}).join('');
}

function buildDatasets(locKey){
  const ds=[];SC.forEach(sc=>{const st=STATS[locKey][sc.key];
    ds.push({label:`${sc.name}_hi`,data:st.map(x=>+x.hi.toFixed(3)),borderColor:'transparent',backgroundColor:'transparent',pointRadius:0,tension:.4,fill:{target:'+1',above:sc.fill,below:sc.fill}});
    ds.push({label:`${sc.name}_lo`,data:st.map(x=>+x.lo.toFixed(3)),borderColor:'transparent',backgroundColor:'transparent',pointRadius:0,tension:.4,fill:false});
    ds.push({label:`${sc.name}_p95`,data:st.map(x=>+x.p95.toFixed(3)),borderColor:sc.col,borderDash:[3,4],borderWidth:1,pointRadius:0,tension:.4,fill:false,backgroundColor:'transparent'});
    ds.push({label:`${sc.name}_p5`,data:st.map(x=>+x.p5.toFixed(3)),borderColor:sc.col,borderDash:[3,4],borderWidth:1,pointRadius:0,tension:.4,fill:false,backgroundColor:'transparent'});
    ds.push({label:sc.name,data:st.map(x=>+x.med.toFixed(3)),borderColor:sc.col,backgroundColor:sc.col,pointRadius:2.5,pointHoverRadius:5,borderWidth:2.5,tension:.4,fill:false});
  });return ds;
}

function axisBounds(locKey){let min=Infinity,max=-Infinity;SC.forEach(sc=>{STATS[locKey][sc.key].forEach(point=>{if(point.lo<min)min=point.lo;if(point.hi>max)max=point.hi})});return{min:Math.floor(min*.97*4)/4,max:Math.ceil(max*1.03*4)/4}}
function renderChart(locKey){
  if(chart)chart.destroy();const bounds=axisBounds(locKey);
  chart=new Chart(document.getElementById('gasChart'),{type:'line',data:{labels:DATE_LABELS,datasets:buildDatasets(locKey)},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2028',borderColor:'rgba(255,255,255,.1)',borderWidth:1,titleColor:'#c8a96e',bodyColor:'#7a7f8a',titleFont:{family:MONO,size:11},bodyFont:{family:MONO,size:11},padding:14,filter:item=>!item.dataset.label.includes('_'),callbacks:{title:items=>{const snapIndex=items[0].dataIndex,day=SNAP[snapIndex],loc=LOC.find(entry=>entry.key===currentLoc),seas=seasonalDelta(day,loc),sign=seas>=0?'+':'';return`${DATE_LABELS[snapIndex]} | seasonal ${sign}${seas.toFixed(2)}/gal`},label:item=>{const sc=SC.find(entry=>entry.name===item.dataset.label);if(!sc)return null;const point=STATS[currentLoc][sc.key][item.dataIndex];return`${sc.name}: $${(+item.raw).toFixed(2)} | 95% CI $${point.lo.toFixed(2)}-$${point.hi.toFixed(2)}`}}}},scales:{x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#3a3f4a',font:{family:MONO,size:10},maxRotation:38,autoSkip:false}},y:{min:bounds.min,max:bounds.max,grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#3a3f4a',font:{family:MONO,size:10},callback:value=>`$${value.toFixed(2)}`}}}}});
}

function renderCards(locKey){
  document.getElementById('sc-grid').innerHTML=SC.map(sc=>{const st=STATS[locKey][sc.key],loc=LOC.find(entry=>entry.key===locKey),rows=MS.map(milestone=>{const point=st[milestone.idx],day=SNAP[milestone.idx],seasonal=seasonalDelta(day,loc),sign=seasonal>=0?'+':'';return`<div class=\"msl\">${DATE_LABELS[milestone.idx]} <span style=\"color:var(--faint)\">${milestone.note} | seasonal ${sign}${seasonal.toFixed(2)}</span></div><div class=\"dr\"><span class=\"dl\">Median</span><span class=\"dv\" style=\"color:${sc.col}\">$${point.med.toFixed(2)}</span></div><div class=\"dr\"><span class=\"dl\">95% CI</span><span class=\"dv\">$${point.lo.toFixed(2)} - $${point.hi.toFixed(2)}</span></div><div class=\"dr\"><span class=\"dl\">5th / 95th</span><span class=\"dv\">$${point.p5.toFixed(2)} / $${point.p95.toFixed(2)}</span></div>`}).join('');return`<div class=\"sc\"><div class=\"sc-head\"><span class=\"scdot\" style=\"background:${sc.col}\"></span><span class=\"scn\">${sc.name}</span><span class=\"sctag\">${sc.tag}</span></div>${rows}</div>`}).join('');
}

function renderCurrentView(){document.getElementById('chart-title').textContent=TITLES[currentLoc][0];document.getElementById('chart-sub').textContent=TITLES[currentLoc][1];renderChart(currentLoc);renderCards(currentLoc)}
function recomputeSimulation(){SC.forEach(sc=>{RAW[sc.key]=runScenario(sc)});LOC.forEach(loc=>{STATS[loc.key]={};SC.forEach(sc=>{STATS[loc.key][sc.key]=getStats(sc.key,loc)})});renderMetrics();renderNarrativeCopy();renderRegimeRow();renderCurrentView()}
function switchTab(locKey,btn){currentLoc=locKey;document.querySelectorAll('.tab').forEach(tab=>{tab.classList.toggle('active',tab.getAttribute('data-loc')===locKey)});if(btn)btn.classList.add('active');renderCurrentView()}window.switchTab=switchTab;

function parsePeriod(period){const raw=String(period);if(/^\d{8}$/.test(raw))return new Date(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T00:00:00`);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return new Date(`${raw}T00:00:00`);if(/^\d{4}-\d{2}$/.test(raw))return new Date(`${raw}-01T00:00:00`);if(/^\d{4}$/.test(raw))return new Date(`${raw}-01-01T00:00:00`);return null}
function setStatus(message){document.getElementById('status').textContent=message}
function updateLiveMeta(message,tone){const el=document.getElementById('live-meta');el.textContent=message;if(tone){el.dataset.tone=tone}else{delete el.dataset.tone}}
function getStoredApiKey(){try{return window.localStorage.getItem(STORAGE_KEY)||''}catch(_err){return''}}
function storeApiKey(apiKey){try{window.localStorage.setItem(STORAGE_KEY,apiKey)}catch(_err){}}
function clearStoredApiKey(){try{window.localStorage.removeItem(STORAGE_KEY)}catch(_err){}}
function extractApiError(payload){if(!payload)return'No response payload received from EIA.';if(typeof payload.error==='string')return payload.error;if(payload.error&&typeof payload.error==='object')return payload.error.message||payload.error.description||JSON.stringify(payload.error);if(payload.message)return payload.message;if(payload.warning&&payload.description)return`${payload.warning}: ${payload.description}`;return''}

async function fetchSeries(apiKey,seriesId){
  const url=`https://api.eia.gov/series/?api_key=${encodeURIComponent(apiKey)}&series_id=${encodeURIComponent(seriesId)}`;
  const response=await fetch(url,{mode:'cors'});
  const payload=await response.json();
  const apiError=extractApiError(payload);
  if(!response.ok||apiError)throw new Error(apiError||`EIA request failed for ${seriesId} with status ${response.status}.`);
  const series=payload.series&&payload.series[0],point=series&&series.data&&series.data[0];
  if(!point||point.length<2)throw new Error(`EIA returned no usable data for ${seriesId}.`);
  const value=Number(point[1]);
  if(!Number.isFinite(value))throw new Error(`EIA returned a non-numeric value for ${seriesId}.`);
  return{period:point[0],value};
}

async function refreshLiveData(){
  const input=document.getElementById('eia-api-key'),refreshBtn=document.getElementById('live-refresh'),clearBtn=document.getElementById('live-clear'),apiKey=input.value.trim();
  if(!apiKey){updateLiveMeta('Enter an EIA API key to pull live data in the browser.','error');setStatus('Waiting for an EIA API key before running a live browser-side recalibration.');return}
  refreshBtn.disabled=true;clearBtn.disabled=true;
  setStatus('Pulling Brent and U.S. regular gasoline from EIA and recomputing 27,000 seeded paths...');
  updateLiveMeta('Fetching daily Brent and weekly U.S. regular gasoline from EIA in your browser...','pending');
  try{
    const [brent,national]=await Promise.all([fetchSeries(apiKey,LIVE_SERIES.brent),fetchSeries(apiKey,LIVE_SERIES.national)]);
    const brentDate=parsePeriod(brent.period),nationalDate=parsePeriod(national.period);
    BRENT0=round3(brent.value);
    PRICE_SNAPSHOT.brentDate=brentDate?formatLongDate(brentDate):String(brent.period);
    PRICE_SNAPSHOT.brentSource='EIA daily';
    PRICE_SNAPSHOT.national=round3(national.value);
    PRICE_SNAPSHOT.nationalDate=nationalDate?formatLongDate(nationalDate):String(national.period);
    PRICE_SNAPSHOT.nationalSource='EIA weekly';
    START=brentDate||nationalDate||START;
    updateDateLabels();syncDerivedState();recomputeSimulation();storeApiKey(apiKey);
    updateLiveMeta(`Live sync completed: Brent $${BRENT0.toFixed(2)} on ${PRICE_SNAPSHOT.brentDate}; U.S. regular $${PRICE_SNAPSHOT.national.toFixed(3)} on ${PRICE_SNAPSHOT.nationalDate}. Oregon, Eugene, and Florence remain calibrated spreads on top of the live national series because AAA does not expose a browser-safe API.`,'ok');
    setStatus('Live EIA data loaded. 27,000 seeded regime-switching paths recomputed in the browser.');
  }catch(err){
    updateLiveMeta(`Live fetch failed: ${err.message}`,'error');
    setStatus('Live EIA fetch failed. Keeping the current calibrated snapshot in memory.');
  }finally{refreshBtn.disabled=false;clearBtn.disabled=false}
}

function initLiveControls(){
  const input=document.getElementById('eia-api-key'),savedKey=getStoredApiKey();
  if(savedKey)input.value=savedKey;
  document.getElementById('live-refresh').addEventListener('click',refreshLiveData);
  document.getElementById('live-clear').addEventListener('click',()=>{clearStoredApiKey();input.value='';updateLiveMeta('Saved EIA key cleared. Refresh the page to return to the baseline snapshot, or enter a new key and fetch again.','');setStatus('Saved EIA key cleared. The current in-memory calibration stays active until the next fetch or page reload.')});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();refreshLiveData()}});
  if(savedKey)refreshLiveData();
}

updateDateLabels();
syncDerivedState();
recomputeSimulation();
setStatus('Calibrated to the Apr 5/6, 2026 snapshot. 27,000 seeded regime-switching paths ready.');
initLiveControls();
})();
