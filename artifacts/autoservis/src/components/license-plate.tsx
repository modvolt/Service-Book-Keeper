import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, {
  h: string;
  text: string;
  stripW: string;
  cz: string;
  starsDim: number;
  px: string;
}> = {
  sm: { h: "h-5", text: "text-[11px]", stripW: "w-4", cz: "text-[6px]", starsDim: 8, px: "px-1.5" },
  md: { h: "h-7", text: "text-sm", stripW: "w-5", cz: "text-[8px]", starsDim: 10, px: "px-2" },
  lg: { h: "h-9", text: "text-lg", stripW: "w-7", cz: "text-[10px]", starsDim: 12, px: "px-2.5" },
  xl: { h: "h-12", text: "text-2xl", stripW: "w-9", cz: "text-xs", starsDim: 16, px: "px-3" },
};

function formatPlate(plate: string): string {
  const cleaned = plate.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length === 7) return cleaned.slice(0, 3) + " " + cleaned.slice(3);
  if (cleaned.length === 8) return cleaned.slice(0, 4) + " " + cleaned.slice(4);
  return cleaned;
}

function EuStars({ dim }: { dim: number }) {
  const cx = dim / 2;
  const radius = dim / 2 - 1;
  const r = Math.max(0.5, dim / 16);
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + Math.cos(a) * radius, y: cx + Math.sin(a) * radius };
  });
  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} aria-hidden>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={r} fill="#FFCC00" />
      ))}
    </svg>
  );
}

export function LicensePlate({
  plate,
  size = "md",
  className,
}: {
  plate: string;
  size?: Size;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex items-stretch rounded-[3px] border border-neutral-300 bg-white overflow-hidden shadow-sm select-none align-middle leading-none",
        s.h,
        className,
      )}
      title={formatPlate(plate)}
    >
      <span
        className={cn(
          "flex flex-col items-center justify-center bg-[#003399] text-white py-0.5 gap-0.5",
          s.stripW,
        )}
      >
        <EuStars dim={s.starsDim} />
        <span className={cn("font-sans font-bold tracking-tight", s.cz)}>CZ</span>
      </span>
      <span
        className={cn(
          "flex items-center font-bold tracking-wider text-black font-mono",
          s.text,
          s.px,
        )}
      >
        {formatPlate(plate)}
      </span>
    </span>
  );
}
