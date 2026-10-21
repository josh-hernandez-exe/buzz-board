/** Shown while a page loads. */
export default function Loading() {
  return (
    <div
      role="status"
      className="bg-background text-muted-foreground flex min-h-screen items-center justify-center gap-3"
    >
      <span
        aria-hidden
        className="bg-primary size-4 animate-ping rounded-full"
      />
      Loading…
    </div>
  );
}
