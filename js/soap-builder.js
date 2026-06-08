/* js/soap-builder.js — Custom Soap Builder for Amber's Alchemy Apothecary
 * A guided, intuitive, magical experience (mirrors the Herbal Ally Quiz tone).
 * Defines the global functions referenced by index.html's onclick handlers
 * (openSoapBuilder, closeSoapBuilder, sbNextStep, sbPrevStep, sbStartNew,
 *  sbAddToCart, addSoapToCart). NOT wrapped in an IIFE so they are global.
 * Custom soaps are added to the visible cart (app.js addToCart) WITH all
 * selections as options, so they flow through to Stripe checkout + the
 * admin/customer order emails.
 */

var SOAP_PRICE = 9.99;

var SB_DATA = {
  bases: [
    { id: 'Botanical Clear Top', emoji: '🌿', title: 'Botanical Clear Bar', desc: 'Vegetable glycerin + castor oil — luminous and perfect for showcasing real botanicals.' },
    { id: 'Creamy Nourishing', emoji: '🥥', title: 'Creamy Nourishing Bar', desc: 'Shea butter + goat milk — velvety, deeply hydrating, gentle on the skin.' },
    { id: 'Layered (Clear + Creamy)', emoji: '⚗️', title: 'Layered Bar', desc: 'A clear botanical top over a rich creamy base — the best of both worlds.' }
  ],
  intentions: ['Calm & soothed', 'Grounded & centered', 'Uplifted & joyful', 'Sensual & radiant', 'Cleansed & renewed', 'Cozy & comforted'],
  scents: [
    { id: 'Floral', emoji: '🌸' }, { id: 'Earthy', emoji: '🌎' }, { id: 'Citrus', emoji: '🍊' },
    { id: 'Minty', emoji: '🌱' }, { id: 'Sweet', emoji: '🍯' }, { id: 'Spicy', emoji: '🔥' },
    { id: 'Woodsy', emoji: '🌲' }, { id: 'Unscented', emoji: '🤍' }
  ],
  skins: ['Dry', 'Sensitive', 'Oily', 'Acne-prone', 'Mature', 'Irritated', 'Balanced'],
  energies: ['Gentle', 'Luxurious', 'Detoxifying', 'Brightening', 'Calming', 'Grounding', 'Energizing'],
  botanicals: ['Lavender buds', 'Rose petals', 'Calendula', 'Chamomile', 'Mint leaves', 'Hibiscus', 'Spirulina', 'Activated charcoal', 'Oats', 'Cinnamon'],
  colors: ['Soft lavender', 'Rose pink', 'Golden calendula', 'Forest green', 'Charcoal black', 'Ocean blue', 'Natural / uncolored']
};

// scent family -> essential oils + scent description
var SB_SCENT_MAP = {
  Floral:   { oils: ['Lavender', 'Geranium', 'Ylang-ylang'], profile: 'Soft, romantic florals', herbs: ['Rose petals', 'Lavender', 'Chamomile'] },
  Earthy:   { oils: ['Vetiver', 'Cedarwood', 'Patchouli'],   profile: 'Grounding, mineral-rich earth', herbs: ['Nettle', 'Burdock'] },
  Citrus:   { oils: ['Sweet Orange', 'Bergamot', 'Lemon'],    profile: 'Bright, uplifting citrus', herbs: ['Calendula', 'Orange peel'] },
  Minty:    { oils: ['Peppermint', 'Spearmint', 'Eucalyptus'],profile: 'Cool, clarifying mint', herbs: ['Mint leaves', 'Spirulina'] },
  Sweet:    { oils: ['Vanilla', 'Benzoin', 'Honey accord'],   profile: 'Warm, comforting sweetness', herbs: ['Oats', 'Honey'] },
  Spicy:    { oils: ['Cinnamon', 'Clove', 'Ginger'],          profile: 'Cozy, warming spice', herbs: ['Cinnamon', 'Clove'] },
  Woodsy:   { oils: ['Sandalwood', 'Frankincense', 'Cedar'],  profile: 'Sacred, resinous woods', herbs: ['Frankincense', 'Myrrh'] },
  Unscented:{ oils: [],                                        profile: 'Pure & fragrance-free', herbs: ['Oats', 'Calendula'] }
};

// skin type -> butters/oils + benefit
var SB_SKIN_MAP = {
  Dry:        { care: ['Shea butter', 'Goat milk', 'Olive oil'], benefit: 'deep, lasting hydration' },
  Sensitive:  { care: ['Goat milk', 'Colloidal oats', 'Calendula'], benefit: 'gentle calming for reactive skin' },
  Oily:       { care: ['Activated charcoal', 'French green clay'], benefit: 'balancing & clarifying' },
  'Acne-prone':{ care: ['Activated charcoal', 'Tea tree', 'Bentonite clay'], benefit: 'purifying & blemish-supporting' },
  Mature:     { care: ['Shea butter', 'Rosehip', 'Goat milk'], benefit: 'nourishing & restoring radiance' },
  Irritated:  { care: ['Calendula', 'Colloidal oats', 'Chamomile'], benefit: 'soothing & comforting' },
  Balanced:   { care: ['Shea butter', 'Vegetable glycerin'], benefit: 'everyday nourishment & glow' }
};

var sbState = {};
function sbReset() {
  sbState = { step: 1, base: null, intention: null, scent: null, skin: null, energies: [], exfoliate: null, botanicals: [], color: null, avoid: '', notes: '' };
}
sbReset();

function sbInjectStyles() {
  if (document.getElementById('sb-inline-styles')) return;
  var s = document.createElement('style');
  s.id = 'sb-inline-styles';
  s.textContent = [
    '.sb-grp{margin:0 0 18px}',
    '.sb-grp h4{margin:0 0 10px;font-size:.95rem;letter-spacing:.04em;color:var(--gold,#d4a843)}',
    '.sb-chip{display:inline-flex;align-items:center;gap:8px;margin:0 8px 8px 0;padding:10px 16px;border-radius:24px;border:1px solid rgba(212,168,67,.35);background:rgba(255,255,255,.03);color:inherit;cursor:pointer;font:inherit;transition:.18s}',
    '.sb-chip:hover{border-color:var(--gold,#d4a843);transform:translateY(-1px)}',
    '.sb-chip.selected{background:rgba(212,168,67,.18);border-color:var(--gold,#d4a843);color:var(--gold,#e8cc80)}',
    '.sb-card{display:flex;flex-direction:column;gap:6px;text-align:left;padding:16px;border-radius:14px;border:1px solid rgba(212,168,67,.3);background:rgba(255,255,255,.03);cursor:pointer;transition:.18s}',
    '.sb-card:hover{border-color:var(--gold,#d4a843);transform:translateY(-2px)}',
    '.sb-card.selected{background:rgba(212,168,67,.16);border-color:var(--gold,#d4a843)}',
    '.sb-card .sb-card-emoji{font-size:1.8rem}',
    '.sb-card .sb-card-title{font-weight:600;color:var(--gold,#e8cc80)}',
    '.sb-card .sb-card-desc{font-size:.88rem;opacity:.8;line-height:1.5}',
    '.sb-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}',
    '.sb-input{width:100%;margin-top:6px;padding:11px 14px;border-radius:10px;border:1px solid rgba(212,168,67,.3);background:rgba(15,11,24,.6);color:inherit;font:inherit}',
    '.sb-rec{margin-top:16px;padding:18px;border-radius:14px;border:1px solid rgba(212,168,67,.3);background:linear-gradient(160deg,rgba(61,26,92,.25),rgba(13,26,18,.2))}',
    '.sb-rec h4{margin:0 0 6px;color:var(--gold,#e8cc80);font-family:"Cinzel Decorative",serif}',
    '.sb-rec-row{margin:8px 0;font-size:.95rem;line-height:1.6}',
    '.sb-rec-label{color:var(--gold,#d4a843);text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;display:block}'
  ].join('');
  document.head.appendChild(s);
}

function sbChip(type, value, label, multi) {
  var sel = multi ? (sbState[type] || []).indexOf(value) > -1 : sbState[type] === value;
  return '<button type="button" class="sb-chip' + (sel ? ' selected' : '') + '" data-sb="' + type + '" data-val="' + String(value).replace(/"/g, '&quot;') + '" data-multi="' + (multi ? '1' : '') + '">' + (label || value) + '</button>';
}

function sbRenderStep1() {
  var el = document.getElementById('sbBaseOptions'); if (!el) return;
  el.innerHTML =
    '<div class="sb-grp"><h4>What kind of bar calls to you?</h4><div class="sb-cards">' +
      SB_DATA.bases.map(function (b) {
        var sel = sbState.base === b.id ? ' selected' : '';
        return '<div class="sb-card' + sel + '" data-sb="base" data-val="' + b.id + '"><span class="sb-card-emoji">' + b.emoji + '</span><span class="sb-card-title">' + b.title + '</span><span class="sb-card-desc">' + b.desc + '</span></div>';
      }).join('') +
    '</div></div>' +
    '<div class="sb-grp"><h4>What are you hoping this soap helps you feel?</h4>' +
      SB_DATA.intentions.map(function (i) { return sbChip('intention', i, i, false); }).join('') +
    '</div>';
}
function sbRenderStep2() {
  var el = document.getElementById('sbScentOptions'); if (!el) return;
  el.innerHTML = '<div class="sb-grp"><h4>Which scent family are you drawn to?</h4>' +
    SB_DATA.scents.map(function (s) { return sbChip('scent', s.id, s.emoji + ' ' + s.id, false); }).join('') + '</div>';
}
function sbRenderStep3() {
  var el = document.getElementById('sbBenefitOptions'); if (!el) return;
  el.innerHTML =
    '<div class="sb-grp"><h4>What is your skin asking for?</h4>' +
      SB_DATA.skins.map(function (s) { return sbChip('skin', s, s, false); }).join('') + '</div>' +
    '<div class="sb-grp"><h4>What energy do you want this soap to carry? (choose any)</h4>' +
      SB_DATA.energies.map(function (e) { return sbChip('energies', e, e, true); }).join('') + '</div>' +
    '<div class="sb-grp"><h4>Would you like gentle exfoliation?</h4>' +
      sbChip('exfoliate', 'Yes, please', 'Yes, please', false) + sbChip('exfoliate', 'No, keep it smooth', 'No, keep it smooth', false) + '</div>';
}
function sbRenderStep4() {
  var el = document.getElementById('sbAddonOptions'); if (!el) return;
  el.innerHTML =
    '<div class="sb-grp"><h4>Choose real botanicals (optional, choose any)</h4>' +
      SB_DATA.botanicals.map(function (b) { return sbChip('botanicals', b, b, true); }).join('') + '</div>' +
    '<div class="sb-grp"><h4>Preferred natural color</h4>' +
      SB_DATA.colors.map(function (c) { return sbChip('color', c, c, false); }).join('') + '</div>' +
    '<div class="sb-grp"><h4>Any allergies, sensitivities, or ingredients to avoid?</h4>' +
      '<input type="text" class="sb-input" id="sbAvoid" placeholder="e.g., nut oils, fragrance, none" value="' + (sbState.avoid || '').replace(/"/g, '&quot;') + '"></div>' +
    '<div class="sb-grp"><h4>A note or magical intention for Amber (optional)</h4>' +
      '<textarea class="sb-input" id="sbNotes" rows="2" placeholder="Anything you would like woven into your bar...">' + (sbState.notes || '') + '</textarea></div>';
}

function sbRecommend() {
  var scent = SB_SCENT_MAP[sbState.scent] || SB_SCENT_MAP.Unscented;
  var skin = SB_SKIN_MAP[sbState.skin] || SB_SKIN_MAP.Balanced;
  var herbs = [].concat(scent.herbs, sbState.botanicals || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var oils = [].concat(scent.oils, skin.care).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  return { herbs: herbs, oils: oils, profile: scent.profile, benefit: skin.benefit };
}

function sbRenderReview() {
  var rec = sbRecommend();
  var rows = [
    ['Bar type', sbState.base], ['Intention', sbState.intention], ['Scent family', sbState.scent],
    ['Skin', sbState.skin], ['Energy', (sbState.energies || []).join(', ')], ['Exfoliation', sbState.exfoliate],
    ['Botanicals', (sbState.botanicals || []).join(', ')], ['Color', sbState.color], ['Avoid', sbState.avoid], ['Note', sbState.notes]
  ].filter(function (r) { return r[1]; });
  var panel = document.getElementById('sbReviewPanel');
  if (panel) panel.innerHTML = '<div class="sb-grp">' + rows.map(function (r) {
    return '<div class="sb-rec-row"><span class="sb-rec-label">' + r[0] + '</span>' + r[1] + '</div>';
  }).join('') + '</div>';
  var box = document.getElementById('sbSuggestionBox');
  if (box) box.innerHTML =
    '<div class="sb-rec"><h4>✦ Your Personalized Soap</h4>' +
      '<div class="sb-rec-row"><span class="sb-rec-label">Scent profile</span>' + rec.profile + '</div>' +
      '<div class="sb-rec-row"><span class="sb-rec-label">Suggested herbs &amp; botanicals</span>' + (rec.herbs.join(', ') || 'Keeper\'s choice') + '</div>' +
      '<div class="sb-rec-row"><span class="sb-rec-label">Suggested oils &amp; butters</span>' + (rec.oils.join(', ') || 'Shea butter + goat milk') + '</div>' +
      '<div class="sb-rec-row"><span class="sb-rec-label">Skin benefits</span>' + rec.benefit + (sbState.energies && sbState.energies.length ? ' · ' + sbState.energies.join(', ').toLowerCase() : '') + '</div>' +
      '<p style="margin:10px 0 0;font-style:italic;opacity:.85">Handcrafted by Amber with intention. $' + SOAP_PRICE.toFixed(2) + ' per bar.</p>' +
    '</div>';
}

function sbRenderLive() {
  var el = document.getElementById('sbLiveSummary');
  if (el) {
    var bits = [sbState.base, sbState.scent && sbState.scent + ' scent', sbState.skin && sbState.skin + ' skin', (sbState.energies || []).join('/'), sbState.color].filter(Boolean);
    el.innerHTML = bits.length ? bits.map(function (b) { return '<div class="sb-rec-row">✦ ' + b + '</div>'; }).join('') : '<p class="sb-empty">No selections yet</p>';
  }
  var p = document.getElementById('sbLivePrice'); if (p) p.textContent = '$' + SOAP_PRICE.toFixed(2);
}

function sbGoTo(n) {
  sbState.step = n;
  for (var i = 1; i <= 5; i++) {
    var step = document.getElementById('sbStep' + i);
    if (step) step.classList.toggle('active', i === n);
  }
  document.querySelectorAll('.sb-progress-step').forEach(function (el) {
    var s = parseInt(el.getAttribute('data-step'), 10);
    el.classList.toggle('active', s === n);
    el.classList.toggle('completed', s < n);
  });
  var prev = document.getElementById('sbPrevBtn'); if (prev) prev.style.display = n > 1 ? '' : 'none';
  var next = document.getElementById('sbNextBtn'); if (next) next.style.display = n < 5 ? '' : 'none';
  var add = document.getElementById('sbAddCartBtn'); if (add) add.style.display = n === 5 ? '' : 'none';
  if (n === 5) sbRenderReview();
  sbRenderLive();
}

function sbCaptureInputs() {
  var a = document.getElementById('sbAvoid'); if (a) sbState.avoid = a.value.trim();
  var nt = document.getElementById('sbNotes'); if (nt) sbState.notes = nt.value.trim();
}

function sbNextStep() {
  sbCaptureInputs();
  if (sbState.step === 1 && !sbState.base) { (window.showToast || window.alert)('Please choose a bar type to continue.'); return; }
  if (sbState.step === 2 && !sbState.scent) { (window.showToast || window.alert)('Please choose a scent family.'); return; }
  if (sbState.step < 5) sbGoTo(sbState.step + 1);
}
function sbPrevStep() { sbCaptureInputs(); if (sbState.step > 1) sbGoTo(sbState.step - 1); }
function sbStartNew() { sbReset(); sbRenderStep1(); sbRenderStep2(); sbRenderStep3(); sbRenderStep4(); sbGoTo(1); }

function openSoapBuilder() {
  sbInjectStyles();
  var modal = document.getElementById('soapBuilderModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (!sbState.base && !sbState.scent) { sbRenderStep1(); sbRenderStep2(); sbRenderStep3(); sbRenderStep4(); }
  sbGoTo(sbState.step || 1);

  if (!modal._sbWired) {
    modal._sbWired = true;
    modal.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-sb]') : null;
      if (!t) return;
      var type = t.getAttribute('data-sb'); var val = t.getAttribute('data-val'); var multi = t.getAttribute('data-multi') === '1';
      if (multi) {
        sbState[type] = sbState[type] || [];
        var idx = sbState[type].indexOf(val);
        if (idx > -1) sbState[type].splice(idx, 1); else sbState[type].push(val);
      } else {
        sbState[type] = (sbState[type] === val) ? null : val;
      }
      if (type === 'base' || type === 'intention') sbRenderStep1();
      else if (type === 'scent') sbRenderStep2();
      else if (type === 'skin' || type === 'energies' || type === 'exfoliate') sbRenderStep3();
      else if (type === 'botanicals' || type === 'color') sbRenderStep4();
      sbRenderLive();
    });
  }
}
function closeSoapBuilder() {
  var modal = document.getElementById('soapBuilderModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function sbAddToCart() {
  sbCaptureInputs();
  if (!sbState.base) { (window.showToast || window.alert)('Please choose a bar type first.'); sbGoTo(1); return; }
  var rec = sbRecommend();
  var opts = { __custom: true, 'Bar Type': sbState.base };
  if (sbState.intention) opts['Intention'] = sbState.intention;
  if (sbState.scent) opts['Scent'] = sbState.scent + ' (' + rec.profile + ')';
  if (sbState.skin) opts['Skin'] = sbState.skin;
  if (sbState.energies && sbState.energies.length) opts['Energy'] = sbState.energies.join(', ');
  if (sbState.exfoliate) opts['Exfoliation'] = sbState.exfoliate;
  if (sbState.botanicals && sbState.botanicals.length) opts['Botanicals'] = sbState.botanicals.join(', ');
  if (sbState.color) opts['Color'] = sbState.color;
  if (sbState.avoid) opts['Avoid'] = sbState.avoid;
  if (sbState.notes) opts['Note'] = sbState.notes;
  opts['Suggested herbs'] = rec.herbs.join(', ') || 'Keeper\'s choice';
  opts['Suggested oils/butters'] = rec.oils.join(', ') || 'Shea butter + goat milk';

  if (typeof window.addToCart === 'function') {
    window.addToCart('Custom Botanical Soap', SOAP_PRICE, 1, opts);
  } else if (window.AACart) {
    window.AACart.add({ id: 'custom-soap-' + Date.now(), name: 'Custom Botanical Soap', price: SOAP_PRICE, qty: 1, options: opts });
  }
  closeSoapBuilder();
  sbReset();
}

// ── Soap shop "Add to Cart" buttons (the 9 signature soaps + collections) ──
function addSoapToCart(name, price, btn) {
  if (typeof window.addToCart === 'function') window.addToCart(name, Number(price) || SOAP_PRICE, 1);
  else if (window.AACart) window.AACart.add({ id: 'soap-' + (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name, price: Number(price) || SOAP_PRICE, qty: 1 });
  if (btn) { var orig = btn.textContent; btn.textContent = '✦ Added!'; setTimeout(function () { btn.textContent = orig; }, 1400); }
}
