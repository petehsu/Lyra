export type NotificationMessages = {
  readonly title: string;
  readonly listTitle: string;
  readonly emptyTitle: string;
  readonly markAllRead: string;
  readonly clearAll: string;
  readonly unread: string;
  readonly openSource: string;
  readonly sourceFallback: string;
  readonly retry: string;
};

export const enUS: NotificationMessages = {
  title: "Notifications",
  listTitle: "List",
  emptyTitle: "No notifications",
  markAllRead: "Mark all as read",
  clearAll: "Clear all",
  unread: "Unread",
  openSource: "Open source",
  sourceFallback: "No jump target available",
  retry: "Retry"
};
