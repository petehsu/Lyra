import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SettingsAiView } from "../view";
import type { SettingsAiLabels, SettingsAiModel } from "../types";

const labels = {
  profilesTitle: "Profiles",
  emptyTitle: "No AI profile yet",
} as SettingsAiLabels;

const createModel = (): SettingsAiModel => ({
  refreshConfig: vi.fn(),
  saveProfile: vi.fn(),
  validateProfile: vi.fn(),
} as unknown as SettingsAiModel);

describe("SettingsAiView", () => {
  test("renders only the Agent runtime reset empty state", () => {
    const model = createModel();

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("heading", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByText("No AI profile yet")).toBeInTheDocument();
    expect(screen.getByText("Reserved for the next Agent runtime.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(model.refreshConfig).not.toHaveBeenCalled();
    expect(model.saveProfile).not.toHaveBeenCalled();
    expect(model.validateProfile).not.toHaveBeenCalled();
  });
});
