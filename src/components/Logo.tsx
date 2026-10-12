import logoSrc from '../assets/logo.svg'

/**
 * The MedRep Connect Pro mark.
 *
 * `logoSrc` is src/assets/logo.svg — the single source of truth for the brand.
 * scripts/generate-icons.mjs rasterises that very same file into the favicon
 * and every PWA icon, so the logo in the app, the browser tab and the
 * installed home-screen icon are always pixel-identical.
 *
 * The artwork already carries its rounded brand tile, so the component only
 * clips its shadow to the same radius (112 / 512 ≈ 22%).
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <img
      src={logoSrc}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className="inline-block shrink-0 select-none rounded-[22%] shadow-md shadow-brand-600/30"
      style={{ width: size, height: size }}
    />
  )
}

export function Wordmark({ size = 'text-lg' }: { size?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Logo size={36} />
      <div className="leading-tight min-w-0">
        {/* Mobile requirement: the app name stays on ONE line, tagline below. */}
        <div className={`font-extrabold text-slate-900 whitespace-nowrap ${size}`}>
          MedRep <span className="text-brand-600">Connect Pro</span>
        </div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
          Pharma &amp; Jobs Hub
        </div>
      </div>
    </div>
  )
}
