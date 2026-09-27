/** Visible prose associated by DOM structure, never a guessed control purpose. */
export const FIELD_DESCRIPTION_RUNTIME = String.raw`(node => {
  if (!node.matches('input:not([type=hidden]),textarea,select,[role=textbox]')) return '';
  const field = 'input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select,[role=textbox]';
  const read = candidate => {
    if (!candidate || !candidate.getClientRects().length) return '';
    const style = candidate.ownerDocument.defaultView.getComputedStyle(candidate);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return '';
    return (candidate.innerText || candidate.textContent || '').replace(/\s+/g,' ').trim().slice(0,240);
  };
  const previous = node.previousElementSibling;
  if (previous?.matches('label,p,legend,h1,h2,h3,[role=heading]') && !previous.querySelector(field)) {
    const text = read(previous); if (text) return text;
  }
  for (let container = node.parentElement, depth = 0; container && depth < 3; container = container.parentElement, depth++) {
    if (container.querySelectorAll(field).length !== 1) break;
    const prose = Array.from(container.children).filter(child => child.matches('label,p,legend,h1,h2,h3,[role=heading]') && !child.querySelector(field));
    const text = prose.map(read).filter(Boolean).join(' ').slice(0,240);
    if (text) return text;
    if (container.matches('form,dialog,[role=dialog]')) break;
  }
  return '';
})`;
