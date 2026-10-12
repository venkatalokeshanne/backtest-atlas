/** @type {import('next').NextConfig} */
// Pages are prebuilt; the stock pages read plain JSON under public/data in the browser. One server function,
// /api/backtests, serves the All backtests table a page at a time from data/all (every backtest of every stock).
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: { unoptimized: true },
  // the function needs only the all-backtests files and the strategy list, never the 600 MB of per-stock files
  outputFileTracingIncludes: { "/api/backtests": ["./data/all/**", "./public/data/strategies.json"] },
  outputFileTracingExcludes: { "/api/backtests": ["./public/data/symbol/**", "./scripts/**", "./analysis/**"] },
};
export default nextConfig;
