'use client';

/**
 * v7.19: ErrorBoundary — prepreči bel zaslon ob crashu komponente.
 *
 * Aplikacija ima 55 AI funkcij in 17 pogledov. Če ena komponenta crashne
 * (npr. AI endpoint vrne neveljaven JSON, network timeout, null reference),
 * ErrorBoundary ujame napako in prikaže prijazno sporočilo z gumbom "Poskusi znova".
 *
 * Uporaba:
 *   <ErrorBoundary>
 *     <SomeView />
 *   </ErrorBoundary>
 *
 * Next.js App Router ne podpira class component error boundaries v server components,
 * a ta je 'use client' in deluje v client components (vsi naši pogledi so client).
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Ime pogleda za prikaz v error sporočilu (npr. "Kupci", "Skladišče AI") */
  viewName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error za debugging (v dev)
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[ErrorBoundary${this.props.viewName ? `: ${this.props.viewName}` : ''}]`, error, errorInfo);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const viewName = this.props.viewName ?? 'ta pogled';
      const errorMsg = this.state.error?.message ?? 'Neznana napaka';

      return (
        <div className="flex items-center justify-center min-h-[60vh] p-4">
          <div className="max-w-md text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Napaka v pogledu &quot;{viewName}&quot;</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Nekaj je šlo narobe. AI funkcija ali podatki niso bili pravilno naloženi.
              </p>
            </div>
            <div className="bg-card/30 border border-border rounded-lg p-3 text-left">
              <code className="text-[10px] text-muted-foreground break-all font-mono">
                {errorMsg.slice(0, 200)}
              </code>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={this.handleRetry} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Poskusi znova
              </Button>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="gap-2"
              >
                Osveži stran
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Če napaka vztraja, preveri AI provider nastavitve v Settings.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
