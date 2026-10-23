/* Calculations for "Hvernig eignast ég hús?". No DOM here, so tests can run it in Node.
 *
 * Everything is computed in today's krónur (real terms): savings, wages and house
 * prices are assumed to follow inflation, plus the real growth rates given. The loan
 * schedule is also given in nominal krónur (the krónur of each future month).
 * Percentages are passed as percent (4.5 means 4.5%).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HusCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Monthly income tax 2025 (skatturinn.is). Update yearly.
  const TAX = {
    brackets: [[472005, 0.3149], [1325127, 0.3799], [Infinity, 0.4629]],
    personalCredit: 68691,
    pension: 0.04,              // mandatory employee pension contribution
  };

  // Séreignarsparnaður used towards a first home: employee 4% + employer 2%,
  // tax free up to 500.000 kr. a year per person, for up to 10 years.
  const PRIVATE_PENSION = { employee: 0.04, employer: 0.02, capPerYear: 500000, maxYears: 10 };

  const MAX_MONTHS = 50 * 12;  // give up saving after 50 years

  const DEFAULTS = {
    age: 25,
    equity: 2000000,            // eigið fé í dag
    monthlySaving: 100000,
    wage: 650000,               // monthly gross wage of the household
    buyers: 1,
    usePrivatePension: true,
    firstTime: true,

    price: 55000000,
    houseGrowth: 1.5,           // real annual increase in house prices
    savingsReturn: 1,           // real annual return on savings

    loanType: "indexed",        // "indexed" (verðtryggt) or "nominal" (óverðtryggt)
    rateIndexed: 4.0,           // real rate on indexed loans
    rateNominal: 8.5,
    inflation: 3.5,
    termYears: 25,

    ltv: 85,                    // max loan-to-value; 85% first-time buyers, else 80%
    dsti: 40,                   // max debt service / disposable income; 40% first-time, else 35%
    stressRateIndexed: 3,       // minimum rate used in the debt service test
    stressRateNominal: 5.5,
    stressTermIndexed: 25,      // indexed loans are tested as if no longer than this
    stampDuty: 0.4,             // stimpilgjald; 0.4% first-time buyers, else 0.8%
    fees: 250000,               // lántökugjald, þinglýsing, skjalagerð o.fl.
    livingCosts: 250000,        // framfærsluviðmið excluding housing; for reference only, see surplus*
    housingNow: 200000,         // current housing costs (rent etc.), which framfærsluviðmið leaves out; reference only
  };

  // Values that differ between first-time buyers and others
  const FIRST_TIME = { true: { ltv: 85, dsti: 40, stampDuty: 0.4 }, false: { ltv: 80, dsti: 35, stampDuty: 0.8 } };

  function incomeTax(taxable) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of TAX.brackets) {
      if (taxable <= lower) break;
      tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    return Math.max(0, tax - TAX.personalCredit);
  }

  /** Take-home pay for one person's monthly gross wage. */
  function netIncome(gross, usePrivatePension) {
    const deductions = gross * (TAX.pension + (usePrivatePension ? PRIVATE_PENSION.employee : 0));
    const taxable = gross - deductions;
    return taxable - incomeTax(taxable);
  }

  function householdNet(wage, buyers, usePrivatePension) {
    return netIncome(wage / buyers, usePrivatePension) * buyers;
  }

  /** Monthly séreignarsparnaður that can go towards the deposit, for the whole household. */
  function privatePensionMonthly(wage, buyers) {
    const perPerson = wage / buyers;
    return Math.min(perPerson * (PRIVATE_PENSION.employee + PRIVATE_PENSION.employer),
                    PRIVATE_PENSION.capPerYear / 12) * buyers;
  }

  /** Household gross wage needed for a given take-home pay (binary search). */
  function grossForNet(net, buyers, usePrivatePension) {
    let lo = 0, hi = 50000000;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (householdNet(mid, buyers, usePrivatePension) >= net) hi = mid; else lo = mid;
    }
    return hi;
  }

  /** Annuity (jafngreiðslulán) monthly payment. */
  function annuity(loan, ratePct, years) {
    const n = Math.round(years * 12);
    const i = ratePct / 100 / 12;
    if (n <= 0) return loan;
    if (i === 0) return loan / n;
    return loan * i / (1 - Math.pow(1 + i, -n));
  }

  const monthly = (annualPct) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

  /** Money needed at purchase for a home at `price`: deposit plus purchase costs. */
  function cashNeeded(price, p) {
    return price * (1 - p.ltv / 100 + p.stampDuty / 100) + p.fees;
  }

  /**
   * Monthly saving (on top of séreign) needed to buy within `months`.
   * Savings grow as S ← S·(1+r) + c, the price as P ← P·(1+g).
   */
  function savingNeeded(p, months, pension) {
    const r = monthly(p.savingsReturn), g = monthly(p.houseGrowth);
    const target = cashNeeded(p.price * Math.pow(1 + g, months), p);
    const fv = (k) => (r === 0 ? k : (Math.pow(1 + r, k) - 1) / r);  // value of 1 kr a month for k months
    const pensionMonths = Math.min(months, PRIVATE_PENSION.maxYears * 12);
    const fromPension = pension * fv(pensionMonths) * Math.pow(1 + r, months - pensionMonths);
    const grown = p.equity * Math.pow(1 + r, months);
    return Math.max(0, (target - grown - fromPension) / fv(months));
  }

  function loanTerms(p) {
    const indexed = p.loanType === "indexed";
    const rate = indexed ? p.rateIndexed : p.rateNominal;
    return {
      indexed,
      rate,
      stressRate: Math.max(rate, indexed ? p.stressRateIndexed : p.stressRateNominal),
      stressTerm: indexed ? Math.min(p.termYears, p.stressTermIndexed) : p.termYears,
    };
  }

  /** Month-by-month payments. Real = today's krónur, nominal = krónur of that month. */
  function schedule(loan, p, startMonth) {
    const { indexed, rate } = loanTerms(p);
    const n = Math.round(p.termYears * 12);
    const i = rate / 100 / 12;
    const pi = monthly(p.inflation);
    const startIndex = Math.pow(1 + pi, startMonth);
    // An indexed loan is an annuity in real terms; a nominal loan in nominal terms.
    let balance = indexed ? loan : loan * startIndex;
    const payment = annuity(balance, rate, p.termYears);
    const months = [];
    let paidReal = 0, paidNominal = 0;
    for (let k = 1; k <= n; k++) {
      const index = startIndex * Math.pow(1 + pi, k);
      balance = Math.max(0, balance - (payment - balance * i));
      const payReal = indexed ? payment : payment / index;
      const payNominal = indexed ? payment * index : payment;
      paidReal += payReal;
      paidNominal += payNominal;
      months.push({
        month: k,
        paymentReal: payReal,
        paymentNominal: payNominal,
        balanceReal: indexed ? balance : balance / index,
        balanceNominal: indexed ? balance * index : balance,
      });
    }
    return {
      months,
      firstPaymentReal: months.length ? months[0].paymentReal : 0,
      paidReal,
      paidNominal,
      loanNominal: loan * startIndex,
    };
  }

  function compute(input) {
    const p = Object.assign({}, DEFAULTS, input);
    p.buyers = p.buyers === 2 ? 2 : 1;
    const terms = loanTerms(p);
    const net = householdNet(p.wage, p.buyers, p.usePrivatePension);
    const pension = p.usePrivatePension ? privatePensionMonthly(p.wage, p.buyers) : 0;
    const contribution = p.monthlySaving + pension;
    const pensionMonths = PRIVATE_PENSION.maxYears * 12;

    // 1. Saving for the deposit
    const r = monthly(p.savingsReturn), g = monthly(p.houseGrowth);
    let savings = p.equity, price = p.price, month = 0;
    const savingPath = [{ month: 0, savings, target: cashNeeded(price, p) }];
    while (savings < cashNeeded(price, p) && month < MAX_MONTHS) {
      savings = savings * (1 + r) + p.monthlySaving + (month < pensionMonths ? pension : 0);
      price *= 1 + g;
      month++;
      savingPath.push({ month, savings, target: cashNeeded(price, p) });
    }
    const reached = savings >= cashNeeded(price, p);

    // 2. The loan at purchase. If the deposit is never reached, show the loan
    //    for buying today with the minimum deposit, so the income check still says something.
    const purchaseMonth = reached ? month : 0;
    const purchasePrice = reached ? price : p.price;
    const ownFunds = reached ? savings - purchasePrice * p.stampDuty / 100 - p.fees
                             : purchasePrice * (1 - p.ltv / 100);
    const loan = Math.max(0, purchasePrice - ownFunds);
    const sched = schedule(loan, p, purchaseMonth);

    // 3. Income needed to get the loan: the debt service test (stress rate and term)
    const stressPayment = annuity(loan, terms.stressRate, terms.stressTerm);
    const netNeeded = stressPayment / (p.dsti / 100);
    const wageNeeded = grossForNet(netNeeded, p.buyers, p.usePrivatePension);

    // 4. What the current wage can carry
    const maxLoan = net * p.dsti / 100 / annuity(1, terms.stressRate, terms.stressTerm);
    // Highest price affordable today: limited by income (loan) and by own funds (deposit)
    const maxPriceToday = Math.max(0, Math.min(
      (maxLoan + p.equity - p.fees) / (1 + p.stampDuty / 100),
      (p.equity - p.fees) / (1 - p.ltv / 100 + p.stampDuty / 100)));

    const horizons = [2, 3, 5, 7, 10].map((years) => ({
      years,
      age: p.age + years,
      monthly: savingNeeded(p, years * 12, pension),
    }));

    return {
      params: p,
      net,
      pension,
      contribution,
      savingShareOfNet: net > 0 ? p.monthlySaving / net : null,
      reached,
      purchaseMonth,
      purchaseAge: p.age + purchaseMonth / 12,
      payoffAge: p.age + purchaseMonth / 12 + p.termYears,
      purchasePrice,
      ownFunds,
      cashNeededToday: cashNeeded(p.price, p),
      loan,
      ltvActual: purchasePrice > 0 ? loan / purchasePrice : 0,
      stressPayment,
      netNeeded,
      // What is left of take-home pay after framfærsluviðmið: now (after current housing
      // costs and the chosen saving) and after buying (after the first payment).
      surplusNow: net - p.livingCosts - p.housingNow - p.monthlySaving,
      surplusAfter: net - p.livingCosts - sched.firstPaymentReal,
      wageNeeded,
      wageOk: p.wage >= wageNeeded,
      maxLoan,
      maxPriceToday,
      horizons,
      pensionRunsOut: pension > 0 && (!reached || purchaseMonth > pensionMonths),
      savingPath,
      schedule: sched,
      terms,
    };
  }

  return {
    TAX, PRIVATE_PENSION, DEFAULTS, FIRST_TIME,
    incomeTax, netIncome, householdNet, privatePensionMonthly, grossForNet,
    annuity, cashNeeded, savingNeeded, schedule, compute,
  };
});
