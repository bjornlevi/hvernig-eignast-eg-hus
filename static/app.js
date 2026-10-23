/* UI for "Hvernig eignast ég hús?": reads the form, runs HusCalc.compute and draws the results.
 * The inputs that differ from the defaults are kept in the URL query string. */
(function () {
  "use strict";

  const C = window.HusCalc;
  const form = document.getElementById("inputs");
  const $ = (id) => document.getElementById(id);
  const LIVING_COSTS = { 1: 250000, 2: 400000 };  // default framfærsluviðmið by number of buyers

  // -- formatting ------------------------------------------------------------

  // Icelandic number format (1.234.567,8) by hand: not every browser ships is-IS locale data
  function fmtNum(v, digits) {
    const [int, frac] = Math.abs(v).toFixed(digits).split(".");
    const f = frac ? frac.replace(/0+$/, "") : "";
    return (v < 0 && Number(int + "." + (frac || 0)) !== 0 ? "-" : "") +
      int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? "," + f : "");
  }
  const nf = (digits) => ({ format: (v) => fmtNum(v, digits) });
  const kr = (v) => nf(0).format(Math.round(v / 1000) * 1000) + " kr.";
  const mkr = (v) => (Math.abs(v) >= 1e6 ? nf(1).format(v / 1e6) + " m.kr." : nf(0).format(Math.round(v / 1000)) + " þ.kr.");
  const pct = (v) => nf(1).format(v) + "%";

  function duration(months) {
    const y = Math.floor(months / 12), m = months % 12;
    const parts = [];
    if (y) parts.push(y + " ár");
    if (m) parts.push(m + (m === 1 ? " mánuð" : " mánuði"));
    return parts.join(" og ");
  }

  function formatField(kind, v) {
    if (kind === "money") return nf(0).format(v);
    if (kind === "pct") return nf(2).format(v);
    return String(v);
  }

  function parseField(kind, text) {
    if (kind === "money" || kind === "int") {
      const digits = text.replace(/[^\d-]/g, "");
      return digits === "" || digits === "-" ? NaN : parseInt(digits, 10);
    }
    return parseFloat(text.replace(/\s/g, "").replace(",", "."));
  }

  // -- state -----------------------------------------------------------------

  const state = Object.assign({}, C.DEFAULTS);

  function readUrl() {
    const q = new URLSearchParams(location.search);
    for (const [key, def] of Object.entries(C.DEFAULTS)) {
      if (!q.has(key)) continue;
      const raw = q.get(key);
      if (typeof def === "boolean") state[key] = raw === "1";
      else if (typeof def === "number") { const v = parseFloat(raw); if (Number.isFinite(v)) state[key] = v; }
      else if (key === "loanType" && (raw === "indexed" || raw === "nominal")) state[key] = raw;
    }
  }

  function writeUrl() {
    const q = new URLSearchParams();
    for (const [key, def] of Object.entries(C.DEFAULTS)) {
      if (state[key] !== def) q.set(key, typeof def === "boolean" ? (state[key] ? "1" : "0") : state[key]);
    }
    const qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  /** Put state values into all fields (except the one being typed in). */
  function fillFields(skip) {
    for (const el of form.querySelectorAll("[data-key]")) {
      if (el === skip) continue;
      const v = state[el.dataset.key];
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "radio") el.checked = el.value === String(v);
      else if (el.type === "range") el.value = v;
      else el.value = formatField(el.dataset.kind, v);
    }
    for (const el of form.querySelectorAll("[data-show]")) el.hidden = el.dataset.show !== state.loanType;
  }

  function set(key, value) {
    const prev = state[key];
    state[key] = value;
    if (key === "firstTime") Object.assign(state, C.FIRST_TIME[value]);
    if (key === "buyers" && state.livingCosts === LIVING_COSTS[prev]) state.livingCosts = LIVING_COSTS[value];
  }

  form.addEventListener("input", (e) => {
    const el = e.target, key = el.dataset.key;
    if (!key) return;
    if (el.type === "checkbox") set(key, el.checked);
    else if (el.type === "radio") set(key, el.dataset.kind === "int" ? parseInt(el.value, 10) : el.value);
    else {
      let v = el.type === "range" ? parseFloat(el.value) : parseField(el.dataset.kind, el.value);
      if (!Number.isFinite(v)) return;
      if (el.dataset.min !== undefined) v = Math.max(parseFloat(el.dataset.min), v);
      if (el.dataset.max !== undefined) v = Math.min(parseFloat(el.dataset.max), v);
      set(key, v);
    }
    fillFields(el.type === "text" ? el : null);
    update();
  });
  // Tidy the number once the user leaves the field
  form.addEventListener("focusout", (e) => {
    if (e.target.type === "text" && e.target.dataset.key) e.target.value = formatField(e.target.dataset.kind, state[e.target.dataset.key]);
  });

  for (const chip of form.querySelectorAll("[data-price]")) {
    chip.addEventListener("click", () => { state.price = parseInt(chip.dataset.price, 10); fillFields(); update(); });
  }
  $("reset").addEventListener("click", () => { Object.assign(state, C.DEFAULTS); fillFields(); update(); });
  $("share").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(location.href);
      e.target.textContent = "Slóð afrituð";
      setTimeout(() => { e.target.textContent = "Afrita slóð"; }, 2000);
    } catch (err) { /* clipboard not available; the URL is in the address bar */ }
  });

  // -- results ---------------------------------------------------------------

  let result = null;

  function update() {
    result = C.compute(state);
    writeUrl();
    renderCards(result);
    renderHorizons(result);
    drawCharts();
  }

  function renderCards(r) {
    const p = r.params;
    const need = p.buyers === 2 ? "þið þurfið" : "þú þarft";

    $("net-hint").innerHTML = `Útborguð laun um ${kr(r.net)} á mánuði` +
      (r.savingShareOfNet !== null ? `; sparnaðurinn er ${pct(r.savingShareOfNet * 100)} af þeim.` : ".") +
      ` Eftir framfærsluviðmið (${kr(p.livingCosts)}), húsnæðiskostnað (${kr(p.housingNow)}) og sparnað eru ` +
      (r.surplusNow >= 0 ? `<strong>${kr(r.surplusNow)}</strong> eftir á mánuði.`
                         : `<strong style="color:var(--bad)">${kr(r.surplusNow)}</strong>: sparnaðurinn er meiri en launin leyfa miðað við framfærslu og húsnæðiskostnað.`);
    $("pension-hint").textContent = p.usePrivatePension
      ? `Bætir um ${kr(r.pension)} á mánuði í útborgunina (4% frá þér + 2% frá vinnuveitanda), skattfrjálst í allt að 10 ár.`
      : "4% frá þér + 2% frá vinnuveitanda, skattfrjálst upp í útborgun.";

    // Deposit
    const dep = $("card-deposit");
    dep.classList.toggle("bad", !r.reached);
    dep.classList.toggle("ok", r.reached);
    if (!r.reached) {
      $("deposit-big").textContent = "Næst ekki";
      $("deposit-text").innerHTML = `<p>Með ${kr(p.monthlySaving)} á mánuði ${p.buyers === 2 ? "náið þið" : "nærðu"} ekki útborguninni
        innan 50 ára, því íbúðaverðið hækkar hraðar en sparnaðurinn. Í dag þarf <span class="num">${kr(r.cashNeededToday)}</span>.</p>
        <p>Prófaðu að spara meira, velja ódýrari íbúð eða nota séreignarsparnað.</p>`;
    } else if (r.purchaseMonth === 0) {
      $("deposit-big").textContent = "Strax í dag";
      $("deposit-text").innerHTML = `<p>${p.buyers === 2 ? "Þið eigið" : "Þú átt"} nú þegar fyrir útborgun og kaupkostnaði
        (<span class="num">${kr(r.cashNeededToday)}</span>).</p>`;
    } else {
      $("deposit-big").textContent = "Eftir " + duration(r.purchaseMonth);
      $("deposit-text").innerHTML = `<p>Þá verður þú <strong>${Math.floor(r.purchaseAge)} ára</strong>.
        Íbúðin kostar þá um <span class="num">${mkr(r.purchasePrice)}</span> á verðlagi dagsins í dag
        og ${need} <span class="num">${kr(r.purchasePrice * (1 - p.ltv / 100))}</span> í útborgun
        auk <span class="num">${kr(r.purchasePrice * p.stampDuty / 100 + p.fees)}</span> í kaupkostnað.</p>` +
        (r.pensionRunsOut ? `<p class="small muted">Séreignarsparnað má aðeins nota í 10 ár; eftir það er reiknað án hans.</p>` : "");
    }

    $("summary").innerHTML = `<span>${!r.reached ? "Útborgun næst ekki" : r.purchaseMonth === 0 ? "Getur keypt strax"
        : "Kaup eftir " + duration(r.purchaseMonth)}</span>
      <span class="${r.wageOk ? "ok" : "bad"}">Laun sem þarf: ${kr(r.wageNeeded)}</span>`;

    // Wage
    const wage = $("card-wage");
    wage.classList.toggle("ok", r.wageOk);
    wage.classList.toggle("bad", !r.wageOk);
    $("wage-big").textContent = kr(r.wageNeeded);
    const binding = `afborgun í greiðslumati er <span class="num">${kr(r.stressPayment)}</span>
         (${pct(r.terms.stressRate)} vextir, ${r.terms.stressTerm} ár) og má mest vera ${pct(p.dsti)} af útborguðum launum`;
    $("wage-text").innerHTML = `<p>${p.buyers === 2 ? "Samanlögð mánaðarlaun" : "Mánaðarlaun"} fyrir skatt, á verðlagi dagsins í dag.</p>
      <p>${r.wageOk ? '<span class="badge ok">Launin duga</span>'
                    : `<span class="badge bad">Vantar ${kr(r.wageNeeded - p.wage)} á mánuði</span>`}</p>
      <p class="small">Útborguð laun þurfa að vera um <span class="num">${kr(r.netNeeded)}</span>: ${binding}.</p>
      <p class="small">Með núverandi launum má fá lán upp á allt að <span class="num">${mkr(r.maxLoan)}</span>;
        Í dag ${p.buyers === 2 ? "gætuð þið" : "gætirðu"} keypt íbúð á allt að <span class="num">${mkr(r.maxPriceToday)}</span></p>`;

    // Loan
    const s = r.schedule;
    $("loan-big").textContent = mkr(r.loan);
    $("loan-text").innerHTML = `<p>${r.terms.indexed ? "Verðtryggt" : "Óverðtryggt"} jafngreiðslulán, ${pct(r.terms.rate)} vextir
      til ${p.termYears} ára (${pct(r.ltvActual * 100)} af kaupverði).</p>
      <p>Fyrsta afborgun um <span class="num">${kr(s.firstPaymentReal)}</span> á mánuði. Lánið er greitt upp þegar
      þú verður <strong>${Math.floor(r.payoffAge)} ára</strong>.</p>
      <p class="small">Eftir afborgun og framfærsluviðmið eru ${r.surplusAfter >= 0
        ? `<span class="num">${kr(r.surplusAfter)}</span>` : `<span class="num" style="color:var(--bad)">${kr(r.surplusAfter)}</span>`}
        eftir af núverandi útborguðum launum á mánuði, fyrir fasteignagjöld, hita, rafmagn og annað.</p>
      <p class="small">Samtals greitt: <span class="num">${mkr(s.paidReal)}</span> á verðlagi dagsins í dag,
      eða <span class="num">${mkr(s.paidNominal)}</span> í krónum hvers árs miðað við ${pct(p.inflation)} verðbólgu.</p>` +
      (r.payoffAge > 75 ? `<p class="small muted">Margir bankar setja hámark á aldur í lok lánstíma; styttri lánstími gæti verið skilyrði.</p>` : "") +
      (r.terms.indexed && p.termYears > 25 ? `<p class="small muted">Verðtryggð lán til lengri tíma en 25 ára bjóðast aðeins yngri og tekjulægri lántakendum.</p>` : "");

    $("payment-note").textContent = r.terms.indexed
      ? "Verðtryggð afborgun er jöfn á föstu verðlagi en hækkar í krónum með verðbólgunni."
      : "Óverðtryggð afborgun er föst í krónum og léttist því á föstu verðlagi eftir því sem verðlag hækkar.";
  }

  function renderHorizons(r) {
    const p = r.params;
    $("horizon-intro").textContent = `Miðað við ${kr(p.equity)} eigið fé í dag` +
      (r.pension > 0 ? `, auk ${kr(r.pension)} á mánuði í séreignarsparnað` : "") +
      `, og að íbúðin hækki um ${pct(p.houseGrowth)} á ári umfram verðbólgu.`;
    // Highlight the first row the current plan reaches
    const current = r.reached ? r.horizons.find((h) => h.years * 12 >= r.purchaseMonth) : null;
    $("horizons").innerHTML = r.horizons.map((h) => `
      <tr class="${h === current ? "current" : ""}">
        <td>${h.years} ár</td><td>${Math.floor(h.age)} ára</td>
        <td class="r num">${h.monthly > 0 ? kr(h.monthly) : r.pension > 0 ? "Séreignin dugar" : "Ekkert"}</td>
      </tr>`).join("");
  }

  // -- charts ----------------------------------------------------------------

  function niceStep(range, count) {
    const raw = range / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  /**
   * Line chart with a shared x axis (age), one y axis, crosshair and tooltip.
   * series: [{ name, color, values, dashed }], all values aligned with xs.
   */
  function lineChart(el, { xs, series, tipTitle }) {
    const W = Math.max(280, el.clientWidth), H = W < 500 ? 200 : 240;
    const m = { l: 62, r: 12, t: 10, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const xMin = xs[0], xMax = xs[xs.length - 1] > xMin ? xs[xs.length - 1] : xMin + 1;
    const yTop = Math.max(1, ...series.flatMap((s) => s.values));
    const yStep = niceStep(yTop, 4), yMax = Math.ceil(yTop / yStep) * yStep;
    const X = (x) => m.l + (x - xMin) / (xMax - xMin) * iw;
    const Y = (y) => m.t + ih - y / yMax * ih;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.name).join(", ")}"><g class="axis">`;
    for (let y = 0; y <= yMax + 1e-6; y += yStep) {
      svg += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}"/>
              <text x="${m.l - 8}" y="${Y(y) + 4}" text-anchor="end">${y === 0 ? "0" : mkr(y)}</text>`;
    }
    const xStep = Math.max(1, niceStep(xMax - xMin, W < 500 ? 4 : 7));
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-6; x += xStep) {
      svg += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle">${Math.round(x)} ára</text>`;
    }
    svg += "</g>";
    for (const s of series) {
      const d = s.values.map((v, i) => (i ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(v).toFixed(1)).join("");
      svg += `<path class="series" d="${d}" stroke="${s.color}"${s.dashed ? ' stroke-dasharray="6 4"' : ""}/>`;
    }
    svg += `<g class="hover" visibility="hidden"><line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/>` +
      series.map((s) => `<circle class="marker" r="4.5" fill="${s.color}"/>`).join("") +
      `</g><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    el.innerHTML = svg;

    const root = el.querySelector("svg"), hover = root.querySelector(".hover"), tip = el.querySelector(".tip");
    const line = hover.querySelector("line"), dots = hover.querySelectorAll("circle");
    function show(evt) {
      const box = root.getBoundingClientRect();
      const px = (evt.clientX - box.left) * W / box.width;
      const xv = xMin + (px - m.l) / iw * (xMax - xMin);
      let i = 0;
      for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - xv) < Math.abs(xs[i] - xv)) i = k;
      const cx = X(xs[i]);
      line.setAttribute("x1", cx); line.setAttribute("x2", cx);
      series.forEach((s, k) => { dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", Y(s.values[i])); });
      hover.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${tipTitle(i)}</b>` + series.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: ${kr(s.values[i])}</div>`).join("");
      tip.hidden = false;
      const left = cx * box.width / W, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, left + 12 + tw > box.width ? left - tw - 12 : left + 12)) + "px";
      tip.style.top = "8px";
    }
    root.addEventListener("pointermove", show);
    root.addEventListener("pointerdown", show);
    root.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    return [cs.getPropertyValue("--series-1").trim(), cs.getPropertyValue("--series-2").trim()];
  };

  function drawCharts() {
    if (!result) return;
    const r = result, p = r.params, [c1, c2] = colors();

    // Saving towards the deposit, one point per month
    const savingEl = $("chart-saving");
    if (r.reached && r.purchaseMonth === 0) {
      savingEl.innerHTML = '<p class="muted">Þú átt nú þegar fyrir útborgun.</p>';
    } else {
      const path = r.savingPath;
      lineChart(savingEl, {
        xs: path.map((pt) => p.age + pt.month / 12),
        series: [
          { name: "Eigið fé", color: c1, values: path.map((pt) => pt.savings) },
          { name: "Útborgun + kostnaður", color: c2, values: path.map((pt) => pt.target) },
        ],
        tipTitle: (i) => (i === 0 ? "Í dag" : "Eftir " + duration(path[i].month)),
      });
    }

    // The loan, one point per year
    const months = r.schedule.months, years = [];
    for (let y = 0; y * 12 <= months.length; y++) years.push(y);
    const at = (y) => months[Math.max(0, y * 12 - 1)];
    const ageAt = (y) => r.purchaseAge + y;
    lineChart($("chart-balance"), {
      xs: years.map(ageAt),
      series: [
        { name: "Föst verðlag", color: c1, values: years.map((y) => (y === 0 ? r.loan : at(y).balanceReal)) },
        { name: "Krónur hvers árs", color: c2, dashed: true, values: years.map((y) => (y === 0 ? r.schedule.loanNominal : at(y).balanceNominal)) },
      ],
      tipTitle: (i) => (i === 0 ? "Við kaup" : `Eftir ${years[i]} ár`),
    });
    const payYears = years.slice(0, -1);
    lineChart($("chart-payment"), {
      xs: payYears.map(ageAt),
      series: [
        { name: "Föst verðlag", color: c1, values: payYears.map((y) => months[y * 12].paymentReal) },
        { name: "Krónur hvers árs", color: c2, dashed: true, values: payYears.map((y) => months[y * 12].paymentNominal) },
      ],
      tipTitle: (i) => `Ár ${payYears[i] + 1}`,
    });
  }

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 100); }).observe($("chart-balance"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawCharts);

  readUrl();
  fillFields();
  update();
})();
