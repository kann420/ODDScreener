/** @type {import('next').NextConfig} */
const nextConfig = {
  // ===== Image Optimization =====
  images: {
    // Enable modern formats (WebP, AVIF)
    formats: ['image/avif', 'image/webp'],
    
    // Allow external images
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    
    // Device sizes for responsive images (optimized for common breakpoints)
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    
    // Minimize image size - 30 days cache
    minimumCacheTTL: 60 * 60 * 24 * 30,
    
    // Disable image optimization for SVGs (they're already optimized)
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // ===== Compression (Gzip/Brotli) =====
  compress: true,

  // ===== Production Build Optimization =====
  productionBrowserSourceMaps: false, // Disable source maps in production for smaller bundles

  // ===== Experimental Features for Faster Loading =====
  experimental: {
    // Enable optimized package imports for common libraries
    optimizePackageImports: [
      'react', 
      'react-dom',
      'lightweight-charts',  // If you use trading charts
      'date-fns',           // If you use date-fns
    ],
  },

  // ===== Headers for Caching =====
  async headers() {
    return [
      {
        // Cache static assets (images, fonts, etc.) for 1 year
        source: '/:all*(svg|jpg|jpeg|png|gif|ico|webp|woff|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Cache JS/CSS bundles
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // API routes - short cache with stale-while-revalidate
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=10, stale-while-revalidate=30',
          },
        ],
      },
    ];
  },

  // ===== Webpack Optimization =====
  webpack: (config, { dev, isServer }) => {
    // Production optimizations only
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        // Optimize chunk splitting for better caching
        splitChunks: {
          chunks: 'all',
          minSize: 20000,
          maxSize: 200000, // Reduced from 244000 for better loading
          cacheGroups: {
            default: false,
            vendors: false,
            // Framework chunk (React, etc.)
            framework: {
              name: 'framework',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
              enforce: true,
            },
            // Libraries chunk (large dependencies)
            lib: {
              test: /[\\/]node_modules[\\/]/,
              name(module) {
                const packageName = module.context.match(
                  /[\\/]node_modules[\\/](.*?)([\\/]|$)/
                )?.[1];
                // Create separate chunks for large libraries
                if (packageName && ['lightweight-charts', 'recharts', 'd3'].some(lib => packageName.includes(lib))) {
                  return `lib.${packageName.replace('@', '')}`;
                }
                return 'vendors';
              },
              priority: 30,
              chunks: 'all',
            },
            // Common chunk for shared code
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
              enforce: true,
            },
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;