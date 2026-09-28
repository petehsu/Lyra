/** Exclude our presentation without removing nodes, focus, or page-owned paint. */
export const READ_SURFACE_TEXT = String.raw`(root=document.body) => {
  if(!root)return '';
  const overlays=[...document.querySelectorAll('#__lyra_agent_page_cursor__,[data-lyra-agent-overlay]')];
  const saved=overlays.map(n=>[n,n.style.getPropertyValue('visibility'),n.style.getPropertyPriority('visibility')]);
  try {for(const [n] of saved)n.style.setProperty('visibility','hidden','important');return (root.innerText||'').replace(/\s+/g,' ').trim();}
  finally {for(const [n,v,p] of saved){if(v)n.style.setProperty('visibility',v,p);else n.style.removeProperty('visibility');}}
}`;
