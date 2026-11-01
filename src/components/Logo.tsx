/**
 * Dhruva: the pole star. A four-point star held in a dashed orbit, with one small light travelling the ring.
 * The star is the fixed point; the light is the shipment that moves around it.
 */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke="#ffd99a" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="0.9 3.1" opacity="0.8" />
      <path d="M16 5.2C16.7 12 20 15.3 26.8 16C20 16.7 16.7 20 16 26.8C15.3 20 12 16.7 5.2 16C12 15.3 15.3 12 16 5.2Z" fill="#ffefcf" />
      <circle cx="25.9" cy="6.1" r="3.3" fill="#000" />
      <circle cx="25.9" cy="6.1" r="2.1" fill="#ffab2e" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <a className="brand" href={href} aria-label="Dhruva home">
      <Mark />
      <span className="brand-word">Dhruva</span>
    </a>
  );
}
