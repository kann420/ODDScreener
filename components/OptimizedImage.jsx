/**
 * OptimizedImage Component
 * 
 * Tối ưu image loading với:
 * - Next.js Image component cho local images
 * - wsrv.nl proxy cho external images (auto resize, WebP/AVIF)
 * - Lazy loading mặc định
 * - Placeholder blur
 * - Responsive srcset
 */

"use client";

import Image from "next/image";
import { useState, useMemo } from "react";

/**
 * Sử dụng wsrv.nl để resize và optimize external images
 * Free, fast, supports WebP/AVIF conversion
 * 
 * @param {string} url - Original image URL
 * @param {number} width - Desired width
 * @param {number} quality - Image quality (1-100)
 * @returns {string} Optimized image URL
 */
export function getOptimizedImageUrl(url, width = 300, quality = 80) {
  if (!url) return "";
  
  // Skip SVGs - they don't need optimization
  if (url.endsWith(".svg")) return url;
  
  // Skip if already a data URL
  if (url.startsWith("data:")) return url;
  
  // Skip local images - Next.js handles these
  if (url.startsWith("/")) return url;
  
  // Use wsrv.nl for external images
  // Supports: resize, WebP/AVIF output, caching
  const params = new URLSearchParams({
    url: url,
    w: String(width),
    q: String(quality),
    output: "webp", // Auto convert to WebP
    default: "placeholder", // Show placeholder if image fails
  });
  
  return `https://wsrv.nl/?${params.toString()}`;
}

/**
 * Get srcset for responsive images
 */
export function getOptimizedSrcSet(url, sizes = [100, 200, 300, 400]) {
  if (!url || url.endsWith(".svg") || url.startsWith("data:") || url.startsWith("/")) {
    return undefined;
  }
  
  return sizes
    .map((w) => `${getOptimizedImageUrl(url, w)} ${w}w`)
    .join(", ");
}

/**
 * OptimizedImage Component
 * 
 * For external images: uses wsrv.nl proxy
 * For local images: uses Next.js Image
 */
export function OptimizedImage({
  src,
  alt = "",
  width,
  height,
  className,
  style,
  priority = false,
  sizes,
  quality = 80,
  onError,
  ...props
}) {
  // No src
  if (!src) return null;
  
  // SVGs - use regular img, they're vector
  if (src.endsWith(".svg")) {
    return (
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={style}
        loading={priority ? "eager" : "lazy"}
        {...props}
      />
    );
  }
  
  // Local images - use Next.js Image (automatic optimization)
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={style}
        priority={priority}
        quality={quality}
        {...props}
      />
    );
  }
  
  // External images - use wsrv.nl proxy for optimization
  const optimizedSrc = getOptimizedImageUrl(src, width || 300, quality);
  const srcSet = getOptimizedSrcSet(src, [
    Math.round((width || 300) * 0.5),
    width || 300,
    Math.round((width || 300) * 1.5),
    Math.round((width || 300) * 2),
  ]);
  
  return (
    <img
      src={optimizedSrc}
      srcSet={srcSet}
      sizes={sizes || `${width || 300}px`}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={onError}
      {...props}
    />
  );
}

/**
 * Thumbnail component với optimization built-in
 * Dùng cho market thumbnails
 */
export function OptimizedThumbnail({
  url,
  size = 45,
  radius = 10,
  priority = false,
  className,
}) {
  const [errored, setErrored] = useState(false);
  const showImg = Boolean(url) && !errored;

  // Pre-compute optimized URL
  const optimizedUrl = useMemo(() => {
    if (!url || errored) return null;
    return getOptimizedImageUrl(url, size * 2, 80); // 2x for retina
  }, [url, size, errored]);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: "rgba(255,255,255,0.08)",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showImg && optimizedUrl ? (
        <img
          src={optimizedUrl}
          alt=""
          width={size}
          height={size}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          onError={() => setErrored(true)}
        />
      ) : null}
    </div>
  );
}

export default OptimizedImage;
