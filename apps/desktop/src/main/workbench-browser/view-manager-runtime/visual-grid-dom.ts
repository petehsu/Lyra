// Geometry only: no site classes, business state, hover sweep or hidden controls.
// A complete Cartesian set is required; sparse/irregular groups remain individual.
export const GROUP_VISUAL_GRIDS = String.raw`(records, find, stamp, signature, documentId) => {
  const points = records.filter(item => item.kind === 'control').map(item => ({ item, node: find(item.targetRef) })).filter(p => p.node);
  const buckets = new Map();
  for (const point of points) {
    for (let owner = point.node.parentElement, depth = 0; owner && depth < 4; owner = owner.parentElement, depth++) {
      if (owner.matches('body,html')) break;
      let members = buckets.get(owner);
      if (!members) buckets.set(owner, members = []);
      members.push(point);
    }
  }
  const axis = values => {
    const groups = [];
    for (const value of values.sort((a,b) => a-b)) {
      const group = groups.at(-1);
      if (group && Math.abs(group[0] - value) < 2) group.push(value); else groups.push([value]);
    }
    const centers = groups.map(group => group.reduce((a,b) => a+b,0)/group.length);
    if (centers.length < 2 || centers.length > 60) return null;
    const step = (centers.at(-1) - centers[0])/(centers.length-1);
    if (step < 10 || centers.some((v,i) => Math.abs(v-centers[0]-step*i) > Math.max(1.5,step*.035))) return null;
    return centers;
  };
  const used = new Set(), regions = [];
  const entries = [...buckets].filter(([, members]) => members.length >= 9 && members.length <= 1600)
    .sort((a,b) => a[1].length-b[1].length);
  for (const [owner, members] of entries) {
    if (members.some(p => used.has(p.item.targetRef))) continue;
    const first = members[0].item.bounds;
    if (members.some(p => Math.abs(p.item.bounds.width-first.width)>Math.max(2,first.width*.1)
      || Math.abs(p.item.bounds.height-first.height)>Math.max(2,first.height*.1))) continue;
    const xs = axis(members.map(p => p.item.bounds.x+p.item.bounds.width/2));
    const ys = axis(members.map(p => p.item.bounds.y+p.item.bounds.height/2));
    if (!xs || !ys || xs.length*ys.length !== members.length) continue;
    const ordered = Array(members.length);
    for (const { item } of members) {
      const column = xs.findIndex(x => Math.abs(x-item.bounds.x-item.bounds.width/2)<2);
      const row = ys.findIndex(y => Math.abs(y-item.bounds.y-item.bounds.height/2)<2);
      if (row < 0 || column < 0 || ordered[row*xs.length+column]) break;
      ordered[row*xs.length+column] = { ...item, signature:signature(find(item.targetRef),'cell'), gridCell:true };
    }
    if (ordered.filter(Boolean).length !== members.length) continue;
    const b = owner.getBoundingClientRect();
    if (!b.width || !b.height || xs[0]<b.left || ys[0]<b.top || xs.at(-1)>b.right || ys.at(-1)>b.bottom) continue;
    // A repeated set must occupy its own region, not a small corner of a page.
    if ((xs.at(-1)-xs[0]+first.width)*(ys.at(-1)-ys[0]+first.height) < b.width*b.height*.6) continue;
    const targetRef = stamp(owner);
    regions.push({ targetRef, documentId, signature:signature(owner,true), kind:'region',
      role:owner.getAttribute('role') || owner.tagName.toLowerCase(), disabled:owner.matches(':disabled') || !!owner.closest('[inert],[aria-disabled=true]'),
      bounds:{x:b.x,y:b.y,width:b.width,height:b.height},
      grid:{source:'dom',xs:xs.map(x=>(x-b.x)/b.width),ys:ys.map(y=>(y-b.y)/b.height),cells:ordered} });
    used.add(targetRef);
    for (const { item } of members) used.add(item.targetRef);
  }
  return [...records.filter(item => !used.has(item.targetRef)), ...regions];
}`;

/** Check stored references/geometry without rebuilding a map or matching new nodes. */
export const validateDomGrid = (
  ref: string,
  cells: readonly { targetRef: string }[],
  xs: readonly number[],
  ys: readonly number[],
): string => `(() => {
  const region=findSurfaceTarget(${JSON.stringify(ref)}), refs=${JSON.stringify(cells.map((cell) => cell.targetRef))};
  if(!region) return false;
  const box=region.getBoundingClientRect(),xs=${JSON.stringify(xs)},ys=${JSON.stringify(ys)};
  if(!box.width||!box.height) return false;
  return refs.every((ref,i)=>{
    const node=findSurfaceTarget(ref); if(!node?.isConnected || !region.contains(node)) return false;
    const b=node.getBoundingClientRect();
    return b.width>0 && b.height>0 && Math.abs((b.x+b.width/2-box.x)/box.width-xs[i%xs.length])<.004
      && Math.abs((b.y+b.height/2-box.y)/box.height-ys[Math.floor(i/xs.length)])<.004;
  });
})()`;
