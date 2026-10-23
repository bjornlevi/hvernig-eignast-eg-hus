// Tests of the calculations in static/calc.js. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/calc.js");

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""} expected ${expected} ± ${tol}, got ${actual}`);

test("take-home pay follows the 2025 tax brackets", () => {
  // 650.000 kr: 4% pension, then 31,49% / 37,99% minus personal credit
  const taxable = 650000 * 0.96;
  const tax = 472005 * 0.3149 + (taxable - 472005) * 0.3799 - 68691;
  near(C.netIncome(650000, false), taxable - tax, 1);
  assert.equal(C.incomeTax(100000), 0);  // the personal credit covers low incomes
  assert.ok(C.netIncome(650000, true) < C.netIncome(650000, false));
});

test("grossForNet inverts householdNet", () => {
  for (const buyers of [1, 2]) {
    const gross = C.grossForNet(500000, buyers, true);
    near(C.householdNet(gross, buyers, true), 500000, 1);
  }
});

test("séreign is capped at 500.000 kr a year per person", () => {
  near(C.privatePensionMonthly(500000, 1), 30000, 1e-6);
  near(C.privatePensionMonthly(2000000, 1), 500000 / 12, 1e-6);
  near(C.privatePensionMonthly(2000000, 2), 2 * 500000 / 12, 1e-6);
});

test("annuity payment", () => {
  near(C.annuity(1000000, 0, 10), 1000000 / 120, 1e-9);
  // 10 m.kr., 6%, 25 years: standard mortgage table value 64.430 kr
  near(C.annuity(10000000, 6, 25), 64430, 1);
});

test("schedule pays the loan off; indexed loans grow in nominal terms", () => {
  const p = Object.assign({}, C.DEFAULTS);
  const s = C.schedule(30000000, p, 0);
  assert.equal(s.months.length, p.termYears * 12);
  near(s.months.at(-1).balanceReal, 0, 1);
  near(s.paidReal, C.annuity(30000000, p.rateIndexed, p.termYears) * p.termYears * 12, 1);
  assert.ok(s.months[12].balanceNominal > 30000000, "indexed balance rises at first with inflation");

  const n = C.schedule(30000000, Object.assign({}, p, { loanType: "nominal" }), 0);
  near(n.months[0].paymentNominal, n.months.at(-1).paymentNominal, 1e-6, "nominal payment is fixed");
  assert.ok(n.months.at(-1).paymentReal < n.months[0].paymentReal);
});

test("the saving loop and savingNeeded agree", () => {
  const base = { equity: 1000000, monthlySaving: 0, usePrivatePension: false };
  for (const years of [3, 5, 8]) {
    const need = C.savingNeeded(Object.assign({}, C.DEFAULTS, base), years * 12, 0);
    const r = C.compute(Object.assign({}, base, { monthlySaving: Math.ceil(need) + 1 }));
    assert.equal(r.purchaseMonth, years * 12, `${years} years`);
  }
});

test("savingNeeded counts séreign only for its first 10 years", () => {
  const p = Object.assign({}, C.DEFAULTS, { equity: 0 });
  const pension = 40000;
  const with12 = C.savingNeeded(p, 144, pension);
  const r = C.compute({ equity: 0, monthlySaving: Math.ceil(with12) + 1, wage: 40000 / 0.06 });
  near(r.pension, pension, 1e-6);
  assert.equal(r.purchaseMonth, 144);
  assert.equal(r.pensionRunsOut, true);
});

test("deposit never reached when house prices outrun savings", () => {
  const r = C.compute({ equity: 0, monthlySaving: 1000, usePrivatePension: false, houseGrowth: 5 });
  assert.equal(r.reached, false);
  assert.ok(r.loan > 0 && r.wageNeeded > 0);
});

test("buying now when the deposit is already there", () => {
  const r = C.compute({ equity: 20000000 });
  assert.equal(r.purchaseMonth, 0);
  near(r.loan, 55000000 - (20000000 - 55000000 * 0.004 - 250000), 1);
});

test("the wage needed is exactly enough", () => {
  // The wage also sets séreign; keep it above the cap so only the income test changes
  const r = C.compute({ wage: 900000 });
  assert.ok(r.wageNeeded * 0.06 > 500000 / 12);
  const atNeeded = C.compute({ wage: r.wageNeeded + 1 });
  const below = C.compute({ wage: r.wageNeeded - 1000 });
  assert.equal(atNeeded.wageOk, true);
  assert.equal(below.wageOk, false);
  // ...and at that wage the maximum loan covers the loan
  assert.ok(atNeeded.maxLoan >= r.loan - 1);
});

test("framfærsluviðmið is for reference only", () => {
  const a = C.compute({ livingCosts: 200000 }), b = C.compute({ livingCosts: 600000 });
  assert.equal(a.wageNeeded, b.wageNeeded);
  assert.equal(a.purchaseMonth, b.purchaseMonth);
  assert.equal(a.maxLoan, b.maxLoan);
  near(a.surplusNow - b.surplusNow, 400000, 1e-6);
  const c = C.compute({ livingCosts: 200000, housingNow: 300000 });
  assert.equal(c.wageNeeded, a.wageNeeded);
  near(c.surplusNow, c.net - 200000 - 300000 - c.params.monthlySaving, 1e-6);
  near(a.surplusAfter, a.net - 200000 - a.schedule.firstPaymentReal, 1e-6);
});

test("stress test uses the floor rate and max term for indexed loans", () => {
  const r = C.compute({ rateIndexed: 2, termYears: 40 });
  assert.equal(r.terms.stressRate, 3);
  assert.equal(r.terms.stressTerm, 25);
  near(r.stressPayment, C.annuity(r.loan, 3, 25), 1e-6);
});
