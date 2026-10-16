import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/** Keeps a crashing custom component inside its own card: the rest of the screen stays up. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label ?? "component"} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <p role="alert" className="type-sub text-bad">{this.props.label ?? "This panel"} crashed: {this.state.error.message}</p>;
    }
    return this.props.children;
  }
}
