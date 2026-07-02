import logoMark from '../assets/propertylens-logo.svg'

export default function BrandLogo({
  showText = true,
  markClassName = 'h-10 w-10',
  textClassName = 'text-slate-950 dark:text-white',
  subtitleClassName = 'text-slate-500 dark:text-slate-400',
  className = '',
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img src={logoMark} alt="PropertyLens" className={`${markClassName} shrink-0`} />
      {showText && (
        <div className="min-w-0">
          <p className={`font-semibold leading-tight ${textClassName}`}>PropertyLens</p>
          <p className={`text-xs leading-tight ${subtitleClassName}`}>Property Intelligence</p>
        </div>
      )}
    </div>
  )
}
