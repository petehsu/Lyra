import type { NavigateCommand } from "../../contracts/navigation.js";

export const runNavigate = async (cmd: NavigateCommand): Promise<string> => {
  return `navigate:${cmd.url}`;
};
