"use client";

import { useState, type ReactNode } from "react";

import { ChatPanel } from "@/app/_components/client/ChatPanel";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";
import { cn } from "@/app/_lib/utils";
import { useMediaQuery } from "@/utils/useMediaQuery";

/**
 * The player's tabs. When the host has chat on, wide screens (CSS `lg`) show
 * it beside the tabs so players can buzz and chat at once. The layout is pure
 * CSS, so nothing jumps after hydration, and chat (with its live stream) is
 * only mounted where it can be seen.
 */
export function PlayerTabs({
  defaultTab,
  header,
  buzzer,
  team,
  info,
}: {
  defaultTab: "buzzer" | "team-switcher";
  header: ReactNode;
  buzzer: ReactNode;
  team?: ReactNode;
  info: ReactNode;
}) {
  const isLg = useMediaQuery("(min-width: 64rem)");
  const chatOn = useLiveGameState().data?.game.chatEnabled ?? false;
  const [tab, setTab] = useState<string>(defaultTab);
  const chatOpen = tab === "chat";
  const side = chatOn && isLg;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col gap-6",
        chatOn && "lg:max-w-none",
      )}
    >
      {header}
      <div
        className={cn(
          "grid w-full items-start gap-2",
          chatOn && "lg:grid-cols-2 lg:gap-6",
        )}
      >
        <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
          <TabsList className="flex h-auto w-full">
            <TabsTrigger value="buzzer" className="flex-1">
              Buzzer
            </TabsTrigger>
            {team && (
              <TabsTrigger value="team-switcher" className="flex-1">
                Team
              </TabsTrigger>
            )}
            <TabsTrigger
              value="chat"
              className={cn("flex-1", chatOn && "lg:hidden")}
            >
              Chat
            </TabsTrigger>
            <TabsTrigger value="information" className="flex-1">
              Info
            </TabsTrigger>
          </TabsList>
          <TabsContent value="buzzer" className="flex flex-col gap-4">
            {buzzer}
          </TabsContent>
          {team && <TabsContent value="team-switcher">{team}</TabsContent>}
          <TabsContent value="chat">
            {chatOn && (
              <p className="text-muted-foreground hidden p-4 text-center lg:block">
                Chat is beside this panel.
              </p>
            )}
          </TabsContent>
          <TabsContent value="information">{info}</TabsContent>
        </Tabs>
        <div
          className={cn(
            "min-w-0",
            chatOpen ? "block" : "hidden",
            chatOn && "lg:sticky lg:top-4 lg:block",
          )}
        >
          {(side || chatOpen) && <ChatPanel as="player" />}
        </div>
      </div>
    </div>
  );
}
