export const HERO_ARTWORK = {
  src: "/hero-landscape-2400.webp",
  srcSet: "/hero-landscape-1200.webp 1200w, /hero-landscape-2400.webp 2400w, /hero-landscape-3652.webp 3652w",
  width: 3652,
  height: 5315
} as const;

export function HeroLandscape({ desktop = false }: { readonly desktop?: boolean }) {
  return (
    <div className={`hero-artwork${desktop ? " desktop-wallpaper" : ""}`} aria-hidden="true">
      <img
        src={HERO_ARTWORK.src}
        srcSet={HERO_ARTWORK.srcSet}
        sizes="100vw"
        alt=""
        width={HERO_ARTWORK.width}
        height={HERO_ARTWORK.height}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </div>
  );
}
