export default function PageContainer({ children, className = '' }) {
  const classes = ['mx-auto w-full max-w-[112rem] space-y-6', className]
    .filter(Boolean)
    .join(' ')

  return <div className={classes}>{children}</div>
}
