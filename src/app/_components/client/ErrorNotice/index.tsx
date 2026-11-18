"use client";

export type NoticeError =
  | { message: string; data?: { help?: string | null } | null }
  | null
  | undefined;

/**
 * An error message, with a link to the Help article that explains it when the
 * server provides one. Help opens in a new tab so the game page and anything
 * typed into it are kept.
 */
export function ErrorNotice({
  error,
  className = "text-sm text-destructive",
}: {
  error: NoticeError | string;
  className?: string;
}) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  const help = typeof error === "string" ? null : error.data?.help;
  return (
    <p role="alert" className={className}>
      {message}
      {help && (
        <>
          {" "}
          <a
            href={help}
            target="_blank"
            rel="noopener"
            className="whitespace-nowrap underline"
          >
            What can I do?
          </a>
        </>
      )}
    </p>
  );
}
