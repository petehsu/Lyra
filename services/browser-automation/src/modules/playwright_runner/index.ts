import type { NavigateCommand } from "../../contracts/navigation";

export const runNavigate = async (cmd: NavigateCommand): Promise<string> => {
  return `navigate:${cmd.url}`;
};
