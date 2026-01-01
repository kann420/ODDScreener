"use client";
import { useEffect, useState } from "react";

export default function useInView(ref, options = { root: null, rootMargin: "200px", threshold: 0.01 }) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!ref?.current) return;

    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setInView(true);
    }, options);

    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, options.root, options.rootMargin, options.threshold]);

  return inView;
}
