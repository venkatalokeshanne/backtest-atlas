# Backtest Atlas

Every TradingView strategy (run unchanged by Foresight) and every TrendSpider strategy we backtested, per stock.
Starts with **Explore by symbol**: a grid of the watchlist stocks, and a page per stock with all its backtests,
a sortable table, and a report per backtest (equity curve vs buy & hold, score, early vs recent results).

- `npm run data` rebuilds `public/data` from the backtest exports (see `scripts/build_data.py` for the score)
- `npm run dev` serves it on http://localhost:5070; `npm run build` makes a fully static site in `out/`

Backtests are historical results, not forecasts or advice.
