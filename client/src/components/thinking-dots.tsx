export function ThinkingDots() {
  const delays = ["0ms", "140ms", "280ms"];

  return (
    <span className="inline-flex items-center gap-1" aria-label="AI is thinking">
      {delays.map((delay) => (
        <span
          key={delay}
          className="inline-block h-2.5 w-2.5 rounded-full bg-dim animate-typing-dot"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}
