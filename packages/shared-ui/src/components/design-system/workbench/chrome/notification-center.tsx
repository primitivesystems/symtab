import { useState, type KeyboardEvent } from "react";

import { Button } from "../../../ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../../ui/popover";
import { ScrollArea } from "../../../ui/scroll-area";
import { WorkbenchIcon } from "../shared/workbench-icon";
import type { WorkbenchNotification } from "../types";

export interface NotificationCenterProps {
  notifications: readonly WorkbenchNotification[];
  onAction: (notificationId: string, actionId: string) => void;
  onNotificationClick?: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  onClear: () => void;
}

const notificationIcons = {
  info: "info",
  warning: "warning",
  error: "error",
} as const;

export function NotificationCenter({
  notifications,
  onAction,
  onNotificationClick,
  onDismiss,
  onClear,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            type="button"
            aria-label={`${notifications.length || "No"} notifications`}
            title="Notifications"
          >
            <WorkbenchIcon name={notifications.length ? "bell-dot" : "bell"} size={12} />
          </Button>
        }
      />
      <PopoverContent
        side="top"
        align="end"
        sideOffset={4}
        className="w-[380px] max-w-[calc(100vw-16px)] gap-0 rounded-md p-0"
      >
        <header className="flex h-9 items-center gap-2 border-b px-2.5">
          <PopoverTitle className="text-xs">Notifications</PopoverTitle>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label="Clear all notifications"
            title="Clear all notifications"
            className="ms-auto"
            disabled={!notifications.length}
            onClick={onClear}
          >
            <WorkbenchIcon name="clear-all" size={14} />
          </Button>
        </header>

        <ScrollArea className="max-h-[420px]">
          {notifications.length ? (
            <div role="list">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  role="listitem"
                  className={`group flex items-start gap-2 border-b px-3 py-2.5 last:border-b-0 ${
                    onNotificationClick
                      ? "cursor-pointer hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                      : ""
                  }`}
                  {...(onNotificationClick
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-label": `Open ${notification.title}`,
                        onClick: () => onNotificationClick(notification.id),
                        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onNotificationClick(notification.id);
                          }
                        },
                      }
                    : {})}
                >
                  <WorkbenchIcon
                    name={notificationIcons[notification.kind ?? "info"]}
                    size={14}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{notification.title}</p>
                      {notification.source ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          Source: {notification.source}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {notification.message}
                    </p>
                    {notification.actions?.length && !onNotificationClick ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {notification.actions.map((action) => (
                          <Button
                            key={action.id}
                            variant={action.primary ? "default" : "secondary"}
                            size="xs"
                            type="button"
                            onClick={() => {
                              onAction(notification.id, action.id);
                              setOpen(false);
                            }}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={`Dismiss ${notification.title}`}
                    title="Dismiss"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDismiss(notification.id);
                    }}
                  >
                    <WorkbenchIcon name="close" size={14} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid min-h-28 place-items-center px-6 text-center text-xs text-muted-foreground">
              No new notifications
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
