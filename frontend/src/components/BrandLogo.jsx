export default function BrandLogo({
  showText = true,
  markClassName = 'h-10 w-10',
  textClassName = 'text-slate-950 dark:text-white',
  subtitleClassName = 'text-slate-500 dark:text-slate-400',
  className = '',
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg viewBox="0 0 40 40" className={`${markClassName} shrink-0`} role="img" aria-label="PropertyLens" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="#059669" />
        <path d="M10.5 19.5 L20 11.5 L29.5 19.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 18 V28.5 H27 V18" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19.5" cy="22.5" r="3.4" fill="none" stroke="#ffffff" strokeWidth="2.2" />
        <line x1="22" y1="25" x2="24.6" y2="27.6" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {showText && (
        <div className="min-w-0">
          <p className={`font-semibold leading-tight ${textClassName}`}>PropertyLens</p>
          <p className={`text-xs leading-tight ${subtitleClassName}`}>Property Intelligence</p>
        </div>
      )}
    </div>
  )
}
