# Realistic-fill check (Traded watchlist finalists)

`fills_check.json`: the 196 most consistent Traded-watchlist backtests (30+ trades, held up, no repaint, no Check fills,
every window profitable, all of the last 6 months profitable with 3+ trades each), each re-run in Foresight under:

- **tv**: TradingView's fills (what the site shows)
- **strict**: exits from the next bar on, the stop wins when a bar touches stop and target, close-based trailing,
  1-cent spread
- **adversarial**: strict + 1 cent of random adverse slippage on every fill

Script: `scripts/fills_check.py` (run from pine_screen). Results (194 of 196 ran under all three models):

- 88 stay profitable overall and over the last 6 months under strict fills; 83 also under adversarial;
  73 also keep at least 5 of the last 6 months profitable under strict.
- Median profit factor under strict = 0.75 x the TradingView figure.
- Whole families collapse: e.g. ULTIMATE TEMA/LSMA + INSTITUTIONAL (net turns deeply negative everywhere),
  Q-Trend w/ SL+Trailing Stop on NET 5m (PF 2.94 -> 0.52).
- Barely affected: McGinley T3 Flow Campaign, VuManChu WT Zero Cross, CLR System (market-order logic).
