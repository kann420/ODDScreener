/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next',
  experimental: {
    turbo: {
      memoryLimit: 512,
    },
  },
};
export default nextConfig;
