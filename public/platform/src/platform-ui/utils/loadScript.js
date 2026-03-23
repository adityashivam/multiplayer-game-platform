export function loadScript(src, { id, type } = {}) {
  return new Promise((resolve, reject) => {
    if (id) {
      const existing = document.getElementById(id);
      if (existing) {
        resolve();
        return;
      }
    }
    const script = document.createElement("script");
    if (id) script.id = id;
    if (type) script.type = type;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}
