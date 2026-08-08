/**
 * Badge de rang. La couleur est **toujours** celle du JSON Voltaic
 * (`overallRanks[].color`), passée en style inline : aucune couleur de rang
 * n'existe dans le thème.
 */

interface RankBadgeProps {
  readonly rank: string | null;
  readonly color: string | null;
  /** Badge « Complete » : plein plutôt que teinté. */
  readonly complete?: boolean;
  readonly size?: "sm" | "md";
}

export function RankBadge({ rank, color, complete = false, size = "md" }: RankBadgeProps) {
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  if (rank === null || color === null) {
    return (
      <span
        className={`inline-flex items-center rounded-full border border-steel-700 font-medium tracking-wide text-steel-400 uppercase ${padding}`}
      >
        Sans rang
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wide uppercase ${padding}`}
      style={{
        color: complete ? "var(--color-steel-950)" : color,
        borderColor: complete ? color : `${color}66`,
        backgroundColor: complete ? color : `${color}1f`,
      }}
    >
      {rank}
      {complete ? " Complete" : null}
    </span>
  );
}
