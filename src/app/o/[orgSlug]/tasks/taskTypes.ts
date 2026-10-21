export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export interface TaskAssigneeOption {
  membershipId: string;
  userName: string;
  roleName: string;
}

/** One row of the tasks table, with everything display-related already worked out on the server. */
export interface TaskRowData {
  id: string;
  title: string;
  description: string | null;
  assigneeMembershipId: string;
  assigneeName: string | null;
  /** ISO string, or "" when there is no due date; for the edit form. */
  dueAtInput: string;
  dueLabel: string | null;
  dueState: "overdue" | "today" | "upcoming" | "none" | "closed";
  priority: TaskPriority;
  status: TaskStatus;
  link: { type: string; label: string | null; href: string | null } | null;
  canManage: boolean;
  canReassign: boolean;
  isClosed: boolean;
}
