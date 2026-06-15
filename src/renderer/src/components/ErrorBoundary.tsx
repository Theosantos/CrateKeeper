import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render/lifecycle errors anywhere below it and shows a recoverable
 * message instead of letting React unmount the whole tree (the "white screen").
 * Also logs the error + component stack so the source is visible in DevTools.
 *
 * React error boundaries must be class components (no hook equivalent yet).
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[renderer] uncaught error:', error, info.componentStack)
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error !== null) {
      return (
        <div role="alert" className="error-boundary">
          <h2 className="error-boundary__title">Une erreur est survenue</h2>
          <p className="error-boundary__message">{error.message}</p>
          <button
            type="button"
            className="error-boundary__retry"
            onClick={this.handleReset}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
