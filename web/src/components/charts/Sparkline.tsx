interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Accent for the current point; the line itself stays de-emphasised. */
  accent?: string;
  label: string;
}

/** A shape, not a chart. It has no axis, so every value it hints at is printed elsewhere. */
export function Sparkline({
  values,
  width = 72,
  height = 22,
  accent = "var(--foreground)",
  label,
}: Props) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="overflow-visible"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-muted-foreground/60"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r={2.5}
        fill={accent}
        stroke="var(--chart-surface)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
