import { useLayoutEffect } from 'react';

/**
 * The desktop compositions (homepage hero and the reused Vision, Doctrine, Blueprint and Journey
 * sections) are drawn on a 1440px frame. Between 1280px and 1440px they are scaled with CSS zoom
 * (.landing-desktop / .landing-scale in index.css). A layout effect, so the first paint is
 * already at the right scale.
 */
export function useLandingZoom() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const width = root.clientWidth;
      root.style.setProperty('--landing-zoom', width >= 1280 && width < 1440 ? String(width / 1440) : '1');
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      root.style.removeProperty('--landing-zoom');
    };
  }, []);
}

/** Deep links such as /#journey: jump to the section once the page has rendered. */
export function useInitialHashScroll() {
  useLayoutEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);
}
