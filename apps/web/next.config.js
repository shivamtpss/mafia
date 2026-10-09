/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for the Docker runtime stage.
  output: 'standalone',
  // The monorepo root is two levels up; tell Next where to trace files from.
  // (Top-level key as of Next 15+.)
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  // Note: @ai-mafia/shared ships a prebuilt dual CJS/ESM bundle and is consumed
  // directly via its package exports. It must NOT go in transpilePackages, or
  // Next's React Refresh transform would inject `import.meta` into its CJS file.
};

module.exports = nextConfig;
