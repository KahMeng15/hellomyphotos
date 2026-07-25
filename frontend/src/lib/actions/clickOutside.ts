export function clickOutside(node: HTMLElement, callback: () => void) {
  function handleClick(event: MouseEvent) {
    if (!node.contains(event.target as Node)) {
      callback();
    }
  }

  function handleScroll() {
    callback();
  }

  document.addEventListener('click', handleClick, true);
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true });

  return {
    destroy() {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('scroll', handleScroll, true);
    }
  };
}
