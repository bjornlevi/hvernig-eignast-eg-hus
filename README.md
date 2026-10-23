# Hvernig eignast ég hús?

A calculator that answers "how can I own a home?" for people in Iceland. You enter
your age, what you own today, how much you save each month and your wage. It shows:

- **when you can afford the deposit** (útborgun + kaupkostnaður), given that house prices keep rising while you save;
- **how much you need to save each month** to buy in 2, 3, 5, 7 or 10 years;
- **the wage needed** to pass the bank's checks (greiðslubyrðarhlutfall and greiðslumat), and the largest loan and price your current wage allows;
- **the loan**: first payment, age when it is paid off, and the total paid, in today's krónur and in nominal krónur, with charts.

Every assumption can be changed: house price (with presets), real house price
growth, indexed or non-indexed loan, interest, inflation, term, loan-to-value,
debt service limits and stress-test rates, stamp duty, fees, living costs,
séreignarsparnaður and the number of buyers.

Flask serves a single page; all calculations run in the browser, so nothing is
stored. The inputs that differ from the defaults are kept in the URL query
string, so a result can be shared.

## Development

```bash
make install   # .venv + dependencies
make dev       # http://localhost:5004
make test      # Python tests (the app) + Node tests (the calculations)
```

To try the sub-folder setup locally: `PREFIX=/hus make dev`, then open
http://localhost:5004/hus/

## How it works

- `static/calc.js` holds all calculations, with no DOM, so `tests/calc.test.js` runs it in Node.
  `static/app.js` reads the form, calls `HusCalc.compute()` and draws the cards, table and charts.
- **Real terms.** Everything is in today's krónur: savings, wage and living costs follow
  inflation; house prices rise `houseGrowth`% a year above it and savings earn `savingsReturn`%.
  The loan schedule is also shown in nominal krónur from today, using `inflation`.
- **Saving.** Month by month: savings ← savings·(1+r) + monthly saving + séreign, until
  savings cover `price·(1 − LTV + stamp duty) + fees`. Séreign (4% + 2% of the wage, at most
  500.000 kr. a year per person) only counts for the first 10 years. Gives up after 50 years.
- **Loan.** Annuity (jafngreiðslulán). An indexed loan is an annuity in real terms, so its
  nominal payment and balance grow with inflation; a non-indexed loan is an annuity in nominal terms.
- **Wage needed** comes from the debt service ratio (Seðlabankinn): the payment, computed with
  at least the stress rate (3% indexed / 5,5% non-indexed) and at most 25 years for indexed loans,
  may be at most 40% (first-time buyers) or 35% of take-home pay.
  Take-home pay is turned into gross wage with the 2025 income tax brackets, personal tax
  credit and 4% pension contribution (plus 4% séreign if used), split evenly between buyers.
- **Framfærsluviðmið** (`livingCosts`, excluding housing) and **current housing costs** (`housingNow`,
  rent etc., which the viðmið leaves out) are for reference only and change no other result: the page
  shows what is left of take-home pay, both now (after both and the chosen monthly saving) and after
  buying (after the viðmið and the first payment). Users can get their own viðmið from
  https://island.is/framfaerslureiknivel. Defaults are rough estimates,
  250.000 kr. for one and 400.000 kr. for two; Umboðsmaður skuldara does not publish the amounts online.
- **Defaults** (in `DEFAULTS` in `calc.js`): 25 years old, 2 m.kr. equity, 100.000 kr. a month,
  650.000 kr. wage, a 55 m.kr. two-room flat, first-time buyer (85% LTV, 40% DSTI, 0,4% stamp duty),
  indexed loan at 4% for 25 years, 3,5% inflation.

### Yearly upkeep

Check and update in `static/calc.js`:

- `TAX`: income tax brackets and personal tax credit (skatturinn.is), each January.
- `DEFAULTS`: interest rates, inflation, typical prices and framfærsluviðmið (also `LIVING_COSTS` in `app.js`).
- Seðlabankinn's rules on loan-to-value and debt service (`ltv`, `dsti`, `stress*`, also `FIRST_TIME`).
- The séreign rules in `PRIVATE_PENSION`.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PREFIX` | *(empty)* | URL prefix behind a reverse proxy, e.g. `/hus` |
| `SITE_NAME` | `Hvernig eignast ég hús?` | |

## Deployment (bjornlevi.is/hus)

Runs like skraning: gunicorn on `127.0.0.1:8019` behind nginx, mounted at `/hus`,
as the system user `web`, with settings in `/etc/default/hus`. No database or secrets.

```bash
sudo mkdir /srv/hus && sudo chown $USER: /srv/hus
git clone git@github.com:bjornlevi/hvernig-eignast-eg-hus.git /srv/hus   # as yourself, with your GitHub key
cd /srv/hus && make install

sudo cp deploy/hus.env.example /etc/default/hus
sudo cp deploy/hus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hus
curl -sI http://127.0.0.1:8019/hus/ | head -1     # expect: HTTP/1.1 200 OK
```

Then add the `location /hus/` block from `deploy/nginx.conf` to the existing
`server { }` block for bjornlevi.is, and reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Updating

```bash
cd /srv/hus && git pull
sudo systemctl restart hus
```
