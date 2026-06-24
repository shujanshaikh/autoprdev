import * as React from "react";

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit,
) {
  const ref = React.useRef<T>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const root = options?.root ?? null;
  const rootMargin = options?.rootMargin ?? "0px 0px -10% 0px";
  const threshold = options?.threshold ?? 0.16;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(el);
        }
      },
      { root, rootMargin, threshold },
    );

    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- IntersectionObserver updates state asynchronously from a subscription callback, not from a prop-change reset.
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, rootMargin, threshold]);

  return { ref, isVisible };
}
