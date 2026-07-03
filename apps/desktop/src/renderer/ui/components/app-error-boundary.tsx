import {
  Component,
  type ErrorInfo,
  type ReactNode
} from "react";

import { AppErrorState, type AppErrorStateProps } from "./app-state";

export type AppErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  readonly title: ReactNode;
} & Pick<AppErrorStateProps, "actions" | "className">;

type AppErrorBoundaryState = {
  readonly error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[lyra-renderer] uncaught render error", error, info);
    this.props.onError?.(error, info);
  }

  override render() {
    if (this.state.error !== null) {
      return (
        <AppErrorState
          role="alert"
          density="spacious"
          className={this.props.className}
          title={this.props.title}
          description={this.props.description ?? this.state.error.message}
          actions={this.props.actions}
        />
      );
    }

    return this.props.children;
  }
}
