export function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof __ENV !== "undefined" && __ENV.BASE_URL) return __ENV.BASE_URL;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
