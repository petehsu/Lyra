declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";

  type TaskListOptions = {
    readonly enabled?: boolean;
    readonly label?: boolean;
    readonly labelAfter?: boolean;
  };

  const taskLists: (md: MarkdownIt, options?: TaskListOptions) => void;
  export default taskLists;
}

declare module "markdown-it-container" {
  import type MarkdownIt from "markdown-it";

  type ContainerOptions = {
    readonly validate?: ((params: string) => boolean) | undefined;
    readonly render?: ((tokens: unknown[], index: number) => string) | undefined;
  };

  const container: (md: MarkdownIt, name: string, options?: ContainerOptions) => void;
  export default container;
}
