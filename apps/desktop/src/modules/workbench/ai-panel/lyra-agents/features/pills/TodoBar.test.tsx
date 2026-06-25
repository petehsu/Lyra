import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { TodoBar, type TodoItem } from "./TodoBar";

afterEach(() => {
  cleanup();
});

const todo = (id: string, status: TodoItem["status"]): TodoItem => ({
  id,
  title: `task ${id}`,
  status,
});

describe("TodoBar capsule", () => {
  test("renders nothing when there are no todos", () => {
    const { container } = render(<TodoBar tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("hides itself (fact-driven) once every todo is done", () => {
    const { container } = render(
      <TodoBar tasks={[todo("1", "done"), todo("2", "done")]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("shows the current step and total as `current|total`", () => {
    render(
      <TodoBar
        tasks={[todo("1", "done"), todo("2", "running"), todo("3", "pending")]}
      />
    );
    const capsule = screen.getByRole("button");
    // Running task is index 1 -> step 2 of 3. The literal pipe separates them.
    expect(capsule).toHaveTextContent("2|3");
  });

  test("falls back to the first unfinished step when none is running", () => {
    render(
      <TodoBar tasks={[todo("1", "done"), todo("2", "pending"), todo("3", "pending")]} />
    );
    // One done, none running -> next step is 2 of 3.
    expect(screen.getByRole("button")).toHaveTextContent("2|3");
  });

  test("opens the board when clicked", () => {
    const onOpenBoard = vi.fn();
    render(<TodoBar tasks={[todo("1", "running")]} onOpenBoard={onOpenBoard} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenBoard).toHaveBeenCalledTimes(1);
  });

  test("is disabled when no opener is provided", () => {
    render(<TodoBar tasks={[todo("1", "running")]} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
