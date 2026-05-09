import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";

import type { AgentSessionDetail, AgentTodoItem } from "./agent-ui-types";
import {
  todoItemDetail,
  todoStatusIcon,
  todoStatusLabel,
  todoSummary,
} from "./execution-todo-list";

type AgentTodoRailProps = {
  readonly detail: AgentSessionDetail | null;
};

export const AgentTodoRail = ({ detail }: AgentTodoRailProps) => {
  const [expanded, setExpanded] = useState(false);
  const todo = detail?.activeTodo ?? null;
  if (todo === null || todo.items.length === 0) {
    return null;
  }
  const activeItem = activeTodoItem(todo.items);
  return (
    <section className="lyra-ai-agent-todo-rail" aria-label="Agent todo">
      <button
        className="lyra-ai-agent-todo-rail-summary"
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((current) => !current);
        }}
      >
        <span className="lyra-ai-agent-todo-rail-icon" aria-hidden="true">
          <ListChecks size={13} />
        </span>
        <span className="lyra-ai-agent-todo-rail-title">{todo.title}</span>
        <span className="lyra-ai-agent-todo-rail-current">
          {activeItem === null ? "No active step" : activeItem.title}
        </span>
        <span className="lyra-ai-agent-todo-rail-meta">{todoSummary(detail)}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {expanded ? (
        <ol className="lyra-ai-agent-todo-rail-items">
          {todo.items.map((item) => (
            <li
              key={item.todoItemId}
              className="lyra-ai-agent-todo-rail-item"
              data-status={item.status}
            >
              <span className="lyra-ai-agent-todo-rail-status" aria-label={todoStatusLabel(item.status)}>
                {todoStatusIcon(item.status)}
              </span>
              <span className="lyra-ai-agent-todo-rail-item-main">
                <span className="lyra-ai-agent-todo-rail-item-title">{item.title}</span>
                <span className="lyra-ai-agent-todo-rail-item-detail">{todoItemDetail(item)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};

const activeTodoItem = (items: readonly AgentTodoItem[]): AgentTodoItem | null =>
  items.find((item) => item.status === "in_progress" || item.status === "running" || item.status === "active")
  ?? items.find((item) => item.status === "blocked" || item.status === "failed")
  ?? items.find((item) => item.status !== "completed" && item.status !== "skipped")
  ?? items.at(-1)
  ?? null;
