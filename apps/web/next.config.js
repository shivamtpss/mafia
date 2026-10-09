/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for the Docker runtime stage.
  output: 'standalone',
  // The monorepo root is two levels up; tell Next where to trace files from.
  // (Next 14 exposes this under `experimental`.)
  experimental: {
    outputFileTracingRoot: require('path').join(__dirname, '../../'),
  },
  // Compile the shared workspace package from source.
  transpilePackages: ['@ai-mafia/shared'],
};

module.exports = nextConfig;
