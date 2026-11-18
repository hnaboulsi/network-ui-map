kit.page('pods', function () {
  function linkStats(links) {
    let broken = 0, part = 0, full = 0, up = 0, tot = 0;
    for (const l of (links || [])) { up += l.up; tot += l.count; if (l.up < l.count) broken++; if (l.up === 0) full++; else if (l.up < l.count) part++; }
    return { uplinks: (links || []).length, broken, part, full, up, tot };
  }
  function buildAggregations(model, uplinksFn) {
    const spines = model.devices.filter(d => d.tier === 'spine');
    const supers = model.devices.filter(d => d.tier === 'super_spine');
    const info = new Map(); spines.forEach(d => info.set(d.id, linkStats(uplinksFn(d.id))));
    const superInfo = new Map(); supers.forEach(d => superInfo.set(d.id, { downlinks: 0, broken: 0, part: 0, full: 0, up: 0, tot: 0 }));
    spines.forEach(d => { for (const l of (uplinksFn(d.id) || [])) { const other = l.a === d.id ? l.b : l.a; const s = superInfo.get(other); if (!s) continue; s.downlinks++; s.up += l.up; s.tot += l.count; if (l.up < l.count) s.broken++; if (l.up === 0) s.full++; else if (l.up < l.count) s.part++; } });
    const spineRows = spines.map(d => { const i = info.get(d.id); return { id: d.id, site: d.site, pod: d.pod, plane: d.plane, uplinks: i.uplinks, broken: i.broken, part: i.part, full: i.full, drained: d.drained ? 'yes' : 'no' }; });
    const superRows = supers.map(d => { const i = superInfo.get(d.id); return { id: d.id, site: d.site, plane: d.plane, downlinks: i.downlinks, broken: i.broken, part: i.part, full: i.full, drained: d.drained ? 'yes' : 'no' }; });
    const podMap = new Map(), planeMap = new Map();
    for (const d of spines) { const i = info.get(d.id); const pk = d.site + '|' + d.pod; if (!podMap.has(pk)) podMap.set(pk, { site: d.site, pod: d.pod, spines: 0, spinesBroken: 0, broken: 0, part: 0, full: 0, drained: 0 }); const p = podMap.get(pk); p.spines++; if (i.broken > 0) p.spinesBroken++; p.broken += i.broken; p.part += i.part; p.full += i.full; if (d.drained) p.drained++;
      const lk = d.site + '|' + d.plane; if (!planeMap.has(lk)) planeMap.set(lk, { site: d.site, plane: d.plane, spines: 0, supers: 0, broken: 0, spinesBroken: 0 }); const pl = planeMap.get(lk); pl.spines++; pl.broken += i.broken; if (i.broken > 0) pl.spinesBroken++; }
    for (const d of supers) { const lk = d.site + '|' + d.plane; if (!planeMap.has(lk)) planeMap.set(lk, { site: d.site, plane: d.plane, spines: 0, supers: 0, broken: 0, spinesBroken: 0 }); planeMap.get(lk).supers++; }
    const siteMap = new Map();
    for (const d of spines) { if (!siteMap.has(d.site)) siteMap.set(d.site, { site: d.site, spines: 0, supers: 0, broken: 0, spinesBroken: 0, drained: 0 }); const s = siteMap.get(d.site), i = info.get(d.id); s.spines++; s.broken += i.broken; if (i.broken > 0) s.spinesBroken++; if (d.drained) s.drained++; }
    for (const d of supers) { if (!siteMap.has(d.site)) siteMap.set(d.site, { site: d.site, spines: 0, supers: 0, broken: 0, spinesBroken: 0, drained: 0 }); siteMap.get(d.site).supers++; }
    const pods = [...podMap.values()], planes = [...planeMap.values()], sites = [...siteMap.values()];
    const bySitePodPlane = (a, b) => String(a.site).localeCompare(String(b.site)) || ((a.pod || 0) - (b.pod || 0)) || ((a.plane || 0) - (b.plane || 0)) || String(a.id || '').localeCompare(String(b.id || ''));
    spineRows.sort(bySitePodPlane); superRows.sort(bySitePodPlane); pods.sort(bySitePodPlane); planes.sort(bySitePodPlane); sites.sort((a, b) => String(a.site).localeCompare(String(b.site)));
    return { spines, supers, info, superInfo, spineRows, superRows, pods, planes, sites };
  }
  let cleanup = null;
  function disposePrev() { if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; } }
  return {
    aggregations: { linkStats, buildAggregations },
    resize() { if (cleanup && cleanup.__resize) cleanup.__resize(); },
    mount(el, model, kit) {
      disposePrev(); el.innerHTML = '';
      const P = 'pd-';
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const style = document.createElement('style');
      style.textContent = `
.pd-root{position:absolute;inset:0;background:#0b0c0e;color:#f0efec;font-family:system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;font-size:13px}
.pd-canvas{position:absolute;inset:0}.pd-canvas canvas{display:block}
.pd-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.pd-lab{position:absolute;transform:translate(-50%,-100%);color:#a9a8a2;font-size:12px;white-space:nowrap;text-shadow:0 1px 4px #000}
.pd-lab.site{color:#f0efec;font-size:14px}.pd-lab.sun{color:#76756f;font-size:12px}
.pd-panel{background:#141518;border:1px solid rgba(255,255,255,.06);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.pd-crumbs{position:absolute;left:12px;top:12px;z-index:6;padding:10px 12px;max-width:calc(100% - 404px)}
.pd-crumbs nav{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.pd-crumb{background:none;border:none;color:#a9a8a2;font:inherit;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:6px}
.pd-crumb:hover{color:#f0efec;background:#1b1c1f}.pd-crumb:focus-visible,.pd-qbtn:focus-visible,.pd-tab:focus-visible,.pd-chip:focus-visible,.pd-filter:focus-visible,.pd-clear:focus-visible,.pd-table th:focus-visible,.pd-table tr:focus-visible{outline:2px solid #7c83ff;outline-offset:1px}
.pd-crumb.last{color:#7c83ff}.pd-sep{color:#76756f}
.pd-hint{color:#76756f;font-size:12px;margin-top:6px}.pd-hint kbd,.pd-kbd{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#1b1c1f;border:1px solid #2a2b2f;border-radius:4px;padding:1px 5px;color:#a9a8a2}
.pd-summary{position:absolute;left:12px;top:92px;z-index:6;color:#a9a8a2;font-size:12px;padding:7px 10px}
.pd-summary b{color:#f0efec;font-weight:600}
.pd-legend{position:absolute;left:12px;bottom:12px;z-index:6;max-width:240px}
.pd-legend h4,.pd-detail h4{margin:0 0 8px;font-size:13px;font-weight:600;color:#f0efec}
.pd-legpill{display:flex;align-items:center;gap:7px;background:#141518;border:1px solid rgba(255,255,255,.08);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.35);color:#f0efec;font:inherit;font-size:12px;padding:7px 11px;cursor:pointer}
.pd-legpill:hover{border-color:#7c83ff}.pd-legpill:focus-visible{outline:2px solid #7c83ff;outline-offset:1px}
.pd-legpill .pd-chev{color:#a9a8a2;transition:transform .15s}.pd-legend.open .pd-chev{transform:rotate(180deg)}
.pd-legbody{display:none;padding:10px 12px;margin-bottom:8px;max-height:46vh;overflow:auto}
.pd-legend.open .pd-legbody{display:block}
.pd-legrow{display:flex;gap:8px;align-items:flex-start;padding:3px 0;color:#a9a8a2;font-size:12px;line-height:1.35;width:100%;background:none;border:none;font:inherit;text-align:left;border-radius:6px}
button.pd-legrow{cursor:pointer}button.pd-legrow:hover{color:#f0efec}button.pd-legrow.on{background:#1b1c1f;box-shadow:inset 0 0 0 1px #7c83ff}
.pd-dot{width:10px;height:10px;border-radius:3px;background:#4a4c52;flex:none;margin-top:2px}.pd-dot.part{background:#fab219}.pd-dot.down{background:#d03b3b;height:14px;margin-top:0}.pd-dot.off{background:transparent;border:1px solid #a9a8a2}.pd-dot.sel{background:transparent;border:2px solid #fff;width:8px;height:8px}.pd-dot.super{width:14px;height:7px;margin-top:4px}.pd-dot.spine{width:8px;height:8px;margin-top:3px}
.pd-line{width:16px;height:0;flex:none;margin-top:7px;border-top:2px solid rgba(255,255,255,.18)}.pd-line.part{border-top-color:#fab219}.pd-line.down{border-top:3px solid #d03b3b}
.pd-legrow b{color:#f0efec;font-weight:600}.pd-legtot{color:#76756f;font-size:11px;margin:7px 0 0;line-height:1.4}
.pd-detail{position:absolute;left:12px;bottom:64px;z-index:6;padding:12px;width:300px;max-height:300px;overflow:auto}
.pd-detail:empty{display:none}
.pd-detail p{margin:4px 0;color:#a9a8a2;font-size:12px;line-height:1.45}
.pd-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.pd-chip{background:#1b1c1f;color:#f0efec;border:1px solid #2a2b2f;border-radius:999px;padding:4px 8px;font-size:12px;cursor:pointer;transition:all .15s}
.pd-chip:hover{border-color:#7c83ff}.pd-chip .pd-dot{display:inline-block;margin:0 5px 0 0;vertical-align:-1px}
.pd-linkrow{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;background:none;border:none;border-top:1px solid #2a2b2f;color:#f0efec;font:inherit;font-size:12px;padding:6px 2px;cursor:pointer}
.pd-linkrow:hover{color:#7c83ff}.pd-linkrow span:last-child{color:#a9a8a2;font-family:ui-monospace,Menlo,monospace}
.pd-cross{margin-top:10px;background:none;border:1px solid #2a2b2f;color:#7c83ff;border-radius:8px;padding:6px 9px;font-size:12px;cursor:pointer}
.pd-side{position:absolute;top:10px;right:10px;bottom:10px;width:380px;max-width:calc(100% - 20px);z-index:7;display:flex;flex-direction:column;overflow:hidden;background:#141518;border:1px solid rgba(255,255,255,.06);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.pd-side h3{margin:12px 14px 8px;font-size:13px;font-weight:600}
.pd-finder{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 14px}
.pd-qbtn{background:#1b1c1f;color:#f0efec;border:1px solid #2a2b2f;border-radius:8px;padding:7px 8px;font-size:12px;cursor:pointer;text-align:left;transition:all .15s;line-height:1.3}
.pd-qbtn:hover{border-color:#7c83ff}.pd-qbtn.on{background:#7c83ff;border-color:#7c83ff;color:#fff}
.pd-tabs{display:flex;gap:4px;padding:12px 14px 0;flex-wrap:wrap}
.pd-tab{background:none;color:#a9a8a2;border:none;border-bottom:2px solid transparent;padding:5px 7px;font-size:12px;cursor:pointer;transition:all .15s}
.pd-tab:hover{color:#f0efec}.pd-tab.on{color:#7c83ff;border-bottom-color:#7c83ff}
.pd-subtitle{padding:6px 14px 0;font-size:12px;color:#76756f}
.pd-filterrow{display:flex;gap:6px;align-items:center;padding:8px 14px}
.pd-filter{flex:1;min-width:0;background:#111214;border:1px solid #2a2b2f;border-radius:8px;color:#f0efec;padding:6px 8px;font-size:12px}
.pd-clear{background:#1b1c1f;color:#a9a8a2;border:1px solid #2a2b2f;border-radius:8px;width:28px;height:28px;cursor:pointer;flex:none}
.pd-count{font-size:12px;color:#76756f;font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.pd-scroll{overflow:auto;flex:1;padding:0 8px 10px}
.pd-table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}
.pd-table th{position:sticky;top:0;z-index:2;background:#141518;color:#a9a8a2;cursor:pointer;text-align:left;padding:6px 5px;border-bottom:1px solid #2a2b2f;user-select:none;font-weight:600;line-height:1.25;vertical-align:bottom}
.pd-table th:hover{color:#f0efec}.pd-table th.sorted{color:#f0efec;background:#1e1f24}
.pd-table td{padding:0 5px;height:28px;border-bottom:1px solid #222328;color:#f0efec;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.pd-table td:first-child{font-family:system-ui,sans-serif}
.pd-table td.sortedcol{background:rgba(124,131,255,.10)}
.pd-table tbody tr{cursor:pointer;transition:background .15s}.pd-table tbody tr:hover{background:#1b1c1f}
.pd-table tbody tr.first{outline:1px solid #7c83ff;outline-offset:-1px}
.pd-status{display:inline-flex;align-items:center;gap:6px}
.pd-tip{position:absolute;pointer-events:none;background:#141518;border:1px solid #2a2b2f;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:9px 11px;font-size:12px;z-index:9;display:none;max-width:280px;line-height:1.5;color:#a9a8a2}
.pd-tip b{color:#f0efec}.pd-muted{color:#76756f}
@media (max-width:760px){.pd-side{width:calc(100% - 20px)}.pd-crumbs,.pd-summary,.pd-legend,.pd-detail{display:none}}
`;
      const root = document.createElement('div'); root.className = P + 'root';
      const canvasWrap = document.createElement('div'); canvasWrap.className = P + 'canvas';
      const labels = document.createElement('div'); labels.className = P + 'labels';
      const crumbs = document.createElement('div'); crumbs.className = P + 'panel ' + P + 'crumbs';
      const summary = document.createElement('div'); summary.className = P + 'panel ' + P + 'summary';
      const detail = document.createElement('div'); detail.className = P + 'panel ' + P + 'detail';
      const legend = document.createElement('div'); legend.className = P + 'legend';
      let legendOpen = false, statusFilter = null;
      function renderLegend() {
        const c = { ok: 0, part: 0, down: 0, off: 0 }; allDevs.forEach(d => { c[statusOf(d).k]++; });
        const totLinks = linkPairs.length, totBroken = linkPairs.filter(x => x.link.up < x.link.count).length;
        const row = (k, sw, word, def) => '<button class="' + P + 'legrow' + (statusFilter === k ? ' on' : '') + '" data-status="' + k + '" title="Show only this status"><span class="' + P + 'dot ' + sw + '"></span><span><b>' + word + '</b> — ' + def + '</span></button>';
        legend.innerHTML = '<div class="' + P + 'panel ' + P + 'legbody"><h4>Legend</h4>' +
          row('ok', '', 'OK', 'all links working') + row('part', 'part', 'Partly down', 'some links in an uplink are down') + row('down', 'down', 'Down', 'no working links; taller box') + row('off', 'off', 'Turned off', 'drained on purpose; hollow box') +
          '<div class="' + P + 'legrow"><span class="' + P + 'dot sel"></span><span><b>Selected</b> — white outline</span></div>' +
          '<div class="' + P + 'legrow"><span class="' + P + 'line"></span><span><b>Link up</b> — faint line between tiers</span></div>' +
          '<div class="' + P + 'legrow"><span class="' + P + 'line part"></span><span><b>Partly down</b> — some links down</span></div>' +
          '<div class="' + P + 'legrow"><span class="' + P + 'line down"></span><span><b>Link down</b> — no links working</span></div>' +
          '<div class="' + P + 'legrow"><span class="' + P + 'dot spine"></span><span><b>Spine</b> — small box, low on its pod</span></div>' +
          '<div class="' + P + 'legrow"><span class="' + P + 'dot super"></span><span><b>Super-spine</b> — wide box, high by plane</span></div>' +
          '<p class="' + P + 'legtot">' + allDevs.length + ' devices · ' + c.ok + ' OK · ' + c.part + ' partly down · ' + c.down + ' down · ' + c.off + ' turned off · ' + totBroken + ' of ' + totLinks + ' uplinks broken</p></div>' +
          '<button class="' + P + 'legpill" aria-expanded="' + legendOpen + '">Legend <span class="' + P + 'chev">▾</span> <span class="' + P + 'kbd">L</span></button>';
        legend.classList.toggle('open', legendOpen);
        legend.querySelector('.' + P + 'legpill').onclick = () => setLegend(!legendOpen);
        legend.querySelectorAll('[data-status]').forEach(b => b.onclick = () => { statusFilter = statusFilter === b.getAttribute('data-status') ? null : b.getAttribute('data-status'); renderLegend(); applyColors(); });
        detail.style.bottom = (legend.offsetHeight + 24) + 'px';
      }
      function setLegend(open) { legendOpen = open && root.clientHeight >= 430; renderLegend(); }
      const side = document.createElement('div'); side.className = P + 'side';
      side.innerHTML = '<h3>Find an answer</h3><div class="' + P + 'finder"></div><div class="' + P + 'tabs"></div><div class="' + P + 'subtitle"></div><div class="' + P + 'filterrow"><input class="' + P + 'filter" type="text" aria-label="Filter table rows" placeholder="Filter rows…  ( / )"><button class="' + P + 'clear" title="Clear filter" aria-label="Clear filter">×</button><span class="' + P + 'count"></span></div><div class="' + P + 'scroll"></div>';
      const tip = document.createElement('div'); tip.className = P + 'tip';
      root.append(style, canvasWrap, labels, crumbs, summary, detail, legend, side, tip); el.appendChild(root);
      const finder = side.querySelector('.' + P + 'finder'), tabBar = side.querySelector('.' + P + 'tabs'), subtitle = side.querySelector('.' + P + 'subtitle'), filterInput = side.querySelector('.' + P + 'filter'), clearBtn = side.querySelector('.' + P + 'clear'), countEl = side.querySelector('.' + P + 'count'), scroll = side.querySelector('.' + P + 'scroll');
      clearBtn.onclick = () => { filterInput.value = ''; renderTables(); filterInput.focus(); };
      filterInput.addEventListener('input', renderTables);

      const AGG = buildAggregations(model, id => kit.uplinks(id));
      const spines = AGG.spines, supers = AGG.supers, spineInfo = AGG.info, superInfo = AGG.superInfo, byId = new Map(model.devices.map(d => [d.id, d]));
      const allDevs = spines.concat(supers);
      function devInfo(d) { return d.tier === 'spine' ? spineInfo.get(d.id) : superInfo.get(d.id); }
      function statusOf(d) { const i = devInfo(d); if (d.drained) return { k: 'off', word: 'Turned off', color: '#a9a8a2' }; if (i && i.full > 0) return { k: 'down', word: 'Down', color: '#d03b3b' }; if (i && i.part > 0) return { k: 'part', word: 'Partly down', color: '#fab219' }; return { k: 'ok', word: 'OK', color: '#4a4c52' }; }
      const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // Layout from data only
      const siteCodes = model.sites.map(s => s.code);
      const siteInfo = new Map(); let maxR = 6;
      for (const code of siteCodes) {
        const sSp = spines.filter(d => d.site === code), sSu = supers.filter(d => d.site === code);
        const podNums = [...new Set(sSp.map(d => d.pod))].sort((a, b) => a - b);
        const planeNums = [...new Set(sSp.concat(sSu).map(d => d.plane))].sort((a, b) => a - b);
        const cols = Math.max(1, Math.ceil(Math.sqrt(podNums.length || 1))), rows = Math.max(1, Math.ceil((podNums.length || 1) / cols));
        const w = Math.max(cols * 11, (planeNums.length || 1) * 5), dep = rows * 10 + 4, R = Math.sqrt(w * w + dep * dep) / 2 + 1.8; if (R > maxR) maxR = R;
        siteInfo.set(code, { code, podNums, planeNums, cols, rows, w, dep, R, cx: 0, cz: 0, ringR: 0 });
      }
      siteCodes.forEach((code, i) => { const s = siteInfo.get(code); s.ringR = siteCodes.length === 1 ? 0 : maxR * 2 + 10; const ang = siteCodes.length === 1 ? 0 : -Math.PI / 2 + i * (Math.PI * 2 / siteCodes.length); s.cx = Math.cos(ang) * s.ringR; s.cz = Math.sin(ang) * s.ringR; });
      const podCenter = new Map(), pos = new Map();
      for (const s of siteInfo.values()) s.podNums.forEach((p, pi) => podCenter.set(s.code + '|' + p, new THREE.Vector3(s.cx + ((pi % s.cols) - (s.cols - 1) / 2) * 11, 0, s.cz + (Math.floor(pi / s.cols) - (s.rows - 1) / 2) * 10)));
      const groups = new Map();
      spines.forEach(d => { const k = d.site + '|' + d.pod + '|' + d.plane; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
      spines.forEach(d => { const s = siteInfo.get(d.site), c = podCenter.get(d.site + '|' + d.pod) || new THREE.Vector3(s.cx, 0, s.cz); const same = groups.get(d.site + '|' + d.pod + '|' + d.plane); const idx = same.indexOf(d); const pli = s.planeNums.indexOf(d.plane); pos.set(d.id, new THREE.Vector3(c.x + (pli - (s.planeNums.length - 1) / 2) * 2.2, 2, c.z + (idx - (same.length - 1) / 2) * 1.5)); });
      const sgroups = new Map(); supers.forEach(d => { const k = d.site + '|' + d.plane; if (!sgroups.has(k)) sgroups.set(k, []); sgroups.get(k).push(d); });
      supers.forEach(d => { const s = siteInfo.get(d.site); if (!s) { pos.set(d.id, new THREE.Vector3(0, 10, 0)); return; } const same = sgroups.get(d.site + '|' + d.plane); const idx = same.indexOf(d); const pli = s.planeNums.indexOf(d.plane); const perRow = Math.max(1, Math.ceil(Math.sqrt(same.length))); pos.set(d.id, new THREE.Vector3(s.cx + ((idx % perRow) - (perRow - 1) / 2) * 1.9 + (pli - (s.planeNums.length - 1) / 2) * (perRow * 1.9 + 1.5), 9 + pli * 1.6, s.cz + (Math.floor(idx / perRow) - 0.5) * 1.7)); });
      const ctxDevs = model.devices.filter(d => d.tier === 'border' || d.tier === 'backbone_router');
      ctxDevs.forEach(d => { const s = siteInfo.get(d.site); if (!s) return; const same = ctxDevs.filter(x => x.site === d.site && x.tier === d.tier); const idx = same.indexOf(d); pos.set(d.id, new THREE.Vector3(s.cx + (idx - (same.length - 1) / 2) * 2.4, d.tier === 'border' ? 16 : 20, s.cz)); });
      // Scene
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); canvasWrap.appendChild(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0c0e);
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1500);
      const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = !reduced; controls.dampingFactor = 0.08;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(30, 60, 20); scene.add(dl);
      // stars: static, faint
      (function () { const N = 380, a = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const r = 380 + Math.random() * 120, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); a[i * 3] = r * Math.sin(ph) * Math.cos(th); a[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.5 + 5; a[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.3 }))); })();
      function haloTex() { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(244,239,230,0.55)'); g.addColorStop(0.35, 'rgba(244,239,230,0.14)'); g.addColorStop(1, 'rgba(244,239,230,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); }
      const sun = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 })); sun.position.set(0, 1, 0); scene.add(sun);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), transparent: true, depthWrite: false, opacity: 0.8 })); halo.scale.set(9, 9, 1); halo.position.copy(sun.position); scene.add(halo);
      const labelItems = [];
      function addLabel(text, p, cls, kind, site, pod) { const d = document.createElement('div'); d.className = P + 'lab ' + (cls || ''); d.textContent = text; labels.appendChild(d); const it = { el: d, pos: p.clone(), kind, site, pod }; labelItems.push(it); return it; }
      addLabel(model.name || 'Topology', new THREE.Vector3(0, 3.6, 0), 'sun', 'sun');
      function circlePts(cx, cz, r, y) { const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } return pts; }
      const deckMeshes = [];
      for (const s of siteInfo.values()) {
        if (s.ringR > 0) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(0, 0, s.ringR, 0)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 })));
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(s.R, s.R, 0.18, 56), new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.9, metalness: 0 })); disc.position.set(s.cx, -0.09, s.cz); disc.userData.site = s.code; scene.add(disc); deckMeshes.push(disc);
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(s.cx, s.cz, s.R, 0.02)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 })));
        addLabel(kit.siteName(s.code), new THREE.Vector3(s.cx, 1.2, s.cz - s.dep / 2 - 1.2), 'site', 'site', s.code);
        for (const pl of s.planeNums) { const ps = supers.filter(d => d.site === s.code && d.plane === pl && pos.get(d.id)); if (ps.length) { const c = ps.reduce((a, d) => a.add(pos.get(d.id)), new THREE.Vector3()).multiplyScalar(1 / ps.length); addLabel('Plane ' + pl, new THREE.Vector3(c.x, c.y + 1.3, c.z), '', 'plane', s.code); } }
        if (ctxDevs.some(d => d.site === s.code && d.tier === 'border')) addLabel('Border', new THREE.Vector3(s.cx, 17.3, s.cz), 'sun', 'ctx', s.code);
        if (ctxDevs.some(d => d.site === s.code && d.tier === 'backbone_router')) addLabel('Backbone', new THREE.Vector3(s.cx, 21.3, s.cz), 'sun', 'ctx', s.code);
        for (const p of s.podNums) { const c = podCenter.get(s.code + '|' + p); const w2 = 9.6, d2 = 8.4; const pts = [new THREE.Vector3(c.x - w2 / 2, 0.03, c.z - d2 / 2), new THREE.Vector3(c.x + w2 / 2, 0.03, c.z - d2 / 2), new THREE.Vector3(c.x + w2 / 2, 0.03, c.z + d2 / 2), new THREE.Vector3(c.x - w2 / 2, 0.03, c.z + d2 / 2), new THREE.Vector3(c.x - w2 / 2, 0.03, c.z - d2 / 2)]; scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 }))); addLabel('Pod ' + p, new THREE.Vector3(c.x - w2 / 2 + 0.8, 0.4, c.z - d2 / 2 + 0.6), '', 'pod', s.code, p); }
      }
      // Instanced devices: solid + drained wireframe
      const dummy = new THREE.Object3D();
      const solidDevs = allDevs.filter(d => !d.drained), drainedDevs = allDevs.filter(d => d.drained);
      const solidMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 0.7, 1.05), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }), Math.max(1, solidDevs.length));
      const drainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.75, 1.15), new THREE.MeshBasicMaterial({ color: 0xa9a8a2, wireframe: true, transparent: true, opacity: 0.9 }), Math.max(1, drainedDevs.length));
      const loc = new Map();
      function fillMesh(mesh, list, isSuperScale) { list.forEach((d, i) => { const v = pos.get(d.id); const st = statusOf(d); dummy.position.copy(v); if (st.k === 'down') dummy.position.y = v.y + 0.25; dummy.rotation.set(0, 0, 0); const sc = d.tier === 'super_spine' ? 1.45 : 1; dummy.scale.set(sc, sc * (st.k === 'down' ? 1.7 : 1), sc); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); loc.set(d.id, { mesh, index: i }); }); scene.add(mesh); }
      fillMesh(solidMesh, solidDevs); fillMesh(drainMesh, drainedDevs); solidMesh.count = solidDevs.length; drainMesh.count = drainedDevs.length;
      const ctxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.8, transparent: true, opacity: 0.75 }), Math.max(1, ctxDevs.length));
      ctxDevs.forEach((d, i) => { const v = pos.get(d.id); if (!v) return; dummy.position.copy(v); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(d.tier === 'backbone_router' ? 1.3 : 1.1); dummy.updateMatrix(); ctxMesh.setMatrixAt(i, dummy.matrix); }); ctxMesh.count = ctxDevs.length; scene.add(ctxMesh);
      // Links
      function lineGroup(pairs, color, opacity, lw) { const pts = []; pairs.forEach(pr => pts.push(pr[0].x, pr[0].y, pr[0].z, pr[1].x, pr[1].y, pr[1].z)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, linewidth: lw || 1 })); scene.add(m); return m; }
      const healthyPairs = [], partPairs = [], fullPairs = [], linkPairs = [];
      spines.forEach(d => { const a = pos.get(d.id); for (const l of kit.uplinks(d.id)) { const other = l.a === d.id ? l.b : l.a; const b = pos.get(other); if (!b) continue; linkPairs.push({ from: d.id, to: other, link: l }); if (l.up === l.count) healthyPairs.push([a, b]); else if (l.up === 0) fullPairs.push([a, b]); else partPairs.push([a, b]); } });
      const healthyLines = lineGroup(healthyPairs, 0xffffff, 0.07);
      const partLines = lineGroup(partPairs, 0xfab219, 0.95, 2), fullLines = lineGroup(fullPairs, 0xd03b3b, 1, 2);
      const ctxPairs = []; ctxDevs.concat(supers).forEach(d => { const a = pos.get(d.id); if (!a) return; for (const l of kit.linksOf(d.id)) { const other = l.a === d.id ? l.b : l.a; const od = byId.get(other); if (!od || !(od.tier === 'border' || od.tier === 'backbone_router')) continue; if (d.tier !== 'super_spine' && d.tier !== 'border') continue; const b = pos.get(other); if (b && a.y < b.y) ctxPairs.push([a, b]); } });
      const ctxLines = lineGroup(ctxPairs, 0xffffff, 0.05);
      let focusLines = null;
      function rebuildFocus() { if (focusLines) { scene.remove(focusLines); focusLines.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); focusLines = null; } const focused = nav.level === 'pod' || nav.level === 'device'; healthyLines.material.opacity = focused ? 0.025 : 0.07; partLines.material.opacity = focused ? 0.25 : 0.95; fullLines.material.opacity = focused ? 0.3 : 1; ctxLines.material.opacity = focused ? 0.02 : 0.05; if (!focused) return; const hp = [], pp = [], fp = []; linkPairs.forEach(x => { const sd = byId.get(x.from); const inPod = nav.level === 'device' ? (x.from === nav.id || x.to === nav.id) : sd && sd.site === nav.site && sd.pod === nav.pod; if (!inPod) return; const pr = [pos.get(x.from), pos.get(x.to)]; if (x.link.up === x.link.count) hp.push(pr); else if (x.link.up === 0) fp.push(pr); else pp.push(pr); }); const g = new THREE.Group(); [[hp, 0xffffff, 0.5, 1], [pp, 0xfab219, 1, 2], [fp, 0xd03b3b, 1, 2]].forEach(([pairs, col, op, lw]) => { if (!pairs.length) return; const pts = []; pairs.forEach(pr => pts.push(pr[0].x, pr[0].y, pr[0].z, pr[1].x, pr[1].y, pr[1].z)); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, linewidth: lw }))); }); scene.add(g); focusLines = g; }
      renderLegend();
      const hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.3, 1.6)), new THREE.LineBasicMaterial({ color: 0xffffff })); hoverBox.visible = false; scene.add(hoverBox);
      const selBox = hoverBox.clone(); selBox.material = new THREE.LineBasicMaterial({ color: 0xffffff }); selBox.visible = false; scene.add(selBox);
      // Nav state
      let nav = { level: 'system', site: null, pod: null, id: null };
      let suppressSelect = false, hoverId = null, drift = !reduced, userDriftStop = false;
      const planetGroupsAngle = new Map(); // for optional drift we rotate nothing (positions static for reliable clicking); drift skipped for click reliability
      function inScope(d) {
        if (nav.level === 'system') return true;
        if (nav.level === 'site') return d.site === nav.site;
        if (nav.level === 'pod') { if (d.tier === 'spine') return d.site === nav.site && d.pod === nav.pod; const linked = spines.some(s => s.site === nav.site && s.pod === nav.pod && kit.uplinks(s.id).some(l => (l.a === s.id ? l.b : l.a) === d.id)); return linked; }
        if (nav.level === 'device') { if (d.id === nav.id) return true; const cur = byId.get(nav.id); if (!cur) return false; return kit.linksOf(nav.id).some(l => (l.a === nav.id ? l.b : l.a) === d.id); }
        return true;
      }
      function applyColors() {
        allDevs.forEach(d => { const L = loc.get(d.id); if (!L) return; const st = statusOf(d); let col = new THREE.Color(st.k === 'off' ? 0xa9a8a2 : st.color); if (!inScope(d)) col.multiplyScalar(0.15); if (statusFilter && st.k !== statusFilter) col.multiplyScalar(0.08); L.mesh.setColorAt(L.index, col); });
        if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true; if (drainMesh.instanceColor) drainMesh.instanceColor.needsUpdate = true;
        rebuildFocus();
        const sel = nav.level === 'device' ? byId.get(nav.id) : null; if (sel && pos.get(sel.id)) { selBox.position.copy(pos.get(sel.id)); selBox.visible = true; } else selBox.visible = false;
      }
      function sysBounds() { let a = 1e9, b = -1e9, c = 1e9, e = -1e9; for (const s of siteInfo.values()) { a = Math.min(a, s.cx - s.R); b = Math.max(b, s.cx + s.R); c = Math.min(c, s.cz - s.R); e = Math.max(e, s.cz + s.R); } if (!siteInfo.size) { a = -10; b = 10; c = -10; e = 10; } return { cx: (a + b) / 2, cz: (c + e) / 2, span: Math.max(b - a, e - c, 10) }; }
      const fly = { active: false, t: 0, dur: 0.4, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
      function flyTo(center, span) { const dist = Math.max(span * 1.05, 16); const tp = new THREE.Vector3(center.x + dist * 0.5, 5 + dist * 0.55, center.z + dist * 0.72); if (reduced) { camera.position.copy(tp); controls.target.set(center.x, 5, center.z); controls.update(); return; } fly.fromP.copy(camera.position); fly.fromT.copy(controls.target); fly.toP.copy(tp); fly.toT.set(center.x, 5, center.z); fly.t = 0; fly.active = true; }
      function scopeCounts() { const list = allDevs.filter(inScope); let down = 0, part = 0, off = 0; list.forEach(d => { const k = statusOf(d).k; if (k === 'down') down++; else if (k === 'part') part++; else if (k === 'off') off++; }); return { n: list.length, down, part, off, spines: list.filter(d => d.tier === 'spine').length, supers: list.filter(d => d.tier === 'super_spine').length }; }
      function renderChrome() {
        const crumbsArr = [{ label: 'All sites', nav: { level: 'system', site: null, pod: null, id: null } }];
        if (nav.site) crumbsArr.push({ label: kit.siteName(nav.site), nav: { level: 'site', site: nav.site, pod: null, id: null } });
        if (nav.site && nav.pod != null) crumbsArr.push({ label: 'Pod ' + nav.pod, nav: { level: 'pod', site: nav.site, pod: nav.pod, id: null } });
        if (nav.id) crumbsArr.push({ label: nav.id, nav: nav });
        crumbs.innerHTML = '<nav><button class="' + P + 'crumb" data-back="1">← Back</button>' + crumbsArr.map((c, i) => (i ? '<span class="' + P + 'sep">›</span>' : '') + '<button class="' + P + 'crumb' + (i === crumbsArr.length - 1 ? ' last' : '') + '" data-i="' + i + '">' + esc(c.label) + '</button>').join('') + '</nav><div class="' + P + 'hint">Click a site, then a pod, then a device. <span class="' + P + 'kbd">Esc</span> goes back.</div>';
        crumbs.querySelector('[data-back]').onclick = goBack;
        crumbs.querySelectorAll('[data-i]').forEach(b => b.onclick = () => go(crumbsArr[+b.getAttribute('data-i')].nav));
        const c = scopeCounts(); const scopeName = nav.level === 'system' ? 'All sites' : nav.level === 'site' ? kit.siteName(nav.site) : nav.level === 'pod' ? kit.siteName(nav.site) + ' · Pod ' + nav.pod : nav.id;
        const podCount = nav.level === 'system' ? AGG.pods.length : nav.level === 'site' ? AGG.pods.filter(p => p.site === nav.site).length : nav.pod != null ? 1 : 0;
        summary.innerHTML = '<b>' + esc(scopeName) + '</b> · ' + podCount + ' pods · ' + c.spines + ' spines · ' + c.supers + ' super-spines · ' + c.down + ' down · ' + c.part + ' partly down · ' + c.off + ' turned off';
      }
      function renderDetail() {
        detail.innerHTML = '';
        if (nav.level === 'pod') {
          const list = spines.filter(d => d.site === nav.site && d.pod === nav.pod); const c = { ok: 0, part: 0, down: 0, off: 0 }; list.forEach(d => { const k = statusOf(d).k; c[k === 'part' ? 'part' : k]++; });
          const bad = list.filter(d => statusOf(d).k !== 'ok');
          detail.innerHTML = '<h4>Pod ' + esc(nav.pod) + ' · ' + esc(kit.siteName(nav.site)) + '</h4><p>' + list.length + ' spines · ' + c.down + ' down · ' + c.part + ' partly down · ' + c.off + ' turned off · ' + c.ok + ' OK</p>' + (bad.length ? '<div class="' + P + 'chips">' + bad.map(d => { const st = statusOf(d); return '<button class="' + P + 'chip" data-id="' + esc(d.id) + '"><span class="' + P + 'dot ' + (st.k === 'part' ? 'part' : st.k === 'down' ? 'down' : 'off') + '"></span>' + esc(d.id) + '</button>'; }).join('') + '</div>' : '<p>No devices with a problem in this pod.</p>') + '<button class="' + P + 'cross">Open this pod in Racks →</button>';
          detail.querySelectorAll('[data-id]').forEach(b => b.onclick = () => go({ level: 'device', site: nav.site, pod: nav.pod, id: b.getAttribute('data-id') }));
          detail.querySelector('.' + P + 'cross').onclick = () => { const first = list[0]; if (first) { suppressSelect = true; kit.select(first.id); suppressSelect = false; } kit.showPage('racks'); };
        } else if (nav.level === 'device') {
          const d = byId.get(nav.id); if (!d) return; const st = statusOf(d); const i = devInfo(d);
          const links = kit.linksOf(d.id).map(l => { const peer = l.a === d.id ? l.b : l.a; return { peer, l }; });
          detail.innerHTML = '<h4>' + esc(d.id) + '</h4><p><span class="' + P + 'dot ' + (st.k === 'part' ? 'part' : st.k === 'down' ? 'down' : st.k === 'off' ? 'off' : '') + '" style="display:inline-block;margin-right:6px"></span><b style="color:#f0efec">' + st.word + '</b> · ' + (i ? i.up + ' of ' + i.tot + ' links working' : '') + '</p><p>' + esc(kit.siteName(d.site)) + (d.pod != null ? ' · Pod ' + d.pod : '') + (d.plane != null ? ' · Plane ' + d.plane : '') + ' · ' + (d.tier === 'spine' ? 'Spine' : 'Super-spine') + '</p>' + links.map(x => '<button class="' + P + 'linkrow" data-peer="' + esc(x.peer) + '"><span>→ ' + esc(x.peer) + '</span><span>' + x.l.up + '/' + x.l.count + (x.l.up === x.l.count ? ' working' : x.l.up === 0 ? ' down' : ' partly down') + '</span></button>').join('') + (d.pod != null ? '<button class="' + P + 'cross">Open this pod in Racks →</button>' : '');
          detail.querySelectorAll('[data-peer]').forEach(b => { b.onclick = () => { const peer = b.getAttribute('data-peer'); const pd = byId.get(peer); if (pd && (pd.tier === 'spine' || pd.tier === 'super_spine')) go({ level: 'device', site: pd.site, pod: pd.pod, id: peer }); else { suppressSelect = true; kit.select(peer); suppressSelect = false; kit.showPage(pd && pd.tier === 'top_of_rack' ? 'racks' : 'pods'); } }; });
          const cross = detail.querySelector('.' + P + 'cross'); if (cross) cross.onclick = () => { suppressSelect = true; kit.select(d.tier === 'spine' ? d.id : (links[0] && links[0].peer) || d.id); suppressSelect = false; kit.showPage('racks'); };
        }
      }
      // Table
      let activeTab = 'spines', quickActive = null;
      const sorts = { spines: { k: 'site', dir: 1, def: true }, pods: { k: 'site', dir: 1, def: true }, planes: { k: 'site', dir: 1, def: true }, supers: { k: 'site', dir: 1, def: true }, sites: { k: 'site', dir: 1, def: true } };
      const COLS = {
        spines: [{ k: 'id', label: 'Spine', title: 'Spine identifier.' }, { k: 'site', label: 'Site', title: 'Site code.' }, { k: 'pod', label: 'Pod', title: 'Pod number.' }, { k: 'plane', label: 'Plane', title: 'Plane number.' }, { k: 'broken', label: 'Broken<br>uplinks', title: 'Uplinks where up is less than count.', key: 1 }, { k: 'uplinks', label: 'Uplinks', title: 'Number of uplinks to super-spines.' }, { k: 'part', label: 'Partly<br>broken', title: 'Uplinks where some but not all links work.' }, { k: 'full', label: 'Fully<br>broken', title: 'Uplinks where no links work.' }, { k: 'drained', label: 'Turned<br>off', title: 'Drained on purpose.' }],
        pods: [{ k: 'site', label: 'Site', title: 'Site code.' }, { k: 'pod', label: 'Pod', title: 'Pod number.' }, { k: 'broken', label: 'Broken<br>uplinks', title: 'Broken spine uplinks in this pod.', key: 1 }, { k: 'spinesBroken', label: 'Spines with<br>broken uplink', title: 'Spines with at least one broken uplink.' }, { k: 'spines', label: 'Spines', title: 'Spines in this pod.' }, { k: 'part', label: 'Partly<br>broken', title: 'Partly broken uplinks.' }, { k: 'full', label: 'Fully<br>broken', title: 'Fully broken uplinks.' }, { k: 'drained', label: 'Turned off<br>spines', title: 'Drained spines.' }],
        planes: [{ k: 'site', label: 'Site', title: 'Site code.' }, { k: 'plane', label: 'Plane', title: 'Plane number.' }, { k: 'broken', label: 'Broken<br>uplinks', title: 'Broken spine uplinks in this plane.', key: 1 }, { k: 'spines', label: 'Spines', title: 'Spines in this plane.' }, { k: 'supers', label: 'Super-<br>spines', title: 'Super-spines in this plane.' }, { k: 'spinesBroken', label: 'Spines with<br>broken uplink', title: 'Spines with at least one broken uplink.' }],
        supers: [{ k: 'id', label: 'Super-spine', title: 'Super-spine identifier.' }, { k: 'site', label: 'Site', title: 'Site code.' }, { k: 'plane', label: 'Plane', title: 'Plane number.' }, { k: 'broken', label: 'Broken<br>downlinks', title: 'Links from spines where up is less than count.', key: 1 }, { k: 'downlinks', label: 'Downlinks', title: 'Links from spines.' }, { k: 'part', label: 'Partly<br>broken', title: 'Partly broken downlinks.' }, { k: 'full', label: 'Fully<br>broken', title: 'Fully broken downlinks.' }, { k: 'drained', label: 'Turned<br>off', title: 'Drained on purpose.' }],
        sites: [{ k: 'site', label: 'Site', title: 'Site code.' }, { k: 'broken', label: 'Broken<br>uplinks', title: 'Broken spine uplinks at this site.', key: 1 }, { k: 'spines', label: 'Spines', title: 'Spines at this site.' }, { k: 'supers', label: 'Super-<br>spines', title: 'Super-spines at this site.' }, { k: 'spinesBroken', label: 'Spines with<br>broken uplink', title: 'Spines with at least one broken uplink.' }, { k: 'drained', label: 'Turned off<br>spines', title: 'Drained spines.' }]
      };
      function scopedRows(tab) { let rows = tab === 'spines' ? AGG.spineRows : tab === 'pods' ? AGG.pods : tab === 'planes' ? AGG.planes : tab === 'sites' ? AGG.sites : AGG.superRows; if (nav.level === 'site' || nav.level === 'pod' || nav.level === 'device') rows = rows.filter(r => r.site === nav.site); if ((nav.level === 'pod' || nav.level === 'device') && nav.pod != null) { if (tab === 'spines' || tab === 'pods') rows = rows.filter(r => r.pod === nav.pod); } const q = filterInput.value.trim().toLowerCase(); if (q) rows = rows.filter(r => COLS[tab].map(c => String(r[c.k])).join(' ').toLowerCase().includes(q) || ('pod ' + (r.pod != null ? r.pod : '')).includes(q) || ('plane ' + (r.plane != null ? r.plane : '')).includes(q)); return rows; }
      function renderTables() {
        tabBar.innerHTML = ''; [['spines', 'Spines'], ['pods', 'Pods'], ['planes', 'Planes'], ['supers', 'Super-spines'], ['sites', 'Sites']].forEach(([k, lab]) => { const b = document.createElement('button'); b.className = P + 'tab' + (activeTab === k ? ' on' : ''); b.textContent = lab; b.onclick = () => { activeTab = k; renderTables(); }; tabBar.appendChild(b); });
        subtitle.textContent = { spines: 'One row per spine', pods: 'One row per pod', planes: 'One row per plane, per site', supers: 'One row per super-spine', sites: 'One row per site' }[activeTab];
        const s = sorts[activeTab]; let rows = scopedRows(activeTab); const out = [...rows];
        if (s.def) out.sort((a, b) => String(a.site || '').localeCompare(String(b.site || '')) || ((a.pod || 0) - (b.pod || 0)) || ((a.plane || 0) - (b.plane || 0)) || String(a.id || '').localeCompare(String(b.id || ''))); else out.sort((a, b) => { const x = a[s.k], y = b[s.k]; const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return cmp * s.dir || String(a.id || a.site || '').localeCompare(String(b.id || b.site || '')); });
        countEl.textContent = out.length + ' rows';
        const cols = COLS[activeTab];
        let html = '<table class="' + P + 'table"><thead><tr>' + cols.map(c => { const sorted = !s.def && s.k === c.k; return '<th class="' + (sorted ? 'sorted' : '') + '" title="' + esc(c.title) + '" tabindex="0" data-k="' + c.k + '">' + c.label + (sorted ? ' ' + (s.dir < 0 ? '↓' : '↑') : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
        out.forEach((r, ri) => { html += '<tr tabindex="0" data-ri="' + ri + '"' + (!s.def && ri === 0 ? ' class="first"' : '') + '>' + cols.map(c => '<td class="' + (!s.def && s.k === c.k ? 'sortedcol' : '') + '">' + esc(r[c.k]) + '</td>').join('') + '</tr>'; });
        scroll.innerHTML = html + '</tbody></table>';
        scroll.querySelectorAll('th').forEach(th => { const act = () => { const k = th.getAttribute('data-k'); const cur = sorts[activeTab]; if (!cur.def && cur.k === k) cur.dir = -cur.dir; else { const sample = scopedRows(activeTab)[0]; cur.k = k; cur.def = false; cur.dir = (sample && typeof sample[k] === 'number') ? -1 : 1; } quickActive = null; renderFinder(); renderTables(); }; th.onclick = act; th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }; });
        scroll.querySelectorAll('tbody tr').forEach(tr => { const act = () => onRow(activeTab, out[+tr.getAttribute('data-ri')]); tr.onclick = act; tr.onkeydown = e => { if (e.key === 'Enter') act(); }; });
      }
      function onRow(tab, r) { if (!r) return; if (tab === 'spines' || tab === 'supers') { const d = byId.get(r.id); go({ level: 'device', site: d.site, pod: d.pod, id: r.id }); } else if (tab === 'sites') go({ level: 'site', site: r.site, pod: null, id: null }); else if (tab === 'pods') go({ level: 'pod', site: r.site, pod: r.pod, id: null }); else if (tab === 'planes') go({ level: 'site', site: r.site, pod: null, id: null }); }
      const QUICK = [['Broken uplinks, per spine', 'spines', 'broken'], ['Broken uplinks, per pod', 'pods', 'broken'], ['Spines with a broken uplink, per pod', 'pods', 'spinesBroken'], ['Broken uplinks, per plane', 'planes', 'broken'], ['Broken downlinks, per super-spine', 'supers', 'broken'], ['Broken uplinks, per site', 'sites', 'broken'], ['Partly broken uplinks, per spine', 'spines', 'part'], ['Turned off spines, per pod', 'pods', 'drained']];
      function renderFinder() { finder.innerHTML = ''; QUICK.forEach(([lab, tab, k], qi) => { const b = document.createElement('button'); b.className = P + 'qbtn' + (quickActive === qi ? ' on' : ''); b.textContent = lab; b.onclick = () => { activeTab = tab; sorts[tab].k = k; sorts[tab].def = false; sorts[tab].dir = -1; quickActive = qi; renderFinder(); renderTables(); scroll.scrollTop = 0; }; finder.appendChild(b); }); }
      function go(next) {
        nav = { level: next.level, site: next.site || null, pod: next.pod != null ? next.pod : null, id: next.id || null };
        if (nav.level === 'device' && nav.id) { suppressSelect = true; kit.select(nav.id); suppressSelect = false; }
        renderChrome(); renderDetail(); applyColors(); renderTables(); updateLabelVis();
        if (nav.level === 'system') { const b = sysBounds(); flyTo(new THREE.Vector3(b.cx, 0, b.cz), b.span); }
        else if (nav.level === 'site') { const s = siteInfo.get(nav.site); if (s) flyTo(new THREE.Vector3(s.cx, 0, s.cz), Math.max(s.w, s.dep) * 1.35); }
        else if (nav.level === 'pod') { const c = podCenter.get(nav.site + '|' + nav.pod); if (c) flyTo(c, 13); }
        else if (nav.level === 'device') { const v = pos.get(nav.id); if (v) flyTo(v, 11); }
      }
      function goBack() { if (nav.level === 'device') { const d = byId.get(nav.id); if (d && d.pod != null) go({ level: 'pod', site: d.site, pod: d.pod, id: null }); else go({ level: 'site', site: nav.site, pod: null, id: null }); } else if (nav.level === 'pod') go({ level: 'site', site: nav.site, pod: null, id: null }); else if (nav.level === 'site') go({ level: 'system', site: null, pod: null, id: null }); }
      function updateLabelVis() { labelItems.forEach(it => { const scoped = !it.site || !nav.site || it.site === nav.site; it.el.style.display = it.kind === 'sun' ? '' : it.kind === 'site' ? '' : (it.kind === 'plane' || it.kind === 'ctx') ? (scoped ? '' : 'none') : (nav.level === 'site' || nav.level === 'pod' || nav.level === 'device') && scoped ? '' : 'none'; }); }
      renderFinder();
      // Picking / hover
      const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
      function pick(e) { const r = renderer.domElement.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1; ray.setFromCamera(mouse, camera); let hit = ray.intersectObjects([solidMesh, drainMesh]); if (hit.length && hit[0].instanceId != null) { const list = hit[0].object === solidMesh ? solidDevs : drainedDevs; return list[hit[0].instanceId].id; } hit = ray.intersectObjects(deckMeshes); return hit.length ? { site: hit[0].object.userData.site } : null; }
      function clickHint(d) { if (nav.level === 'system') return 'Click to open site'; if (nav.level === 'site') return d.tier === 'spine' ? 'Click to open pod ' + d.pod : 'Click for details'; if (nav.level === 'pod') return (d.tier === 'spine' && d.pod !== nav.pod) ? 'Click to open pod ' + d.pod : 'Click for details'; return 'Click for details'; }
      function onMove(e) { userDriftStop = true; const p = pick(e); if (!p) { tip.style.display = 'none'; hoverBox.visible = false; renderer.domElement.style.cursor = ''; return; } const rect = root.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - rect.left + 14, rect.width - 290) + 'px'; tip.style.top = (e.clientY - rect.top + 12) + 'px'; tip.style.display = 'block'; renderer.domElement.style.cursor = 'pointer'; if (typeof p === 'object') { tip.innerHTML = '<b>' + esc(kit.siteName(p.site)) + '</b><br>Site · ' + AGG.pods.filter(x => x.site === p.site).length + ' pods<br><span class="' + P + 'muted">Click to open site</span>'; hoverBox.visible = false; return; } const d = byId.get(p); if (!d) return; hoverId = p; hoverBox.position.copy(pos.get(p)); hoverBox.visible = true; const st = statusOf(d), i = devInfo(d); tip.innerHTML = '<b>' + esc(d.id) + '</b><br><span style="color:' + st.color + '">●</span> ' + st.word + '<br>' + (i ? i.up + ' of ' + i.tot + ' links working' : '') + '<br>' + esc(kit.siteName(d.site)) + (d.pod != null ? ' · Pod ' + d.pod : '') + (d.plane != null ? ' · Plane ' + d.plane : '') + '<br><span class="' + P + 'muted">' + clickHint(d) + '</span>'; }
      function onClick(e) { userDriftStop = true; const p = pick(e); if (!p) return; if (typeof p === 'object') { go({ level: 'site', site: p.site, pod: null, id: null }); return; } const d = byId.get(p); if (!d) return; if (nav.level === 'system') go({ level: 'site', site: d.site, pod: null, id: null }); else if (nav.level === 'site') { if (d.tier === 'spine') go({ level: 'pod', site: d.site, pod: d.pod, id: null }); else go({ level: 'device', site: d.site, pod: d.pod, id: d.id }); } else if (nav.level === 'pod') { if (d.tier === 'spine' && d.pod !== nav.pod) go({ level: 'pod', site: d.site, pod: d.pod, id: null }); else go({ level: 'device', site: d.site, pod: d.pod != null ? d.pod : nav.pod, id: d.id }); } else go({ level: 'device', site: d.site, pod: d.pod, id: d.id }); }
      renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('click', onClick);
      function onKey(e) { const typing = /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName || ''); if ((e.key === 'l' || e.key === 'L') && !typing) { setLegend(!legendOpen); return; } if (e.key === 'Escape') { if (document.activeElement === filterInput) filterInput.blur(); else goBack(); } else if (e.key === '/' && document.activeElement !== filterInput && !typing) { e.preventDefault(); filterInput.focus(); } }
      window.addEventListener('keydown', onKey);
      kit.onSelect(id => { if (suppressSelect || !id) return; const d = byId.get(id); if (d && (d.tier === 'spine' || d.tier === 'super_spine')) go({ level: 'device', site: d.site, pod: d.pod, id }); else if (d && d.pod != null) go({ level: 'pod', site: d.site, pod: d.pod, id: null }); else if (d) go({ level: 'site', site: d.site, pod: null, id: null }); });
      function resize() { const w = el.clientWidth || root.clientWidth || 800, h = el.clientHeight || root.clientHeight || 600; renderer.setSize(w, h); if (h < 430 && legendOpen) setLegend(false); else detail.style.bottom = (legend.offsetHeight + 24) + 'px'; const pw = w > 700 ? 380 : 0; camera.aspect = (w + pw) / h; camera.setViewOffset(w + pw, h, pw, 0, w, h); camera.updateProjectionMatrix(); }
      const onWin = () => resize(); window.addEventListener('resize', onWin); resize();
      (function () { const b = sysBounds(); const dist = Math.max(b.span * 1.05, 16); camera.position.set(b.cx + dist * 0.5, 5 + dist * 0.55, b.cz + dist * 0.72); controls.target.set(b.cx, 5, b.cz); controls.update(); })();
      renderChrome(); renderDetail(); applyColors(); renderTables(); updateLabelVis();
      if (kit.selected) { const d = byId.get(kit.selected); if (d && (d.tier === 'spine' || d.tier === 'super_spine')) { nav = { level: 'device', site: d.site, pod: d.pod, id: d.id }; renderChrome(); renderDetail(); applyColors(); renderTables(); updateLabelVis(); const v = pos.get(d.id); if (v) flyTo(v, 11); } }
      let raf = 0; const clock = new THREE.Clock(); const lastCam = new THREE.Vector3(1e9, 0, 0); const v3 = new THREE.Vector3();
      function updateLabels() { const w = root.clientWidth, h = root.clientHeight; labelItems.forEach(it => { if (it.el.style.display === 'none') return; v3.copy(it.pos).project(camera); it.el.style.left = ((v3.x + 1) / 2 * w) + 'px'; it.el.style.top = ((1 - v3.y) / 2 * h) + 'px'; it.el.style.opacity = v3.z < 1 ? '1' : '0'; }); }
      function animate() { raf = requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), 0.05); if (fly.active) { fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : (1 - Math.pow(1 - fly.t, 3)); camera.position.lerpVectors(fly.fromP, fly.toP, k); controls.target.lerpVectors(fly.fromT, fly.toT, k); if (fly.t >= 1) fly.active = false; } controls.update(); renderer.render(scene, camera); if (camera.position.distanceToSquared(lastCam) > 0.0001) { lastCam.copy(camera.position); updateLabels(); } }
      animate(); updateLabels();
      cleanup = function () { cancelAnimationFrame(raf); window.removeEventListener('resize', onWin); window.removeEventListener('keydown', onKey); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); };
      cleanup.__resize = resize;
    }
  };
});
