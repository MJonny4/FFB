import { useEffect, useRef } from "react";
import { WalletCards } from "lucide-react";
import { coins } from "../lib/api.ts";

export function Wallet({ balance }: { balance: number }) {
  const value = useRef<HTMLSpanElement>(null);
  const previous = useRef(balance);
  useEffect(() => {
    const from = previous.current;
    previous.current = balance;
    if (!value.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (balance >= from || reduced.matches) {
      value.current.textContent = coins(balance);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const paint = (now: number) => {
      const progress = reduced.matches ? 1 : Math.min(1, (now - start) / 400);
      if (value.current)
        value.current.textContent = coins(
          Math.round(from + (balance - from) * (1 - (1 - progress) ** 3)),
        );
      if (progress < 1) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [balance]);
  return (
    <a className="wallet" href="#/profile" aria-label={`Wallet: ${coins(balance)} virtual coins`}>
      <WalletCards size={18} aria-hidden="true" />
      <span ref={value} aria-hidden="true">
        {coins(balance)}
      </span>
      <small aria-hidden="true">coins</small>
    </a>
  );
}
