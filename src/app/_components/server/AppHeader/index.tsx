import { SiteHeader, type NavLink } from "@/app/_components/ui/page";
import { auth } from "@/server/auth";

/** The site header with links for whoever is looking: host or guest. */
export async function AppHeader({ extra = [] }: { extra?: NavLink[] }) {
  const session = await auth();
  const links: NavLink[] = session
    ? [
        ...extra,
        { href: "/dashboard", label: "My games" },
        { href: "/join", label: "Join" },
        { href: "/help", label: "Help" },
        { href: "/api/auth/signout", label: "Sign out" },
      ]
    : [
        ...extra,
        { href: "/join", label: "Join" },
        { href: "/api/auth/signin?callbackUrl=/dashboard", label: "Host" },
        { href: "/help", label: "Help" },
      ];
  return (
    <SiteHeader
      links={links}
      note={
        session?.user?.name ? `Signed in as ${session.user.name}` : undefined
      }
    />
  );
}
