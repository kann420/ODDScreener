/** @type {import('next').NextConfig} */

// Bundle analyzer (run with: npm run analyze)
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  // ===== Performance Optimizations =====
  // Use SWC minifier for faster builds and smaller bundles
  swcMinify: true,
  
  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },

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

  // ===== Module Transpilation for smaller bundles =====
  transpilePackages: [
    'lightweight-charts',
  ],

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
        // Enable module concatenation for smaller bundles
        concatenateModules: true,
        // Optimize chunk splitting for better caching
        splitChunks: {
          chunks: 'all',
          minSize: 15000,    // Reduced from 20000
          maxSize: 150000,   // Reduced from 200000 for faster parsing
          minChunks: 1,
          maxAsyncRequests: 30,
          maxInitialRequests: 30,
          cacheGroups: {
            default: false,
            vendors: false,
            // React framework - load first, cache separately
            framework: {
              name: 'framework',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 50,
              enforce: true,
              reuseExistingChunk: true,
            },
            // Large charting libraries - lazy load separately
            charts: {
              name: 'charts',
              test: /[\\/]node_modules[\\/](lightweight-charts|recharts|d3)[\\/]/,
              chunks: 'async',  // Only load when needed
              priority: 45,
              enforce: true,
            },
            // Utility libraries (smaller, used often)
            utils: {
              name: 'utils',
              test: /[\\/]node_modules[\\/](date-fns|lodash|clsx)[\\/]/,
              chunks: 'all',
              priority: 40,
              reuseExistingChunk: true,
            },
            // Other vendor libraries
            lib: {
              test: /[\\/]node_modules[\\/]/,
              name(module) {
                const match = module.context?.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/);
                const packageName = match?.[1] || 'vendors';
                // Group small packages together
                return `npm.${packageName.replace('@', '')}`;
              },
              priority: 30,
              chunks: 'all',
              minChunks: 1,
              reuseExistingChunk: true,
            },
            // Common shared code
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 20,
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

export default withBundleAnalyzer(nextConfig);