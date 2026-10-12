import { useEffect, useState, type ReactNode } from "react";

/**
 * Chevron 波形延迟：9 个像素在 3×3 网格中的独立动画延迟。
 * 中间行的像素最先亮（90ms），两侧对称延迟（0/180ms），
 * 形成 ">" 形状的波浪扫过效果。
 */
const chevronDelays = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  // 公式：列偏移 + |行-1| 产生顶点在中间行的 V 形
  return (col + Math.abs(row - 1)) * 90;
});

/**
 * 每 100ms 更新一次，返回格式化后的耗时字符串。
 * - < 60s → "3.2s"
 * - >= 60s → "1m 15.3s"
 */
function useElapsed() {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTenths((v) => v + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const seconds = tenths / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export default function LoadingState({
  label = "Thinking",
  variant = "Drive",
}: {
  label?: string;
  variant?: string;
}): ReactNode {
  const elapsed = useElapsed();
  const isDots = variant === "Dots";

  return (
    <div
      className="flex items-center gap-2.5 h-[38px] px-2.5"
      role="status"
      aria-label={label}
    >
      {/* ── 3×3 像素网格 ── */}
      <span
        className="grid grid-cols-[repeat(3,4px)] shrink-0 gap-[1.5px]"
        aria-hidden
      >
        {chevronDelays.map((delay, i) => (
          <span
            key={i}
            className="bg-ink opacity-15"
            style={{
              width: 4,
              height: 4,
              // Drive 变体：方形像素（1px 圆角）；Dots 变体：圆形
              borderRadius: isDots ? "50%" : 1,
              animation: `pixel-on 650ms ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </span>

      {/* ── shimmer 文字 ── */}
      <span
        className="text-[13px] font-medium"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>

      {/* ── 等宽计时器 ── */}
      <span className="text-ink-3 font-mono text-xs tabular-nums">
        {elapsed}
      </span>
    </div>
  );
}