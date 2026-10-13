"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Inbox" },
  { href: "/setup", label: "Shop setup" },
  { href: "/better", label: "Is it better?" },
  { href: "/ab", label: "Blind test" },
];

export function TopBar() {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="logo">ReplyDesk</Link>
      <nav className="topnav" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
