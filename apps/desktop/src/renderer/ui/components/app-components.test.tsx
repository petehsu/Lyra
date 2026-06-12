import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Moon } from "lucide-react";

import {
  AppBadge,
  AppButton,
  AppChoiceCard,
  AppCommandMenu,
  AppDataTable,
  AppDialog,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppInput,
  AppLoadingState,
  AppObjectRow,
  AppSearchField,
  AppSelect,
  AppSettingsSection,
  AppStatusMessage,
  AppSwitch,
  AppTabs,
  AppTooltip,
  AppToast,
  AppToastProvider,
  AppToastViewport,
  AppToolbarButton,
  AppWindowButton,
  type AppDataTableColumn
} from ".";

describe("Lyra App UI components", () => {
  test("renders buttons through the Lyra wrapper surface", () => {
    render(<AppButton variant="outline">Open</AppButton>);

    expect(screen.getByRole("button", { name: "Open" })).toHaveClass(
      "lyra-ui-button",
      "lyra-ui-button-outline"
    );
  });

  test("renders active choice cards with a checked state", () => {
    const onClick = vi.fn();
    render(
      <AppChoiceCard active role="radio" aria-checked="true" onClick={onClick} label="Dark" />
    );

    const radio = screen.getByRole("radio", { name: "Dark" });
    expect(radio).toHaveAttribute("data-state", "checked");

    fireEvent.click(radio);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("wraps form controls and settings sections with stable classes", () => {
    render(
      <AppSettingsSection label="Appearance">
        <AppInput aria-label="Name" />
        <AppSelect
          ariaLabel="Theme"
          value="dark"
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark", description: "Low light", icon: <Moon aria-hidden="true" /> }
          ]}
          onValueChange={vi.fn()}
        />
        <AppSwitch aria-label="Enabled" />
      </AppSettingsSection>
    );

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveClass("lyra-ui-input");
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveClass("lyra-ui-select-trigger");
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveClass("lyra-ui-switch");
  });

  test("exports shell-ready toolbar, search, and tab components", () => {
    const onSearch = vi.fn();
    const onTabChange = vi.fn();
    render(
      <>
        <AppIconButton aria-label="Refresh">
          <Moon aria-hidden="true" />
        </AppIconButton>
        <AppToolbarButton aria-label="Open" label="Open">
          <Moon aria-hidden="true" />
        </AppToolbarButton>
        <AppWindowButton action="close" aria-label="Close">
          <Moon aria-hidden="true" />
        </AppWindowButton>
        <AppSearchField
          ariaLabel="Search"
          value="lyra"
          submitLabel="Run search"
          onValueChange={onSearch}
          onSubmit={vi.fn()}
        />
        <AppTabs
          ariaLabel="Scope"
          value="all"
          options={[
            { value: "all", label: "All" },
            { value: "local", label: "Local" }
          ]}
          onValueChange={onTabChange}
        />
      </>
    );

    expect(screen.getByRole("button", { name: "Refresh" })).toHaveClass("lyra-app-icon-button");
    expect(screen.getByRole("button", { name: "Open" })).toHaveClass("lyra-app-toolbar-button");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("lyra-app-window-button");
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("data-window-action", "close");
    expect(screen.getByLabelText("Search")).toHaveClass("lyra-app-search-field-input");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "agents" } });
    expect(onSearch).toHaveBeenCalledWith("agents");
    fireEvent.click(screen.getByRole("tab", { name: "Local" }));
    expect(onTabChange).toHaveBeenCalledWith("local");
  });

  test("renders reusable object rows, badges, and status messages", () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    render(
      <>
        <AppObjectRow
          as="div"
          role="button"
          tabIndex={0}
          active
          aria-label="Open package"
          icon={<Moon aria-hidden="true" />}
          title="Package"
          description="Reusable store row"
          badges={<AppBadge tone="success">Active</AppBadge>}
          actions={(
            <button type="button" onClick={onAction}>
              Row action
            </button>
          )}
          onClick={onOpen}
        />
        <AppStatusMessage tone="error">Operation failed</AppStatusMessage>
      </>
    );

    const row = screen.getByRole("button", { name: "Open package" });
    expect(row).toHaveClass("lyra-app-object-row");
    expect(row).toHaveAttribute("data-active", "true");
    expect(row).toHaveAttribute("data-has-actions", "true");
    expect(screen.getByText("Row action").closest(".lyra-app-object-row-actions")).not.toBeNull();
    expect(screen.getByText("Active")).toHaveClass("lyra-app-badge-success");
    expect(screen.getByText("Operation failed").closest("p")).toHaveClass(
      "lyra-app-status-message-error"
    );

    fireEvent.click(screen.getByRole("button", { name: "Row action" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("renders tooltips through the Lyra wrapper surface", async () => {
    render(
      <AppTooltip content="Refresh workspace" delayDuration={0}>
        <button type="button">Refresh</button>
      </AppTooltip>
    );

    const trigger = screen.getByRole("button", { name: "Refresh" });
    fireEvent.focus(trigger);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Refresh workspace");
  });

  test("renders dialogs through the Lyra wrapper surface", () => {
    const onOpenChange = vi.fn();
    render(
      <AppDialog
        open
        onOpenChange={onOpenChange}
        title="Confirm action"
        description="This action updates the workspace."
        footer={<AppButton size="sm">Apply</AppButton>}
      >
        Dialog content
      </AppDialog>
    );

    expect(screen.getByRole("dialog")).toHaveClass("lyra-app-dialog");
    expect(screen.getByRole("heading", { name: "Confirm action" })).toHaveClass(
      "lyra-ui-dialog-title"
    );
    expect(screen.getByText("Dialog content").closest(".lyra-app-dialog-body")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("renders command menus with search and object rows", () => {
    const onOpenChange = vi.fn();
    const onSelectItem = vi.fn();
    render(
      <AppCommandMenu
        open
        onOpenChange={onOpenChange}
        title="Command menu"
        searchAriaLabel="Search commands"
        items={[
          {
            id: "open-file",
            title: "Open File",
            description: "Find a workspace file",
            keywords: ["quick open"]
          },
          {
            id: "close-tab",
            title: "Close Tab",
            description: "Close the current tab"
          }
        ]}
        onSelectItem={onSelectItem}
      />
    );

    expect(screen.getByRole("dialog")).toHaveClass("lyra-app-command-menu");
    fireEvent.change(screen.getByLabelText("Search commands"), { target: { value: "quick" } });
    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.queryByText("Close Tab")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /Open File/u }));
    expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ id: "open-file" }));
  });

  test("renders toast rows through the Lyra wrapper surface", () => {
    render(
      <AppToastProvider>
        <AppToast open tone="success" title="Saved" description="Preferences updated." />
        <AppToastViewport />
      </AppToastProvider>
    );

    const toast = screen.getByText("Saved").closest(".lyra-app-toast");
    expect(toast).not.toBeNull();
    expect(toast).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Preferences updated.")).toHaveClass("lyra-ui-toast-description");
  });

  test("renders empty, loading, and error states with stable classes", () => {
    render(
      <>
        <AppEmptyState title="No packages" description="Install one to continue." />
        <AppLoadingState title="Loading packages" description="Checking local state." />
        <AppErrorState
          title="Could not load"
          description="Try again."
          actions={<AppButton size="sm">Retry</AppButton>}
        />
      </>
    );

    expect(screen.getByText("No packages").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-empty");
    expect(screen.getByText("Loading packages").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-loading");
    expect(screen.getByText("Could not load").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-error", "lyra-app-state-tone-error");
    expect(screen.getByRole("button", { name: "Retry" }))
      .toHaveClass("lyra-ui-button");
  });

  test("renders data tables with rows, actions, and fallback states", () => {
    type PackageRow = {
      readonly id: string;
      readonly name: string;
      readonly status: string;
    };
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    const columns: AppDataTableColumn<PackageRow>[] = [
      {
        id: "name",
        header: "Name",
        cell: (row) => row.name,
        truncate: true
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => row.status,
        align: "end" as const
      }
    ];

    const { rerender } = render(
      <AppDataTable
        ariaLabel="Packages"
        columns={columns}
        rows={[{ id: "pkg-1", name: "Lyra Package", status: "Active" } satisfies PackageRow]}
        getRowKey={(row) => row.id}
        activeRowKey="pkg-1"
        onRowClick={onRowClick}
        rowActions={(row) => (
          <button type="button" onClick={() => onAction(row.id)}>
            Open
          </button>
        )}
      />
    );

    const table = screen.getByRole("table", { name: "Packages" });
    expect(table.closest(".lyra-app-data-table")).not.toBeNull();
    const row = screen.getByRole("button", { name: /Lyra Package Active Open/u });
    expect(row).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onAction).toHaveBeenCalledWith("pkg-1");
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledWith({ id: "pkg-1", name: "Lyra Package", status: "Active" }, 0);

    rerender(
      <AppDataTable
        ariaLabel="Packages"
        columns={columns}
        rows={[] as PackageRow[]}
        getRowKey={(row) => row.id}
        emptyState={<AppEmptyState title="No rows" />}
      />
    );
    expect(screen.getByText("No rows").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-empty");

    rerender(
      <AppDataTable
        ariaLabel="Packages"
        columns={columns}
        rows={[] as PackageRow[]}
        getRowKey={(row) => row.id}
        loading
        loadingState={<AppLoadingState title="Loading rows" />}
      />
    );
    expect(screen.getByText("Loading rows").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-loading");

    rerender(
      <AppDataTable
        ariaLabel="Packages"
        columns={columns}
        rows={[] as PackageRow[]}
        getRowKey={(row) => row.id}
        error
        errorState={<AppErrorState title="Rows failed" />}
      />
    );
    expect(screen.getByText("Rows failed").closest(".lyra-app-state"))
      .toHaveClass("lyra-app-state-error");
  });
});
