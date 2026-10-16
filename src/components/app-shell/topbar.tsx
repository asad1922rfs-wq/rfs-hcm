"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { KeyRound, LogOut, Menu, Monitor, Moon, Sun, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/utils";
import { signOutAction } from "@/app/login/actions";
import { Brand, SidebarNav } from "./sidebar";
import { GlobalSearch } from "./global-search";
import type { NavSection } from "./nav";

type Props = {
  sections: NavSection[];
  companyShortName: string;
  logoUrl: string | null;
  user: { displayName: string; roleName: string; email: string | null; hasProfile: boolean };
};

export function Topbar({ sections, companyShortName, logoUrl, user }: Props) {
  const [open, setOpen] = useState(false);
  const { setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand companyShortName={companyShortName} logoUrl={logoUrl} />
          <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1"><GlobalSearch sections={sections} /></div>
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Change theme">
              <Sun className="size-5 dark:hidden" />
              <Moon className="hidden size-5 dark:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}><Sun /> Light</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}><Moon /> Dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}><Monitor /> System</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-10 gap-3 px-2">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials(user.displayName)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{user.displayName}</span>
                <span className="block text-xs text-muted-foreground">{user.roleName}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm font-medium">{user.displayName}</span>
              {user.email && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.hasProfile && (
              <DropdownMenuItem asChild><Link href="/me"><UserCircle /> My profile</Link></DropdownMenuItem>
            )}
            <DropdownMenuItem asChild><Link href="/change-password"><KeyRound /> Change password</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full"><LogOut /> Sign out</button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
