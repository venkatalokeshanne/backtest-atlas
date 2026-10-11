/** @type {import('next').NextConfig} */
// Fully static site: every page is prebuilt and the backtest data is plain JSON under public/data,
// fetched by the browser. No server functions.
const nextConfig = {
  output: "export",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: { unoptimized: true },
};
export default nextConfig;
