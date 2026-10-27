type IconProps = { className?: string; size?: number; strokeWidth?: number };

function svgProps(size: number, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** ChurnIQ mark — Maasai-shield silhouette carrying a live risk waveform. */
export function LogoMark({ className, size = 28, strokeWidth = 1.4 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 2.4c2.6 1.5 5 2.2 7.4 2.3 0 6.3-1 11-7.4 16.9C5.6 15.7 4.6 11 4.6 4.7 7 4.6 9.4 3.9 12 2.4Z" />
      <path d="M7.4 12.1h2.3l1.4-3.2 1.7 5.6 1.3-2.4h2.5" stroke="currentColor" strokeWidth={strokeWidth * 1.15} />
    </svg>
  );
}

export function IconExecutive({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M3 4.2h18v15.6H3z" />
      <path d="M3 8.4h18" />
      <path d="M6.2 16.4v-3.1M9.4 16.4v-5.4M12.6 16.4v-2.1M15.8 16.4v-4.2" />
    </svg>
  );
}

export function IconExplorer({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <circle cx="10.4" cy="10.4" r="6.2" />
      <path d="M15 15l4.6 4.6" />
      <path d="M8.2 12.4v-2.2M10.4 12.4V8.4M12.6 12.4v-3" />
    </svg>
  );
}

export function IconPredict({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M4 17.6a8.4 8.4 0 0 1 16 0" />
      <path d="M12 17.6l4.3-5.2" />
      <circle cx="12" cy="17.6" r="1.2" />
      <path d="M3 20.6h18" />
    </svg>
  );
}

export function IconRadar({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M12 12l6.1-4.6" />
    </svg>
  );
}

export function IconRetention({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLab({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M9.4 2.8h5.2" />
      <path d="M10.4 2.8v6.1L5.6 17.6c-.9 1.6.2 3.6 2 3.6h8.8c1.8 0 2.9-2 2-3.6l-4.8-8.7V2.8" />
      <path d="M7.8 14.6h8.4" />
      <circle cx="10.6" cy="17.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="18.8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStream({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M2.6 6.6h6.2M13 6.6h8.4" />
      <path d="M2.6 12h10.2M17 12h4.4" />
      <path d="M2.6 17.4h4.8M11.6 17.4h9.8" />
      <circle cx="10.9" cy="6.6" r="1.5" />
      <circle cx="14.9" cy="12" r="1.5" />
      <circle cx="9.5" cy="17.4" r="1.5" />
    </svg>
  );
}

export function IconOps({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 2.6c2.3 1.3 4.4 2 6.6 2.1 0 5.6-.9 9.8-6.6 15-5.7-5.2-6.6-9.4-6.6-15 2.2-.1 4.3-.8 6.6-2.1Z" />
      <path d="M8.4 11.6h1.9l1.2-2.6 1.6 5 1.2-2.4h1.7" />
    </svg>
  );
}

export function IconAlert({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 3.6 21.4 20H2.6L12 3.6Z" />
      <path d="M12 9.6v4.6" />
      <circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCheck({ className, size = 16, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M4.6 12.6l4.6 4.6L19.6 6.8" />
    </svg>
  );
}

export function IconClose({ className, size = 16, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

export function IconChevron({ className, size = 16, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M9 5.4l6.6 6.6L9 18.6" />
    </svg>
  );
}

export function IconArrowUpRight({ className, size = 16, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M7 17L17 7" />
      <path d="M9.2 7H17v7.8" />
    </svg>
  );
}

export function IconSearch({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="M15.6 15.6 20.4 20.4" />
    </svg>
  );
}

export function IconRefresh({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.4 4.2v4.6h-4.6" />
    </svg>
  );
}

export function IconDownload({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 3.6v11" />
      <path d="M7.6 10.4 12 14.8l4.4-4.4" />
      <path d="M4.4 19.4h15.2" />
    </svg>
  );
}

export function IconUpload({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 15.4v-11" />
      <path d="M7.6 8.6 12 4.2l4.4 4.4" />
      <path d="M4.4 19.4h15.2" />
    </svg>
  );
}

export function IconDatabase({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <ellipse cx="12" cy="6" rx="7.4" ry="2.8" />
      <path d="M4.6 6v12c0 1.6 3.3 2.8 7.4 2.8s7.4-1.2 7.4-2.8V6" />
      <path d="M19.4 12c0 1.6-3.3 2.8-7.4 2.8S4.6 13.6 4.6 12" />
    </svg>
  );
}

export function IconCpu({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M7 7h10v10H7z" />
      <path d="M10 10h4v4h-4z" />
      <path d="M10 3.4V7M14 3.4V7M10 17v3.6M14 17v3.6M3.4 10H7M3.4 14H7M17 10h3.6M17 14h3.6" />
    </svg>
  );
}

export function IconClock({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.2 2.2" />
    </svg>
  );
}

export function IconPlay({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M7.4 4.8 19 12 7.4 19.2V4.8Z" />
    </svg>
  );
}

export function IconPause({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M8.6 4.8v14.4M15.4 4.8v14.4" />
    </svg>
  );
}

export function IconMoney({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M2.8 6.6h18.4v10.8H2.8z" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M6.2 12h.01M17.8 12h.01" />
    </svg>
  );
}

export function IconLayers({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M12 3.2 21 8l-9 4.8L3 8l9-4.8Z" />
      <path d="M3 12.6 12 17.4l9-4.8" />
      <path d="M3 16.6 12 21.4l9-4.8" />
    </svg>
  );
}

export function IconTrend({ className, size = 16, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...svgProps(size, strokeWidth)} className={className}>
      <path d="M3.2 17.4 9 11.2l3.6 3.4 7.8-8.4" />
      <path d="M15.2 6.2h5.2v5.2" />
    </svg>
  );
}
