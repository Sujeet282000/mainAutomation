export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-teal" />
        <path d="M7 11.2h18v3H7zM7 17h12v3H7zM7 22.8h7v3H7z" className="fill-white" />
        <path d="M22.5 17.2l3.5 2.8-3.5 2.8z" className="fill-white" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-ink">FlowShip</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Automation</div>
        </div>
      )}
    </div>
  );
}
